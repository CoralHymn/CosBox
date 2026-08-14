import { WorkspaceError } from '../core/errors';
import type { KvRepository } from '../db/kv-repo';
import { createWorkspaceKv } from '../db/scoped-kv';
import { DEFAULT_WORKSPACE_ID } from '../db/workspace-scope';
import { newId } from '../utils/id';
import type { WorkspaceMeta } from './types';

/** kv 中保存的工作区注册表（应用级键）。 */
const LIST_KEY = 'workspaces.list';
/** kv 中保存的「上次进入的工作区 id」（应用级键）。 */
const CURRENT_KEY = 'workspaces.current';

/**
 * 需要从旧裸键迁移到 `ws:{id}:` 前缀的工作区级键（首启迁移用）。
 * 应用级键（settings.llm / settings.sync / settings.theme / metrics.v1）不在此列。
 */
const LEGACY_WORKSPACE_KEYS = [
	'settings.profile',
	'settings.developer',
	'lastHeadId',
	'config.overrides',
	'sync.lastUpdatedAt',
	'context.usage'
];

/**
 * 工作区注册表：工作区元信息列表与「上次进入的工作区」的持久化封装。
 * 框架无关；UI 通过 subscribe 感知列表变化。
 */
export class WorkspaceRegistry {
	private metas: WorkspaceMeta[] = [];
	private current: string | null = null;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly kv: KvRepository) {}

	/** 全部工作区，最近使用的在前。 */
	getWorkspaces(): WorkspaceMeta[] {
		return [...this.metas].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** 按 id 查元信息。 */
	getById(id: string): WorkspaceMeta | undefined {
		return this.metas.find((meta) => meta.id === id);
	}

	/** 上次进入的工作区 id（从未进入过为 null）。 */
	getCurrentId(): string | null {
		return this.current;
	}

	/** 从 kv 加载注册表。 */
	async load(): Promise<void> {
		this.metas = (await this.kv.get<WorkspaceMeta[]>(LIST_KEY)) ?? [];
		const saved = (await this.kv.get<string>(CURRENT_KEY)) ?? null;
		this.current = saved !== null && this.metas.some((meta) => meta.id === saved) ? saved : null;
		this.emit();
	}

	/**
	 * 首启迁移（幂等）：注册表缺失时创建默认工作区，
	 * 并把旧裸键搬到 `ws:default:` 前缀后删除旧键。
	 * 已有注册表时直接返回（不重复迁移）。
	 */
	async migrateLegacy(): Promise<void> {
		const existing = await this.kv.get<WorkspaceMeta[]>(LIST_KEY);
		if (existing !== undefined) {
			return;
		}
		const scoped = createWorkspaceKv(this.kv, DEFAULT_WORKSPACE_ID);
		for (const key of LEGACY_WORKSPACE_KEYS) {
			const value = await this.kv.get(key);
			if (value !== undefined) {
				await scoped.set(key, value);
				await this.kv.remove(key);
			}
		}
		const now = Date.now();
		const meta: WorkspaceMeta = {
			id: DEFAULT_WORKSPACE_ID,
			name: '默认工作区',
			createdAt: now,
			updatedAt: now
		};
		this.metas = [meta];
		this.current = meta.id;
		await this.persist();
		this.emit();
	}

	/** 新建工作区（只登记元信息，数据由 service 编排）；名称非空且不重复。 */
	async create(name: string): Promise<WorkspaceMeta> {
		const trimmed = name.trim();
		if (trimmed === '') {
			throw new WorkspaceError('工作区名称不能为空');
		}
		if (this.metas.some((meta) => meta.name === trimmed)) {
			throw new WorkspaceError('已存在同名工作区');
		}
		const now = Date.now();
		const meta: WorkspaceMeta = { id: newId(), name: trimmed, createdAt: now, updatedAt: now };
		this.metas = [...this.metas, meta];
		await this.persist();
		this.emit();
		return meta;
	}

	/** 重命名工作区（同样的非空且不重复约束）。 */
	async rename(id: string, name: string): Promise<void> {
		const trimmed = name.trim();
		if (trimmed === '') {
			throw new WorkspaceError('工作区名称不能为空');
		}
		const target = this.metas.find((meta) => meta.id === id);
		if (target === undefined) {
			throw new WorkspaceError('工作区不存在');
		}
		if (this.metas.some((meta) => meta.name === trimmed && meta.id !== id)) {
			throw new WorkspaceError('已存在同名工作区');
		}
		if (target.name === trimmed) {
			return;
		}
		this.metas = this.metas.map((meta) => (meta.id === id ? { ...meta, name: trimmed } : meta));
		await this.persist();
		this.emit();
	}

	/** 注销工作区（只删注册项；数据清理由 service 负责，且不得删除最后一个）。 */
	async remove(id: string): Promise<void> {
		if (!this.metas.some((meta) => meta.id === id)) {
			throw new WorkspaceError('工作区不存在');
		}
		if (this.metas.length <= 1) {
			throw new WorkspaceError('至少保留一个工作区');
		}
		const wasCurrent = this.current === id;
		this.metas = this.metas.filter((meta) => meta.id !== id);
		if (wasCurrent) {
			this.current = this.metas[0]?.id ?? null;
		}
		await this.persist();
		this.emit();
	}

	/** 记录「上次进入的工作区」。 */
	async setCurrent(id: string): Promise<void> {
		if (!this.metas.some((meta) => meta.id === id)) {
			throw new WorkspaceError('工作区不存在');
		}
		if (this.current === id) {
			return;
		}
		this.current = id;
		await this.persist();
		this.emit();
	}

	/** 更新最近使用时间（进入/切换时调用，驱动列表排序）。 */
	async touch(id: string): Promise<void> {
		const target = this.metas.find((meta) => meta.id === id);
		if (target === undefined) {
			return;
		}
		this.metas = this.metas.map((meta) =>
			meta.id === id ? { ...meta, updatedAt: Date.now() } : meta
		);
		await this.persist();
		this.emit();
	}

	/** 订阅注册表变化，返回取消订阅函数。 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private async persist(): Promise<void> {
		await this.kv.set(LIST_KEY, this.metas);
		if (this.current === null) {
			await this.kv.remove(CURRENT_KEY);
		} else {
			await this.kv.set(CURRENT_KEY, this.current);
		}
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
