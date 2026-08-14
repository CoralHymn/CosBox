import { StorageError } from '../core/errors';
import { clonePlain } from '../core/clone';
import type { KvRecord, CosBoxDatabase } from './schema';

/**
 * 应用键值仓储：设置、上次 checkout 的 head 等轻量元数据。
 */
export class KvRepository {
	constructor(private readonly database: CosBoxDatabase) {}

	/** 读取值；键不存在返回 undefined。 */
	async get<T>(key: string): Promise<T | undefined> {
		try {
			const record = await this.database.kv.get(key);
			return record?.value as T | undefined;
		} catch (err) {
			throw new StorageError(`读取设置失败：${key}`, { cause: err });
		}
	}

	/** 写入值（upsert）。 */
	async set<T>(key: string, value: T): Promise<void> {
		try {
			// 用普通副本写入：Svelte 5 的 $state 响应式代理无法被 IndexedDB
			// structuredClone（会抛 DataCloneError），统一在边界克隆兜底。
			await this.database.kv.put({ key, value: clonePlain(value) });
		} catch (err) {
			throw new StorageError(`保存设置失败：${key}`, { cause: err });
		}
	}

	/** 删除键。 */
	async remove(key: string): Promise<void> {
		try {
			await this.database.kv.delete(key);
		} catch (err) {
			throw new StorageError(`删除设置失败：${key}`, { cause: err });
		}
	}

	/** 读取全部记录。 */
	async getAll(): Promise<KvRecord[]> {
		try {
			return await this.database.kv.toArray();
		} catch (err) {
			throw new StorageError('读取全部设置失败', { cause: err });
		}
	}

	/** 读取指定前缀的全部记录（删除工作区时清理 `ws:{id}:*` 用）。 */
	async getAllWithPrefix(prefix: string): Promise<KvRecord[]> {
		try {
			return await this.database.kv.where('key').startsWith(prefix).toArray();
		} catch (err) {
			throw new StorageError('按前缀读取设置失败', { cause: err });
		}
	}

	/** 删除指定前缀的全部键（删除工作区时清理 `ws:{id}:*`）。 */
	async removeByPrefix(prefix: string): Promise<void> {
		try {
			await this.database.kv.where('key').startsWith(prefix).delete();
		} catch (err) {
			throw new StorageError('按前缀删除设置失败', { cause: err });
		}
	}
}
