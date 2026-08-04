import { SnapshotError, StorageError } from '../core/errors';
import { chainToRoot, getBranchTips, rebuildFromNodes, type RebuildResult } from '../core/snapshot';
import { createInitialState } from '../core/state';
import type { BranchSummary, SnapshotDelta, SnapshotMetadata, SnapshotNode } from '../core/types';
import { newId } from '../utils/id';
import type { CosBoxDatabase } from './schema';

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
 */
export class SnapshotRepository {
	constructor(private readonly database: CosBoxDatabase) {}

	/** 追加一个快照节点。父节点必须存在（根除外），否则抛 SnapshotError。 */
	async addSnapshot(input: AddSnapshotInput): Promise<SnapshotNode> {
		const node: SnapshotNode = {
			id: newId(),
			timestamp: input.timestamp ?? Date.now(),
			parentId: input.parentId,
			metadata: { ...input.metadata },
			delta: input.delta
		};
		try {
			if (node.parentId !== null) {
				const parent = await this.database.snapshots.get(node.parentId);
				if (!parent) {
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

	/** 按 id 读取节点；不存在返回 undefined。 */
	async getNode(id: string): Promise<SnapshotNode | undefined> {
		try {
			return await this.database.snapshots.get(id);
		} catch (err) {
			throw new StorageError('读取快照失败', { cause: err });
		}
	}

	/** 读取全部节点。 */
	async getAll(): Promise<SnapshotNode[]> {
		try {
			return await this.database.snapshots.toArray();
		} catch (err) {
			throw new StorageError('读取快照列表失败', { cause: err });
		}
	}

	/** 读取指定父节点的直接子节点，按时间升序。 */
	async getChildren(parentId: string): Promise<SnapshotNode[]> {
		try {
			const rows = await this.database.snapshots.where('parentId').equals(parentId).toArray();
			return [...rows].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
		} catch (err) {
			throw new StorageError('读取子快照失败', { cause: err });
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

	/** 统计快照数量。 */
	async count(): Promise<number> {
		try {
			return await this.database.snapshots.count();
		} catch (err) {
			throw new StorageError('统计快照失败', { cause: err });
		}
	}

	/** 计算当前全部分支 tip。 */
	async getBranches(): Promise<BranchSummary[]> {
		// getAll 已把底层异常翻译为 StorageError，这里不再重复包装。
		return getBranchTips(await this.getAll());
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
