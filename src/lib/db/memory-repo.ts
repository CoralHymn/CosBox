import { StorageError } from '../core/errors';
import { clonePlain } from '../core/clone';
import type { MemoryEntry } from '../memory/types';
import type { CosBoxDatabase } from './schema';
import { WorkspaceScope } from './workspace-scope';

/**
 * 长期记忆仓储：记忆条目的持久化（Dexie/IndexedDB）。
 * 召回与注入逻辑见 memory/recall.ts，提取逻辑见 memory/extract.ts。
 * 多工作区：所有读写按 WorkspaceScope 过滤并在写入时统一盖章 workspaceId；
 * 带 `workspaceId` 参数的方法用于读写非当前工作区（导出/复制/删除）。
 */
export class MemoryRepository {
	constructor(
		private readonly database: CosBoxDatabase,
		private readonly scope: WorkspaceScope = new WorkspaceScope()
	) {}

	/** 读取全部记忆条目。 */
	async getAll(workspaceId = this.scope.get()): Promise<MemoryEntry[]> {
		try {
			return await this.database.memories.where('workspaceId').equals(workspaceId).toArray();
		} catch (err) {
			throw new StorageError('读取记忆失败', { cause: err });
		}
	}

	/** 写入（新增或整体替换）一条记忆。 */
	async upsert(entry: MemoryEntry): Promise<void> {
		try {
			// Svelte 5 $state 代理无法被 IndexedDB structuredClone（DataCloneError），
			// 在 DB 边界统一深拷贝兜底（与 kv-repo 一致）。
			await this.database.memories.put(clonePlain({ ...entry, workspaceId: this.scope.get() }));
		} catch (err) {
			throw new StorageError('保存记忆失败', { cause: err });
		}
	}

	/** 批量写入（AI 提取后一键导入 / 工作区导入复制，统一盖章 workspaceId）。 */
	async bulkPut(
		entries: ReadonlyArray<MemoryEntry>,
		workspaceId = this.scope.get()
	): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		try {
			await this.database.memories.bulkPut(
				entries.map((entry) => clonePlain({ ...entry, workspaceId }))
			);
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
	async clear(workspaceId = this.scope.get()): Promise<void> {
		try {
			await this.database.memories.where('workspaceId').equals(workspaceId).delete();
		} catch (err) {
			throw new StorageError('清空记忆失败', { cause: err });
		}
	}
}
