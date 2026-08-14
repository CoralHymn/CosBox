import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageError } from '../core/errors';
import type { MemoryEntry } from '../memory/types';
import { MemoryRepository } from './memory-repo';
import { CosBoxDatabase } from './schema';

function memory(id: string): MemoryEntry {
	return {
		id,
		content: `记忆${id}`,
		category: '其他',
		keywords: ['x'],
		importance: 3,
		pinned: false,
		source: 'manual',
		createdAt: 1,
		updatedAt: 1,
		lastUsedAt: 0,
		useCount: 0
	};
}

describe('MemoryRepository', () => {
	let db: CosBoxDatabase;
	let repo: MemoryRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-memory-${Math.random().toString(36).slice(2)}`);
		repo = new MemoryRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('初始为空，upsert 后可读回', async () => {
		expect(await repo.getAll()).toEqual([]);
		await repo.upsert(memory('m1'));
		expect(await repo.getAll()).toEqual([{ ...memory('m1'), workspaceId: 'default' }]);
	});

	it('bulkPut 批量写入', async () => {
		await repo.bulkPut([memory('a'), memory('b')]);
		expect(await repo.getAll()).toHaveLength(2);
	});

	it('upsert 兼容 Svelte 响应式代理值（structuredClone 兜底）', async () => {
		const entry = memory('m-proxy');
		entry.keywords = new Proxy(['打雷'], {});
		await repo.upsert(entry);
		const stored = await repo.getAll();
		expect(stored[0]!.keywords).toEqual(['打雷']);
	});

	it('bulkPut 兼容 Svelte 响应式代理值', async () => {
		const entry = memory('m-bulk-proxy');
		entry.keywords = new Proxy(['怕雷'], {});
		await repo.bulkPut([entry]);
		const stored = await repo.getAll();
		expect(stored[0]!.keywords).toEqual(['怕雷']);
	});

	it('bulkPut 空数组为无操作', async () => {
		await repo.bulkPut([]);
		expect(await repo.getAll()).toEqual([]);
	});

	it('remove 删除单条', async () => {
		await repo.upsert(memory('a'));
		await repo.upsert(memory('b'));
		await repo.remove('a');
		expect((await repo.getAll()).map((item) => item.id)).toEqual(['b']);
	});

	it('clear 清空全部', async () => {
		await repo.bulkPut([memory('a'), memory('b')]);
		await repo.clear();
		expect(await repo.getAll()).toEqual([]);
	});

	it('数据库关闭后所有操作抛 StorageError（用户可见错误）', async () => {
		await db.close();
		await expect(repo.getAll()).rejects.toThrow(StorageError);
		await expect(repo.upsert(memory('m'))).rejects.toThrow(StorageError);
		await expect(repo.bulkPut([memory('m')])).rejects.toThrow(StorageError);
		await expect(repo.remove('m')).rejects.toThrow(StorageError);
		await expect(repo.clear()).rejects.toThrow(StorageError);
	});
});
