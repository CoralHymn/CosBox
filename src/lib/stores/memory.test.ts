import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db/memory-repo';
import { CosBoxDatabase } from '../db/schema';
import type { ExtractedMemory } from '../memory/types';
import { createMemoryStore } from './memory.svelte';

describe('createMemoryStore', () => {
	let db: CosBoxDatabase;
	let repo: MemoryRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-mem-store-${Math.random().toString(36).slice(2)}`);
		repo = new MemoryRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('load 读取已保存条目，sorted 按置顶/重要度/更新时间排序', async () => {
		const store = createMemoryStore(repo);
		await store.load();
		expect(store.entries).toEqual([]);

		await store.add({
			content: '普通记忆',
			category: '其他',
			keywords: ['a'],
			importance: 2,
			pinned: false
		});
		await store.add({
			content: '置顶记忆',
			category: '重要事件',
			keywords: ['b'],
			importance: 1,
			pinned: true
		});
		expect(store.sorted.map((entry) => entry.content)).toEqual(['置顶记忆', '普通记忆']);

		const reloaded = createMemoryStore(repo);
		await reloaded.load();
		expect(reloaded.entries).toHaveLength(2);
	});

	it('update 与 remove 生效', async () => {
		const store = createMemoryStore(repo);
		const added = await store.add({
			content: '原始',
			category: '其他',
			keywords: [],
			importance: 3,
			pinned: false
		});
		await store.update(added.id, { importance: 5, pinned: true });
		const updated = store.entries[0]!;
		expect(updated.importance).toBe(5);
		expect(updated.pinned).toBe(true);

		await store.remove(added.id);
		expect(store.entries).toHaveLength(0);
	});

	it('togglePinned 切换置顶', async () => {
		const store = createMemoryStore(repo);
		const added = await store.add({
			content: 'x',
			category: '其他',
			keywords: [],
			importance: 3,
			pinned: false
		});
		await store.togglePinned(added.id);
		expect(store.entries[0]!.pinned).toBe(true);
	});

	it('markUsed 累加使用次数并持久化', async () => {
		const store = createMemoryStore(repo);
		const added = await store.add({
			content: 'x',
			category: '其他',
			keywords: [],
			importance: 3,
			pinned: false
		});
		await store.markUsed([added.id]);
		expect(store.entries[0]!.useCount).toBe(1);

		const reloaded = createMemoryStore(repo);
		await reloaded.load();
		expect(reloaded.entries[0]!.useCount).toBe(1);
	});

	it('importExtracted 导入新条目并跳过重复', async () => {
		const store = createMemoryStore(repo);
		await store.add({
			content: '绫音怕打雷',
			category: '角色偏好',
			keywords: ['打雷'],
			importance: 3,
			pinned: false
		});
		const items: ExtractedMemory[] = [
			{ content: '绫音怕打雷', category: '角色偏好', keywords: ['打雷'], importance: 4 },
			{ content: '绫音喜欢咖喱饭', category: '角色偏好', keywords: ['咖喱'], importance: 3 },
			{ content: '', category: '其他', keywords: [], importance: 1 }
		];
		const result = await store.importExtracted(items);
		expect(result).toEqual({ imported: 1, skipped: 1 });
		expect(store.entries).toHaveLength(2);
		expect(store.entries[1]!.source).toBe('extract');
	});
});
