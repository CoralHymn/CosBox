import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KvRepository } from '../db/kv-repo';
import { CosBoxDatabase } from '../db/schema';
import { createContextUsageStore, type PersistedContextUsage } from './context-usage.svelte';

const SAMPLE: PersistedContextUsage = {
	usage: { promptTokens: 1200, completionTokens: 340, cachedTokens: 800 },
	compaction: { summary: '早期对话摘要', boundaryId: 'msg_9' },
	keptRecent: 12,
	savedAt: 1_700_000_000_000
};

describe('createContextUsageStore', () => {
	let db: CosBoxDatabase;
	let kv: KvRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-ctx-usage-${Math.random().toString(36).slice(2)}`);
		kv = new KvRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('未保存过数据时 load 后 usage 为空', async () => {
		const store = createContextUsageStore(kv);
		await store.load();
		expect(store.loaded).toBe(true);
		expect(store.usage).toBeNull();
	});

	it('save 后新 store load 能恢复完整记录', async () => {
		const first = createContextUsageStore(kv);
		await first.save(SAMPLE);
		expect(first.usage).toEqual(SAMPLE);

		const second = createContextUsageStore(kv);
		await second.load();
		expect(second.usage).toEqual(SAMPLE);
	});

	it('覆盖保存时以最新记录为准', async () => {
		const store = createContextUsageStore(kv);
		await store.save(SAMPLE);
		const next: PersistedContextUsage = {
			...SAMPLE,
			usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 0 },
			compaction: null,
			keptRecent: 3
		};
		await store.save(next);
		const reloaded = createContextUsageStore(kv);
		await reloaded.load();
		expect(reloaded.usage).toEqual(next);
	});

	it('损坏的持久化数据（缺字段）load 时忽略并保持为空', async () => {
		await kv.set('context.usage', {
			usage: { promptTokens: 1 },
			compaction: null,
			keptRecent: 0,
			savedAt: 1
		});
		const store = createContextUsageStore(kv);
		await store.load();
		expect(store.usage).toBeNull();
	});

	it('非法 usage 类型（非数字）load 时忽略', async () => {
		await kv.set('context.usage', {
			usage: { promptTokens: 'many', completionTokens: 0, cachedTokens: 0 },
			compaction: null,
			keptRecent: 0,
			savedAt: 1
		});
		const store = createContextUsageStore(kv);
		await store.load();
		expect(store.usage).toBeNull();
	});
});
