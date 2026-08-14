import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageError } from '../core/errors';
import { CosBoxDatabase } from './schema';
import { WorldInfoRepository } from './world-info-repo';

function entry(id: string) {
	return { id, keys: ['k'], content: 'c', enabled: true, priority: 1 };
}

describe('WorldInfoRepository', () => {
	let db: CosBoxDatabase;
	let repo: WorldInfoRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-wi-${Math.random().toString(36).slice(2)}`);
		repo = new WorldInfoRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('upsert 新增与整体替换', async () => {
		await repo.upsert(entry('a'));
		await repo.upsert({ ...entry('a'), content: '更新' });
		const all = await repo.getAll();
		expect(all).toHaveLength(1);
		expect(all[0]!.content).toBe('更新');
	});

	it('remove 按 id 删除', async () => {
		await repo.upsert(entry('a'));
		await repo.remove('a');
		expect(await repo.getAll()).toEqual([]);
	});

	it('clear 清空', async () => {
		await repo.upsert(entry('a'));
		await repo.clear();
		expect(await repo.getAll()).toEqual([]);
	});

	it('bulkPut 批量写入并统一盖章；空数组为无操作', async () => {
		await repo.bulkPut([]);
		expect(await repo.getAll()).toEqual([]);
		await repo.bulkPut([entry('a'), entry('b')]);
		const all = await repo.getAll();
		expect(all.map((item) => item.id).sort()).toEqual(['a', 'b']);
		expect(all.map((item) => item.workspaceId)).toEqual(['default', 'default']);
	});

	it('bulkPut 指定工作区写入，作用域读不到但显式读可读', async () => {
		await repo.bulkPut([entry('a')], 'ws-x');
		expect(await repo.getAll()).toEqual([]);
		expect((await repo.getAll('ws-x')).map((item) => item.id)).toEqual(['a']);
		expect((await repo.getAll('ws-x'))[0]!.workspaceId).toBe('ws-x');
	});

	it('数据库关闭后操作抛 StorageError', async () => {
		await db.close();
		await expect(repo.getAll()).rejects.toThrow(StorageError);
		await expect(repo.upsert(entry('a'))).rejects.toThrow(StorageError);
		await expect(repo.bulkPut([entry('a')])).rejects.toThrow(StorageError);
		await expect(repo.remove('a')).rejects.toThrow(StorageError);
		await expect(repo.clear()).rejects.toThrow(StorageError);
	});
});
