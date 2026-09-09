import { SnapshotError, StorageError } from '../core/errors';
import { chainToRoot, getBranchTips, rebuildFromNodes, type RebuildResult } from '../core/snapshot';
import { createInitialState } from '../core/state';
import type { BranchSummary, SnapshotDelta, SnapshotMetadata, SnapshotNode } from '../core/types';
import { newId } from '../utils/id';
import type { CosBoxDatabase } from './schema';
import { WorkspaceScope } from './workspace-scope';

/** 新增快照的输入参数。 */
export interface AddSnapshotInput {
	parentId: string | null;
	metadata: SnapshotMetadata;
	delta: SnapshotDelta;
	/** 可选：显式时间戳（测试/导入时用于确定性）。 */
	timestamp?: number;
}

/**
 * 快照仓储：IndexedDB 的读写边界。
 * 所有公开方法都带 try/catch，并把底层异常翻译为用户可读的 StorageError。
 * 多工作区：所有查询按构造时注入的 WorkspaceScope 过滤；
 * 带 `workspaceId` 参数的方法用于读写非当前工作区（导出/复制/删除）。
 */
export class SnapshotRepository {
	constructor(
		private readonly database: CosBoxDatabase,
		private readonly scope: WorkspaceScope = new WorkspaceScope()
	) {}

	/** 追加一个快照节点。父节点必须存在（根除外），否则抛 SnapshotError。 */
	async addSnapshot(input: AddSnapshotInput): Promise<SnapshotNode> {
		const node: SnapshotNode = {
			id: newId(),
			workspaceId: this.scope.get(),
			timestamp: input.timestamp ?? Date.now(),
			parentId: input.parentId,
			metadata: { ...input.metadata },
			delta: input.delta
		};
		try {
			if (node.parentId !== null) {
				const parent = await this.database.snapshots.get(node.parentId);
				if (!parent || parent.workspaceId !== node.workspaceId) {
					throw new SnapshotError(`父快照不存在：${node.parentId}`);
				}
			}
			await this.database.snapshots.add(node);
			return node;
		} catch (err) {
			if (err instanceof SnapshotError) {
				throw err;
			}
			throw new StorageError('写入快照失败', { cause: err });
		}
	}

	/** 按 id 读取节点；不存在或不属于当前工作区返回 undefined。 */
	async getNode(id: string): Promise<SnapshotNode | undefined> {
		try {
			const node = await this.database.snapshots.get(id);
			return node?.workspaceId === this.scope.get() ? node : undefined;
		} catch (err) {
			throw new StorageError('读取快照失败', { cause: err });
		}
	}

	/** 读取当前工作区全部节点。 */
	async getAll(workspaceId = this.scope.get()): Promise<SnapshotNode[]> {
		try {
			return await this.database.snapshots.where('workspaceId').equals(workspaceId).toArray();
		} catch (err) {
			throw new StorageError('读取快照列表失败', { cause: err });
		}
	}

	/** 读取指定父节点的直接子节点（当前工作区内），按时间升序。 */
	async getChildren(parentId: string): Promise<SnapshotNode[]> {
		try {
			const workspaceId = this.scope.get();
			const rows = await this.database.snapshots
				.where('parentId')
				.equals(parentId)
				.and((node) => node.workspaceId === workspaceId)
				.toArray();
			return [...rows].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
		} catch (err) {
			throw new StorageError('读取子快照失败', { cause: err });
		}
	}

	/**
	 * 原地更新一个已存在的快照节点（消息编辑用，类似 git commit --amend）。
	 * 节点 id 不变，版本图中位置不变，后续快照重建时会读到新内容。
	 */
	async updateNode(node: SnapshotNode): Promise<void> {
		try {
			await this.database.snapshots.put(node);
		} catch (err) {
			throw new StorageError('更新快照失败', { cause: err });
		}
	}

	/**
	 * 批量删除快照节点。
	 * 删除前不做完整性校验（逻辑由调用方如 CharacterManager 负责），
	 * 不存在的 id 会被跳过而不会报错。
	 */
	async removeMany(ids: readonly string[]): Promise<void> {
		try {
			await this.database.snapshots.bulkDelete([...ids]);
		} catch (err) {
			throw new StorageError('删除快照失败', { cause: err });
		}
	}

	/** 统计当前工作区快照数量。 */
	async count(workspaceId = this.scope.get()): Promise<number> {
		try {
			return await this.database.snapshots.where('workspaceId').equals(workspaceId).count();
		} catch (err) {
			throw new StorageError('统计快照失败', { cause: err });
		}
	}

	/** 清空当前工作区快照（工作区导入前重置）。 */
	async clearAll(workspaceId = this.scope.get()): Promise<void> {
		try {
			await this.database.snapshots.where('workspaceId').equals(workspaceId).delete();
		} catch (err) {
			throw new StorageError('清空快照失败', { cause: err });
		}
	}

	/** 批量写入快照节点（工作区导入/复制，保留原始 id，统一盖章 workspaceId）。 */
	async bulkAdd(nodes: readonly SnapshotNode[], workspaceId = this.scope.get()): Promise<void> {
		try {
			await this.database.snapshots.bulkAdd(nodes.map((node) => ({ ...node, workspaceId })));
		} catch (err) {
			throw new StorageError('导入快照失败', { cause: err });
		}
	}

	/** 计算当前全部分支 tip。 */
	async getBranches(workspaceId = this.scope.get()): Promise<BranchSummary[]> {
		// getAll 已把底层异常翻译为 StorageError，这里不再重复包装。
		return getBranchTips(await this.getAll(workspaceId));
	}

	/**
	 * 从目标快照重建完整状态与消息序列。
	 * 目标不存在时抛 SnapshotError。
	 */
	async rebuildState(targetId: string): Promise<RebuildResult> {
		const nodes = await this.getAll();
		const map = new Map(nodes.map((node) => [node.id, node]));
		// 先验证目标存在，再重建，确保错误信息准确。
		if (!map.has(targetId)) {
			throw new SnapshotError(`快照不存在：${targetId}`);
		}
		return rebuildFromNodes(map, targetId, createInitialState());
	}

	/**
	 * checkout：切换到目标快照并重建状态。
	 * 语义上为纯读操作——绝不写入快照表，保证「切换分支无副作用」。
	 */
	async checkout(targetId: string): Promise<RebuildResult> {
		return this.rebuildState(targetId);
	}

	/** 返回某节点的完整祖先链（根 -> 节点），供调试与测试。 */
	async chainOf(targetId: string): Promise<SnapshotNode[]> {
		const nodes = await this.getAll();
		return chainToRoot(new Map(nodes.map((node) => [node.id, node])), targetId);
	}
}
