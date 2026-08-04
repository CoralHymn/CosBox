import { SnapshotError, StateValidationError } from '../core/errors';
import { clonePlain } from '../core/clone';
import { addMinutes, applyConfigOverrides, applyStateDelta, createInitialState } from '../core/state';
import { collectBranchPath, getBranchTips, getChildrenMap, sortNodes } from '../core/snapshot';
import type {
	BranchSummary,
	CharacterSessionView,
	CharacterState,
	ChatMessageView,
	ConfigOverrides,
	ConfigPatch,
	MessageRole,
	SnapshotNode,
	StatePatch
} from '../core/types';
import type { KvRepository } from '../db/kv-repo';
import type { SnapshotRepository } from '../db/snapshot-repo';

/** kv 中保存的「上次 checkout 的 head 快照 id」。 */
const LAST_HEAD_KEY = 'lastHeadId';
/** kv 中保存的世界配置覆盖（地点库 / 衣柜 / 日程条目，不进版本历史）。 */
const CONFIG_OVERRIDES_KEY = 'config.overrides';

/** CharacterManager 依赖注入（便于测试替换时钟与 id 生成）。 */
export interface CharacterManagerDeps {
	snapshots: SnapshotRepository;
	kv: KvRepository;
	/** 可选：确定性时钟。 */
	now?: () => number;
}

/**
 * 角色状态管理器：一切状态变更的唯一入口。
 * 所有写入都走「校验 -> 追加快照 -> 应用 -> 刷新」，禁止外部直接 mutation。
 * 框架无关（不依赖 Svelte），UI 通过订阅获得最新视图。
 */
export class CharacterManager {
	private state: CharacterState = createInitialState();
	private headId: string | null = null;
	private conversation: ChatMessageView[] = [];
	private snapshots: SnapshotNode[] = [];
	private branches: BranchSummary[] = [];
	/** 世界配置覆盖：维护性编辑（地点库/衣柜/日程条目）不记入版本历史。 */
	private configOverrides: ConfigOverrides = {};
	private initialized = false;
	private readonly listeners = new Set<() => void>();
	/** 变更任务队列：保证并发 update/addMessage/checkout 按调用顺序串行落地。 */
	private queue: Promise<unknown> = Promise.resolve();
	/** 已发出的最大快照时间戳，保证同一毫秒内仍单调递增（分支排序稳定）。 */
	private lastTimestamp = 0;
	/** 共享的初始化 promise，防止并发 init 重复建库。 */
	private initPromise: Promise<void> | null = null;

	constructor(private readonly deps: CharacterManagerDeps) {}

	/** 订阅状态变化，返回取消订阅函数。 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/** 把变更任务串行入队；失败不影响后续任务执行。 */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task);
		this.queue = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	/** 当前状态（只读引用，禁止直接修改）。 */
	getState(): CharacterState {
		return this.state;
	}

	/** 当前 head 快照 id。 */
	getHeadId(): string | null {
		return this.headId;
	}

	/** 当前分支的消息序列（由 head 重建）。 */
	getConversation(): ChatMessageView[] {
		return this.conversation;
	}

	/** 全部快照节点（按时间升序）。 */
	getSnapshots(): SnapshotNode[] {
		return this.snapshots;
	}

	/** 全部分支 tip。 */
	getBranches(): BranchSummary[] {
		return this.branches;
	}

	/** 组合视图快照，供 UI/测试一次性读取。 */
	snapshot(): CharacterSessionView {
		return {
			state: this.state,
			headId: this.headId,
			conversation: this.conversation,
			snapshots: this.snapshots,
			branches: this.branches
		};
	}

	private refresh(): Promise<void> {
		return this.reload();
	}

	private async reload(): Promise<void> {
		const all = await this.deps.snapshots.getAll();
		this.snapshots = sortNodes(all);
		this.branches = await this.deps.snapshots.getBranches();
		if (this.headId !== null) {
			const rebuilt = await this.deps.snapshots.rebuildState(this.headId);
			this.state = applyConfigOverrides(rebuilt.state, this.configOverrides);
			this.conversation = rebuilt.messages;
		}
		this.emit();
	}

	/** 加载持久化的世界配置覆盖。 */
	private async loadConfigOverrides(): Promise<void> {
		this.configOverrides = (await this.deps.kv.get<ConfigOverrides>(CONFIG_OVERRIDES_KEY)) ?? {};
	}

	/**
	 * 初始化：空库时创建根快照；否则恢复上次 head（或最新分支 tip）。
	 * 幂等，可安全重复调用。
	 */
	/** 初始化（并发安全）：共享同一个初始化 promise。 */
	init(): Promise<void> {
		if (this.initialized) {
			return Promise.resolve();
		}
		if (this.initPromise !== null) {
			return this.initPromise;
		}
		this.initPromise = this.doInit().finally(() => {
			this.initPromise = null;
		});
		return this.initPromise;
	}

	private async doInit(): Promise<void> {
		await this.loadConfigOverrides();
		const count = await this.deps.snapshots.count();
		if (count === 0) {
			const root = await this.deps.snapshots.addSnapshot({
				parentId: null,
				metadata: { type: 'root', desc: '初始状态' },
				delta: null,
				timestamp: this.now()
			});
			this.headId = root.id;
			await this.persistHead();
		} else {
			const saved = await this.deps.kv.get<string>(LAST_HEAD_KEY);
			const node = saved ? await this.deps.snapshots.getNode(saved) : undefined;
			if (node) {
				this.headId = node.id;
			} else {
				const tips = await this.deps.snapshots.getBranches();
				const latest = [...tips].sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
				this.headId = latest?.tipId ?? null;
			}
		}
		await this.refresh();
		this.initialized = true;
		this.emit();
	}

	/**
	 * 应用状态变更：先校验合并结果，再追加状态快照。
	 * 这是唯一允许修改角色状态（outfit/location/schedule/attributes）的入口。
	 */
	update(patch: StatePatch, metadata: { desc: string }): Promise<SnapshotNode> {
		return this.enqueue(() => this.doUpdate(patch, metadata));
	}

	private async doUpdate(patch: StatePatch, metadata: { desc: string }): Promise<SnapshotNode> {
		await this.ensureInit();
		const merged = applyStateDelta(this.state, patch);
		const node = await this.deps.snapshots.addSnapshot({
			parentId: this.headId,
			metadata: { type: 'state', desc: metadata.desc },
			delta: { kind: 'state', patch: clonePlain(patch) },
			timestamp: this.now()
		});
		this.headId = node.id;
		this.state = merged;
		await this.persistHead();
		await this.refresh();
		return node;
	}

	/** 追加一条对话消息（user/assistant/system），内容不得为空。 */
	addMessage(role: MessageRole, content: string): Promise<SnapshotNode> {
		return this.enqueue(() => this.doAddMessage(role, content));
	}

	private async doAddMessage(role: MessageRole, content: string): Promise<SnapshotNode> {
		await this.ensureInit();
		const trimmed = content.trim();
		if (trimmed === '') {
			throw new StateValidationError('消息内容不能为空');
		}
		const roleLabel = role === 'user' ? '用户消息' : role === 'assistant' ? '角色消息' : '系统消息';
		const node = await this.deps.snapshots.addSnapshot({
			parentId: this.headId,
			metadata: { type: 'message', desc: roleLabel },
			delta: { kind: 'message', role, content: trimmed },
			timestamp: this.now()
		});
		this.headId = node.id;
		await this.persistHead();
		await this.refresh();
		return node;
	}

	/**
	 * checkout：切换到任意快照并重建状态与消息。
	 * 纯读操作，不写快照表——分支切换无副作用。
	 */
	checkout(targetId: string): Promise<void> {
		return this.enqueue(() => this.doCheckout(targetId));
	}

	private async doCheckout(targetId: string): Promise<void> {
		await this.ensureInit();
		const rebuilt = await this.deps.snapshots.checkout(targetId);
		this.headId = targetId;
		this.state = rebuilt.state;
		this.conversation = rebuilt.messages;
		await this.persistHead();
		await this.refresh();
	}

	/** 时间推进：正数前进、负数回拨，自动生成状态快照。 */
	advanceTime(minutes: number): Promise<SnapshotNode> {
		return this.enqueue(() => this.doAdvanceTime(minutes));
	}

	/**
	 * 应用世界配置覆盖（地点库 / 衣柜 / 日程条目）。
	 * 只更新内存态并持久化到 kv，不生成快照、不推进 head——维护性编辑不进版本历史。
	 */
	applyConfig(patch: ConfigPatch): Promise<void> {
		return this.enqueue(() => this.doApplyConfig(patch));
	}

	private async doApplyConfig(patch: ConfigPatch): Promise<void> {
		await this.ensureInit();
		const merged: ConfigOverrides = { ...this.configOverrides };
		if (patch.places !== undefined) {
			merged.places = clonePlain(patch.places);
		}
		if (patch.wardrobe !== undefined) {
			merged.wardrobe = clonePlain(patch.wardrobe);
		}
		if (patch.scheduleEntries !== undefined) {
			merged.scheduleEntries = clonePlain(patch.scheduleEntries);
		}
		// 通过 applyConfigOverrides 校验并叠加（非法配置抛错，不落 kv）。
		this.state = applyConfigOverrides(this.state, merged);
		this.configOverrides = merged;
		await this.deps.kv.set(CONFIG_OVERRIDES_KEY, merged);
		this.emit();
	}

	private async doAdvanceTime(minutes: number): Promise<SnapshotNode> {
		await this.ensureInit();
		if (!Number.isFinite(minutes)) {
			throw new StateValidationError('推进分钟数必须是有限数字');
		}
		const nextTime = addMinutes(this.state.schedule.time, minutes);
		const label = minutes >= 0 ? `时间推进 +${minutes} 分钟` : `时间回拨 ${minutes} 分钟`;
		return this.doUpdate({ schedule: { time: nextTime } }, { desc: label });
	}

	/** 手动检查点：空 delta 快照，用于记录「值得回退的位置」。 */
	addCheckpoint(desc: string): Promise<SnapshotNode> {
		return this.enqueue(() => this.doAddCheckpoint(desc));
	}

	private async doAddCheckpoint(desc: string): Promise<SnapshotNode> {
		await this.ensureInit();
		const trimmed = desc.trim() || '手动检查点';
		const node = await this.deps.snapshots.addSnapshot({
			parentId: this.headId,
			metadata: { type: 'checkpoint', desc: trimmed },
			delta: null,
			timestamp: this.now()
		});
		this.headId = node.id;
		await this.persistHead();
		await this.refresh();
		return node;
	}

	/**
	 * 删除分支：删除从 tip 沿 parentId 到分支点（不含分支点与根）的一整段链。
	 * 若当前 head 位于删除链上，会先切换到链的父节点（分支点或根），再删除，
	 * 保证删除后 head 一定指向仍存在的快照。根快照不可删除；
	 * 当全图只剩一个分支时禁止删除，避免把整段聊天历史清空。
	 * @returns 实际删除的快照数量
	 */
	deleteBranch(tipId: string): Promise<number> {
		return this.enqueue(() => this.doDeleteBranch(tipId));
	}

	private async doDeleteBranch(tipId: string): Promise<number> {
		await this.ensureInit();
		const all = await this.deps.snapshots.getAll();
		const map = new Map(all.map((node) => [node.id, node]));
		const childrenMap = getChildrenMap(all);
		if ((childrenMap.get(tipId) ?? []).length > 0) {
			throw new SnapshotError('只能删除分支末端的快照');
		}
		const path = collectBranchPath(childrenMap, map, tipId);
		if (path.length === 0) {
			throw new SnapshotError('无法删除根快照或节点不存在');
		}
		if (getBranchTips(all).length <= 1) {
			throw new SnapshotError('只剩一个分支，不能删除，否则会清空全部聊天记录');
		}
		const pathIds = new Set(path.map((node) => node.id));
		if (this.headId !== null && pathIds.has(this.headId)) {
			const fallbackParent = path[path.length - 1]!.parentId!;
			const rebuilt = await this.deps.snapshots.checkout(fallbackParent);
			this.headId = fallbackParent;
			this.state = rebuilt.state;
			this.conversation = rebuilt.messages;
			await this.persistHead();
		}
		await this.deps.snapshots.removeMany([...pathIds]);
		await this.refresh();
		return path.length;
	}

	private now(): number {
		const candidate = this.deps.now?.() ?? Date.now();
		const next = candidate > this.lastTimestamp ? candidate : this.lastTimestamp + 1;
		this.lastTimestamp = next;
		return next;
	}

	private async ensureInit(): Promise<void> {
		if (!this.initialized) {
			await this.init();
		}
	}

	private persistHead(): Promise<void> {
		// headId 在本类中只在赋值后才会调用 persistHead，这里直接断言非空。
		return this.deps.kv.set(LAST_HEAD_KEY, this.headId as string);
	}
}
