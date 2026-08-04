import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageError } from '../core/errors';
import { KvRepository } from './kv-repo';
import { CosBoxDatabase } from './schema';

describe('KvRepository', () => {
	let db: CosBoxDatabase;
	let repo: KvRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-kv-${Math.random().toString(36).slice(2)}`);
		repo = new KvRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('未设置的键返回 undefined', async () => {
		expect(await repo.get('missing')).toBeUndefined();
	});

	it('set/get 往返保持类型', async () => {
		await repo.set('theme', { dark: true, level: 3 });
		expect(await repo.get<{ dark: boolean; level: number }>('theme')).toEqual({
			dark: true,
			level: 3
		});
	});

	it('set 覆盖旧值', async () => {
		await repo.set('k', 1);
		await repo.set('k', 2);
		expect(await repo.get<number>('k')).toBe(2);
	});

	it('remove 删除键', async () => {
		await repo.set('k', 'v');
		await repo.remove('k');
		expect(await repo.get('k')).toBeUndefined();
	});

	it('getAll 返回全部记录', async () => {
		await repo.set('a', 1);
		await repo.set('b', 'x');
		const all = await repo.getAll();
		expect(all).toHaveLength(2);
		expect(all.map((r) => r.key).sort()).toEqual(['a', 'b']);
	});

	it('数据库关闭后操作抛 StorageError', async () => {
		await db.close();
		await expect(repo.get('x')).rejects.toThrow(StorageError);
		await expect(repo.set('x', 1)).rejects.toThrow(StorageError);
		await expect(repo.remove('x')).rejects.toThrow(StorageError);
		await expect(repo.getAll()).rejects.toThrow(StorageError);
	});
});
