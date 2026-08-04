import { StorageError } from '../core/errors';
import type { WorldInfoEntry } from '../core/types';
import type { CosBoxDatabase } from './schema';

/**
 * 世界信息仓储：关键词触发式设定条目的持久化。
 */
export class WorldInfoRepository {
	constructor(private readonly database: CosBoxDatabase) {}

	/** 读取全部条目。 */
	async getAll(): Promise<WorldInfoEntry[]> {
		try {
			return await this.database.worldInfo.toArray();
		} catch (err) {
			throw new StorageError('读取世界信息失败', { cause: err });
		}
	}

	/** 写入（新增或整体替换）一条。 */
	async upsert(entry: WorldInfoEntry): Promise<void> {
		try {
			await this.database.worldInfo.put(entry);
		} catch (err) {
			throw new StorageError('保存世界信息失败', { cause: err });
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
	async clear(): Promise<void> {
		try {
			await this.database.worldInfo.clear();
		} catch (err) {
			throw new StorageError('清空世界信息失败', { cause: err });
		}
	}
}
