import { StorageError } from '../core/errors';
import type { WorldInfoEntry } from '../core/types';
import type { CosBoxDatabase } from './schema';
import { WorkspaceScope } from './workspace-scope';

/**
 * 世界信息仓储：关键词触发式设定条目的持久化。
 * 多工作区：所有读写按 WorkspaceScope 过滤并在写入时统一盖章 workspaceId；
 * 带 `workspaceId` 参数的方法用于读写非当前工作区（导出/复制/删除）。
 */
export class WorldInfoRepository {
	constructor(
		private readonly database: CosBoxDatabase,
		private readonly scope: WorkspaceScope = new WorkspaceScope()
	) {}

	/** 读取全部条目。 */
	async getAll(workspaceId = this.scope.get()): Promise<WorldInfoEntry[]> {
		try {
			return await this.database.worldInfo.where('workspaceId').equals(workspaceId).toArray();
		} catch (err) {
			throw new StorageError('读取世界信息失败', { cause: err });
		}
	}

	/** 写入（新增或整体替换）一条。 */
	async upsert(entry: WorldInfoEntry): Promise<void> {
		try {
			await this.database.worldInfo.put({ ...entry, workspaceId: this.scope.get() });
		} catch (err) {
			throw new StorageError('保存世界信息失败', { cause: err });
		}
	}

	/** 批量写入（工作区导入/复制，统一盖章 workspaceId）。 */
	async bulkPut(entries: readonly WorldInfoEntry[], workspaceId = this.scope.get()): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		try {
			await this.database.worldInfo.bulkPut(entries.map((entry) => ({ ...entry, workspaceId })));
		} catch (err) {
			throw new StorageError('批量保存世界信息失败', { cause: err });
		}
	}

	/** 按 id 删除。 */
	async remove(id: string): Promise<void> {
		try {
			await this.database.worldInfo.delete(id);
		} catch (err) {
			throw new StorageError('删除世界信息失败', { cause: err });
		}
	}

	/** 清空全部条目（导入前重置用）。 */
	async clear(workspaceId = this.scope.get()): Promise<void> {
		try {
			await this.database.worldInfo.where('workspaceId').equals(workspaceId).delete();
		} catch (err) {
			throw new StorageError('清空世界信息失败', { cause: err });
		}
	}
}
