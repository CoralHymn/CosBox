import { WorkspaceError } from '../core/errors';
import type { ConfigOverrides, SnapshotNode } from '../core/types';
import type { KvRepository } from '../db/kv-repo';
import { createWorkspaceKv, workspaceKvPrefix } from '../db/scoped-kv';
import type { SnapshotRepository } from '../db/snapshot-repo';
import type { MemoryRepository } from '../db/memory-repo';
import type { WorldInfoRepository } from '../db/world-info-repo';
import { WorkspaceScope } from '../db/workspace-scope';
import type { WorkspaceData } from '../import-export/workspace';
import { serializeWorkspace } from '../import-export/workspace';
import type { CharacterManager } from '../manager/character-manager';
import { DEFAULT_PROFILE, type AppProfile } from '../stores/settings.svelte';
import { newId } from '../utils/id';
import type { WorkspaceMeta } from './types';
import { WorkspaceRegistry } from './workspace-registry';

/** 工作区级 kv 键（复制工作区时逐键搬迁；均不含 id 引用或 id 引用已 remap）。 */
const COPYABLE_SCOPED_KEYS = [
	'settings.profile',
	'settings.developer',
	'config.overrides'
] as const;

/** 工作区服务依赖：注册表、scope、各仓储与角色管理器。 */
export interface WorkspaceServiceDeps {
	registry: WorkspaceRegistry;
	scope: WorkspaceScope;
	snapshots: SnapshotRepository;
	worldInfo: WorldInfoRepository;
	memories: MemoryRepository;
	kv: KvRepository;
	manager: CharacterManager;
	/** 切换完成后由宿主执行的重载钩子（stores 重载、瞬态重置、同步重装）。 */
	onSwitched?: () => Promise<void>;
}

/**
 * 工作区编排服务：切换、创建、复制、删除、导入为新工作区、
 * 数据收集与 .cbox 导出。所有跨仓储操作在这里串行编排，
 * 切换经 CharacterManager.runExclusive 保证与 pending 变更有序。
 */
export class WorkspaceService {
	constructor(private readonly deps: WorkspaceServiceDeps) {}

	/** 进入/切换工作区：先落 current，再切 scope、重置 manager，最后触发宿主重载。 */
	async switchTo(id: string): Promise<void> {
		if (this.deps.registry.getById(id) === undefined) {
			throw new WorkspaceError('工作区不存在');
		}
		await this.deps.manager.runExclusive(async () => {
			await this.deps.registry.setCurrent(id);
			this.deps.scope.set(id);
			await this.deps.manager.resetInternal();
		});
		await this.deps.registry.touch(id);
		if (this.deps.onSwitched !== undefined) {
			await this.deps.onSwitched();
		}
	}

	/** 新建空工作区并切换过去（空工作区由 manager 重载时自动建根快照）。 */
	async createWorkspace(name: string): Promise<WorkspaceMeta> {
		const meta = await this.deps.registry.create(name);
		try {
			await this.switchTo(meta.id);
			return meta;
		} catch (err) {
			await this.deps.registry.remove(meta.id);
			throw err;
		}
	}

	/**
	 * 复制工作区：快照/世界书/记忆全部 remap id 后写入新分区，
	 * 作用域 kv 逐键搬迁（head 经 id 映射改写），最后切换过去。
	 * 副本名自动去重（`xx 副本`、`xx 副本 2`…）。
	 */
	async duplicateWorkspace(sourceId: string, newName: string): Promise<WorkspaceMeta> {
		const source = this.deps.registry.getById(sourceId);
		if (source === undefined) {
			throw new WorkspaceError('工作区不存在');
		}
		const meta = await this.deps.registry.create(
			uniqueWorkspaceName(this.deps.registry, newName.trim() || `${source.name} 副本`)
		);
		// 副本沿用源工作区的自定义头像（元信息层面的轻量搬迁）。
		if (source.avatar !== undefined) {
			await this.deps.registry.patch(meta.id, { avatar: source.avatar });
		}
		try {
			const sourceNodes = await this.deps.snapshots.getAll(sourceId);
			const idMap = buildIdMap(sourceNodes);
			const nodes = sourceNodes.map((node) => remapNode(node, idMap, idMap.get(node.id)!));
			await this.deps.snapshots.bulkAdd(nodes, meta.id);

			const worldInfo = (await this.deps.worldInfo.getAll(sourceId)).map((entry) => ({
				...entry,
				id: newId()
			}));
			await this.deps.worldInfo.bulkPut(worldInfo, meta.id);

			const memories = (await this.deps.memories.getAll(sourceId)).map((entry) => ({
				...entry,
				id: newId()
			}));
			await this.deps.memories.bulkPut(memories, meta.id);

			const sourceKv = createWorkspaceKv(this.deps.kv, sourceId);
			const targetKv = createWorkspaceKv(this.deps.kv, meta.id);
			for (const key of COPYABLE_SCOPED_KEYS) {
				const value = await sourceKv.get(key);
				if (value !== undefined) {
					await targetKv.set(key, value);
				}
			}
			const headId = await sourceKv.get<string>('lastHeadId');
			if (headId !== undefined && headId !== null) {
				await targetKv.set('lastHeadId', idMap.get(headId) ?? headId);
			}
			await this.switchTo(meta.id);
			return meta;
		} catch (err) {
			// 回滚：清掉已写入的新工作区数据与注册项。
			await this.cleanupWorkspaceData(meta.id);
			await this.deps.registry.remove(meta.id);
			throw err;
		}
	}

	/** 删除工作区（不得删除最后一个；删除当前工作区先切走）。 */
	async removeWorkspace(id: string): Promise<void> {
		if (this.deps.registry.getById(id) === undefined) {
			throw new WorkspaceError('工作区不存在');
		}
		const others = this.deps.registry.getWorkspaces().filter((meta) => meta.id !== id);
		if (others.length === 0) {
			throw new WorkspaceError('至少保留一个工作区');
		}
		if (this.deps.registry.getCurrentId() === id) {
			await this.switchTo(others[0]!.id);
		}
		await this.cleanupWorkspaceData(id);
		await this.deps.registry.remove(id);
	}

	/** 解析后的 .cbox 数据导入为新工作区（全部 id remap，名称优先取传入值并自动去重）。 */
	async importAsNewWorkspace(data: WorkspaceData, name?: string): Promise<WorkspaceMeta> {
		const base = name?.trim() || data.workspaceName?.trim() || '导入的工作区';
		const meta = await this.deps.registry.create(uniqueWorkspaceName(this.deps.registry, base));
		try {
			const idMap = buildIdMap(data.snapshots);
			const nodes = data.snapshots.map((node) => remapNode(node, idMap, idMap.get(node.id)!));
			await this.deps.snapshots.bulkAdd(nodes, meta.id);
			await this.deps.worldInfo.bulkPut(
				data.worldInfo.map((entry) => ({ ...entry, id: newId() })),
				meta.id
			);
			await this.deps.memories.bulkPut(
				data.memories.map((entry) => ({ ...entry, id: newId() })),
				meta.id
			);
			const targetKv = createWorkspaceKv(this.deps.kv, meta.id);
			await targetKv.set('settings.profile', data.profile);
			await targetKv.set('settings.developer', data.developerMode);
			await targetKv.set('config.overrides', data.config);
			if (data.headId !== null) {
				await targetKv.set('lastHeadId', idMap.get(data.headId) ?? data.headId);
			}
			await this.switchTo(meta.id);
			return meta;
		} catch (err) {
			await this.cleanupWorkspaceData(meta.id);
			await this.deps.registry.remove(meta.id);
			throw err;
		}
	}

	/** 收集指定工作区的完整数据（不含模型配置与 Key，供导出与远程同步复用）。 */
	async collectWorkspaceData(workspaceId: string): Promise<WorkspaceData> {
		const [snapshots, worldInfo, memories] = await Promise.all([
			this.deps.snapshots.getAll(workspaceId),
			this.deps.worldInfo.getAll(workspaceId),
			this.deps.memories.getAll(workspaceId)
		]);
		const scoped = createWorkspaceKv(this.deps.kv, workspaceId);
		const profile = (await scoped.get<AppProfile>('settings.profile')) ?? { ...DEFAULT_PROFILE };
		const developerMode = (await scoped.get<boolean>('settings.developer')) ?? false;
		const config = (await scoped.get<ConfigOverrides>('config.overrides')) ?? {};
		const headId = (await scoped.get<string>('lastHeadId')) ?? null;
		const meta = this.deps.registry.getById(workspaceId);
		return {
			profile,
			developerMode,
			worldInfo,
			memories,
			config,
			headId,
			snapshots,
			...(meta !== undefined ? { workspaceName: meta.name } : {})
		};
	}

	/** 导出指定工作区为 .cbox（ZIP）字节。 */
	async exportWorkspace(workspaceId: string): Promise<Uint8Array> {
		return serializeWorkspace(await this.collectWorkspaceData(workspaceId));
	}

	/** 清理某工作区的全部数据（三表分区 + 作用域 kv），不动注册表。 */
	private async cleanupWorkspaceData(id: string): Promise<void> {
		await this.deps.snapshots.clearAll(id);
		await this.deps.worldInfo.clear(id);
		await this.deps.memories.clear(id);
		await this.deps.kv.removeByPrefix(workspaceKvPrefix(id));
	}
}

/** 为一批节点生成全新 id 映射（旧 id → 新 id）。 */
function buildIdMap(nodes: ReadonlyArray<{ id: string }>): Map<string, string> {
	const idMap = new Map<string, string>();
	for (const node of nodes) {
		idMap.set(node.id, newId());
	}
	return idMap;
}

/** 在注册表中为 base 名找不冲突的名称（冲突时追加 ` 2`、` 3`…）。 */
function uniqueWorkspaceName(registry: WorkspaceRegistry, base: string): string {
	const taken = new Set(registry.getWorkspaces().map((meta) => meta.name));
	if (!taken.has(base)) {
		return base;
	}
	let suffix = 2;
	while (taken.has(`${base} ${suffix}`)) {
		suffix += 1;
	}
	return `${base} ${suffix}`;
}

/** remap 快照节点：换新 id 并按映射改写 parentId（映射缺失时保守保留）。 */
function remapNode(node: SnapshotNode, idMap: Map<string, string>, nextId: string): SnapshotNode {
	return {
		...node,
		id: nextId,
		parentId: node.parentId === null ? null : (idMap.get(node.parentId) ?? node.parentId),
		workspaceId: undefined
	};
}
