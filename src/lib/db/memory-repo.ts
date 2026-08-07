import { StorageError } from '../core/errors';
import { clonePlain } from '../core/clone';
import type { MemoryEntry } from '../memory/types';
import type { CosBoxDatabase } from './schema';

/**
 * 长期记忆仓储：记忆条目的持久化（Dexie/IndexedDB）。
 * 召回与注入逻辑见 memory/recall.ts，提取逻辑见 memory/extract.ts。
 */
export class MemoryRepository {
	constructor(private readonly database: CosBoxDatabase) {}

	/** 读取全部记忆条目。 */
	async getAll(): Promise<MemoryEntry[]> {
		try {
			return await this.database.memories.toArray();
		} catch (err) {
			throw new StorageError('读取记忆失败', { cause: err });
		}
	}

	/** 写入（新增或整体替换）一条记忆。 */
	async upsert(entry: MemoryEntry): Promise<void> {
		try {
			// Svelte 5 $state 代理无法被 IndexedDB structuredClone（DataCloneError），
			// 在 DB 边界统一深拷贝兜底（与 kv-repo 一致）。
			await this.database.memories.put(clonePlain(entry));
		} catch (err) {
			throw new StorageError('保存记忆失败', { cause: err });
		}
	}

	/** 批量写入（AI 提取后一键导入）。 */
	async bulkPut(entries: ReadonlyArray<MemoryEntry>): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		try {
			await this.database.memories.bulkPut(entries.map((entry) => clonePlain(entry)));
		} catch (err) {
			throw new StorageError('批量保存记忆失败', { cause: err });
		}
	}

	/** 按 id 删除。 */
	async remove(id: string): Promise<void> {
		try {
			await this.database.memories.delete(id);
		} catch (err) {
			throw new StorageError('删除记忆失败', { cause: err });
		}
	}

	/** 清空全部记忆（导入前重置等场景）。 */
	async clear(): Promise<void> {
		try {
			await this.database.memories.clear();
		} catch (err) {
			throw new StorageError('清空记忆失败', { cause: err });
		}
	}
}
