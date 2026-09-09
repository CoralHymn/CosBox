import { SnapshotError, StateValidationError } from '../core/errors';
import { clonePlain } from '../core/clone';
import {
	addMinutes,
	applyConfigOverrides,
	applyStateDelta,
	createInitialState
} from '../core/state';
import {
	collectBranchPath,
	getBranchTips,
	getChildrenMap,
	rebuildFromNodes,
	sortNodes
} from '../core/snapshot';
import type {
	BranchSummary,
	CharacterSessionView,
	CharacterState,
	ChatMessageView,
	ConfigOverrides,
	ConfigPatch,
	MessageSegment,
	MessageRole,
	SnapshotNode,
	StatePatch
} from '../core/types';
import type { ScopedKv } from '../db/scoped-kv';
import type { SnapshotRepository } from '../db/snapshot-repo';

/** kv 中保存的「上次 checkout 的 head 快照 id」（工作区作用域键）。 */
const LAST_HEAD_KEY = 'lastHeadId';
/** kv 中保存的世界配置覆盖（地点库 / 衣柜 / 日程条目，不进版本历史，工作区作用域键）。 */
const CONFIG_OVERRIDES_KEY = 'config.overrides';

/** CharacterManager 依赖注入（便于测试替换时钟与 id 生成）。 */
export interface CharacterManagerDeps {
	snapshots: SnapshotRepository;
	/** 工作区作用域的 kv：head / 配置覆盖等键自动带当前工作区前缀。 */
	kv: ScopedKv;
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

	/**
	 * 重建任意快照处的角色状态（含世界配置覆盖），不改动当前 head。
	 * 供「手动状态确认」等需要按历史时刻判断状态的场景使用。
	 */
	async getStateAt(targetId: string): Promise<CharacterState> {
		await this.ensureInit();
		const rebuilt = await this.deps.snapshots.rebuildState(targetId);
		return applyConfigOverrides(rebuilt.state, this.configOverrides);
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
		// 只读一次全表：分支与状态重建都是同一份数据的纯函数，
		// 避免 getBranches / rebuildState 各自再全表读一次（大数据下启动翻倍减速）。
		const all = await this.deps.snapshots.getAll();
		this.snapshots = sortNodes(all);
		this.branches = getBranchTips(all);
		if (this.headId !== null) {
			const map = new Map(all.map((node) => [node.id, node]));
			const rebuilt = rebuildFromNodes(map, this.headId, createInitialState());
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
	addMessage(
		role: MessageRole,
		content: string,
		options: { skipContext?: boolean; thinking?: string; segments?: MessageSegment[] } = {}
	): Promise<SnapshotNode> {
		return this.enqueue(() => this.doAddMessage(role, content, options));
	}

	private async doAddMessage(
		role: MessageRole,
		content: string,
		options: { skipContext?: boolean; thinking?: string; segments?: MessageSegment[] }
	): Promise<SnapshotNode> {
		await this.ensureInit();
		const trimmed = content.trim();
		const hasThinking = options.thinking !== undefined && options.thinking.trim() !== '';
		const hasSegments = (options.segments ?? []).length > 0;
		// 模型可能只输出思考过程、正文为空：此时允许空正文消息保留思考内容；
		// 分段消息（思考/工具调用/正文）同样允许空正文，防止脏数据进快照链。
		if (trimmed === '' && !hasThinking && !hasSegments) {
			throw new StateValidationError('消息内容不能为空');
		}
		const roleLabel = role === 'user' ? '用户消息' : role === 'assistant' ? '角色消息' : '系统消息';
		const node = await this.deps.snapshots.addSnapshot({
			parentId: this.headId,
			metadata: { type: 'message', desc: roleLabel },
			delta: {
				kind: 'message',
				role,
				content: trimmed,
				worldTime: clonePlain(this.state.schedule.time),
				...(options.thinking !== undefined && options.thinking.trim() !== ''
					? { thinking: options.thinking.trim() }
					: {}),
				...(hasSegments ? { segments: options.segments } : {}),
				...(options.skipContext === true ? { skipContext: true } : {})
			},
			timestamp: this.now()
		});
		this.headId = node.id;
		await this.persistHead();
		await this.refresh();
		return node;
	}

	/**
	 * 原地编辑一条消息快照的正文（类似 git commit --amend，不新增快照）。
	 * 只允许编辑消息类快照；正文不能为空；worldTime / thinking / skipContext 原样保留。
	 */
	editMessage(id: string, content: string): Promise<void> {
		return this.enqueue(() => this.doEditMessage(id, content));
	}

	/** 向一条已有消息追加分段（手动状态确认补执行工具时使用，原地改写不新增快照）。 */
	appendSegments(id: string, segments: MessageSegment[]): Promise<void> {
		return this.enqueue(() => this.doAppendSegments(id, segments));
	}

	private async doAppendSegments(id: string, segments: MessageSegment[]): Promise<void> {
		await this.ensureInit();
		const clean = segments.filter((segment) => segment.content.trim() !== '');
		if (clean.length === 0) {
			return;
		}
		const node = await this.deps.snapshots.getNode(id);
		if (node === undefined) {
			throw new SnapshotError(`快照不存在：${id}`);
		}
		if (node.delta === null || node.delta.kind !== 'message') {
			throw new SnapshotError('只能向消息快照追加分段');
		}
		// 旧消息（无 segments）首次追加时，把原 thinking/content 转成分段，避免展示丢失。
		let existing = node.delta.segments;
		if (existing === undefined || existing.length === 0) {
			existing = [];
			if (node.delta.thinking !== undefined && node.delta.thinking.trim() !== '') {
				existing.push({ kind: 'thinking', content: node.delta.thinking });
			}
			if (node.delta.content.trim() !== '') {
				existing.push({ kind: 'text', content: node.delta.content });
			}
		}
		const updated: SnapshotNode = {
			...node,
			metadata: { ...node.metadata, desc: '追加工具分段' },
			delta: { ...node.delta, segments: [...existing, ...clean] }
		};
		await this.deps.snapshots.updateNode(updated);
		await this.refresh();
	}

	private async doEditMessage(id: string, content: string): Promise<void> {
		await this.ensureInit();
		const trimmed = content.trim();
		if (trimmed === '') {
			throw new StateValidationError('消息内容不能为空');
		}
		const node = await this.deps.snapshots.getNode(id);
		if (node === undefined) {
			throw new SnapshotError(`快照不存在：${id}`);
		}
		if (node.delta === null || node.delta.kind !== 'message') {
			throw new SnapshotError('只能编辑消息快照');
		}
		const delta = node.delta;
		const segments = delta.segments;
		let nextDelta = delta;
		if (segments !== undefined && segments.length > 0) {
			// 分段消息：编辑正文时替换首个 text 段，其余段（思考/工具调用）原样保留。
			const textIndex = segments.findIndex((segment) => segment.kind === 'text');
			const nextSegments = [...segments];
			if (textIndex >= 0) {
				nextSegments[textIndex] = { ...nextSegments[textIndex]!, content: trimmed };
			} else {
				nextSegments.push({ kind: 'text', content: trimmed });
			}
			nextDelta = { ...delta, content: trimmed, segments: nextSegments };
		} else {
			nextDelta = { ...delta, content: trimmed };
		}
		const updated: SnapshotNode = {
			...node,
			metadata: { ...node.metadata, desc: '编辑消息' },
			delta: nextDelta
		};
		await this.deps.snapshots.updateNode(updated);
		await this.refresh();
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

	/**
	 * 工作区导入：写入配置覆盖与 head，然后整体重载（从数据库重建状态与会话）。
	 * 不触碰模型配置（settings.llm），因此不会暴露 API Key。
	 */
	async restoreWorkspace(config: ConfigOverrides, headId: string | null): Promise<void> {
		return this.enqueue(async () => {
			await this.deps.kv.set(CONFIG_OVERRIDES_KEY, config);
			if (headId === null) {
				await this.deps.kv.remove(LAST_HEAD_KEY);
			} else {
				await this.deps.kv.set(LAST_HEAD_KEY, headId);
			}
			await this.resetInternal();
		});
	}

	/**
	 * 独占任务：串行化到变更队列之后执行（工作区切换编排用）。
	 * 保证切换发生时所有 pending 的 update/addMessage/checkout 已按旧工作区落地。
	 * 注意：不在这里 ensureInit——切换任务会在任务体内先切 scope 再 resetInternal，
	 * 提前 init 会把根快照建到旧工作区。
	 */
	runExclusive<T>(task: () => Promise<T>): Promise<T> {
		return this.enqueue(task);
	}

	/**
	 * 重置并重载当前工作区（切换工作区后调用）：清空内存态、丢弃初始化标记，
	 * 重新走 init（空工作区自动建根快照）。供队列内调用；
	 * 外部请经 runExclusive 编排以保证与 pending 变更的顺序。
	 */
	async resetInternal(): Promise<void> {
		this.initialized = false;
		this.initPromise = null;
		this.state = createInitialState();
		this.headId = null;
		this.conversation = [];
		this.snapshots = [];
		this.branches = [];
		this.configOverrides = {};
		await this.init();
	}

	/** 串行化的重置入口（测试与需要队列隔离的调用方用）。 */
	reset(): Promise<void> {
		return this.enqueue(() => this.resetInternal());
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

	/**
	 * 批量删除分支：删除选中的多个分支（每个分支只删除其独有快照，
	 * 分支点与共享前缀保留）。根快照不可删除；删除后必须仍有分支存在；
	 * 当前 head 位于被删分支链上时，自动回退到该分支的分叉点。
	 * @returns 实际删除的快照数量
	 */
	deleteBranches(tipIds: readonly string[]): Promise<number> {
		return this.enqueue(() => this.doDeleteBranches(tipIds));
	}

	private async doDeleteBranches(tipIds: readonly string[]): Promise<number> {
		await this.ensureInit();
		const all = await this.deps.snapshots.getAll();
		const map = new Map(all.map((node) => [node.id, node]));
		const childrenMap = getChildrenMap(all);
		const tips = getBranchTips(all);
		const selected = [...new Set(tipIds)].filter(
			(id) => map.has(id) && (childrenMap.get(id) ?? []).length === 0
		);
		if (selected.length === 0) {
			throw new SnapshotError('没有可删除的分支');
		}
		if (tips.length - selected.length <= 0) {
			throw new SnapshotError('只剩一个分支，不能删除，否则会清空全部聊天记录');
		}
		// 收集各分支独有链的并集（共享前缀与分支点保留）。
		const toDelete = new Set<string>();
		for (const tipId of selected) {
			for (const node of collectBranchPath(childrenMap, map, tipId)) {
				toDelete.add(node.id);
			}
		}
		// head 位于被删分支链上时，回退到该分支的分叉点。
		if (this.headId !== null && toDelete.has(this.headId)) {
			let fallback: SnapshotNode | undefined;
			for (const tipId of selected) {
				const path = collectBranchPath(childrenMap, map, tipId);
				if (path.some((node) => node.id === this.headId)) {
					const forkId = path[path.length - 1]!.parentId;
					fallback = forkId === null ? undefined : map.get(forkId);
					break;
				}
			}
			if (fallback === undefined) {
				throw new SnapshotError('无法确定回退节点，已取消');
			}
			const rebuilt = await this.deps.snapshots.checkout(fallback.id);
			this.headId = fallback.id;
			this.state = rebuilt.state;
			this.conversation = rebuilt.messages;
			await this.persistHead();
		}
		await this.deps.snapshots.removeMany([...toDelete]);
		await this.refresh();
		return toDelete.size;
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
