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

	it('Svelte 响应式代理值也能安全写入（structuredClone 兜底）', async () => {
		const proxied = new Proxy({ dark: true, level: 3 }, {});
		await repo.set('theme', proxied);
		expect(await repo.get<{ dark: boolean; level: number }>('theme')).toEqual({
			dark: true,
			level: 3
		});
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

	it('getAllWithPrefix 返回前缀匹配记录', async () => {
		await repo.set('ws:a:k1', 1);
		await repo.set('ws:a:k2', 2);
		await repo.set('ws:b:k1', 3);
		await repo.set('other', 4);
		const matched = await repo.getAllWithPrefix('ws:a:');
		expect(matched.map((r) => r.key).sort()).toEqual(['ws:a:k1', 'ws:a:k2']);
	});

	it('removeByPrefix 只删除前缀匹配键', async () => {
		await repo.set('ws:a:k1', 1);
		await repo.set('ws:a:k2', 2);
		await repo.set('ws:b:k1', 3);
		await repo.removeByPrefix('ws:a:');
		expect(await repo.get('ws:a:k1')).toBeUndefined();
		expect(await repo.get('ws:a:k2')).toBeUndefined();
		expect(await repo.get('ws:b:k1')).toBe(3);
	});

	it('数据库关闭后操作抛 StorageError', async () => {
		await db.close();
		await expect(repo.get('x')).rejects.toThrow(StorageError);
		await expect(repo.set('x', 1)).rejects.toThrow(StorageError);
		await expect(repo.remove('x')).rejects.toThrow(StorageError);
		await expect(repo.getAll()).rejects.toThrow(StorageError);
		await expect(repo.getAllWithPrefix('ws:')).rejects.toThrow(StorageError);
		await expect(repo.removeByPrefix('ws:')).rejects.toThrow(StorageError);
	});
});
