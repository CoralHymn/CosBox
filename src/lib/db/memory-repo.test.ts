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
		expect(await repo.getAll()).toEqual([memory('m1')]);
	});

	it('bulkPut 批量写入', async () => {
		await repo.bulkPut([memory('a'), memory('b')]);
		expect(await repo.getAll()).toHaveLength(2);
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
