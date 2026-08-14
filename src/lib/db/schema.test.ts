import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { CosBoxDatabase, getDb } from './schema';

describe('schema', () => {
	it('可以创建独立数据库实例', () => {
		const db = new CosBoxDatabase(`test-schema-${Math.random().toString(36).slice(2)}`);
		expect(db.snapshots).toBeDefined();
		expect(db.worldInfo).toBeDefined();
		expect(db.kv).toBeDefined();
		return db.close();
	});

	it('getDb 返回共享单例', () => {
		const first = getDb();
		expect(getDb()).toBe(first);
		return first.close();
	});

	it('v2 → v3 迁移：存量行补默认工作区 id', async () => {
		const name = `test-migrate-${Math.random().toString(36).slice(2)}`;
		// 用旧 v2 schema 建库并写入无 workspaceId 的存量数据。
		const legacy = new Dexie(name);
		legacy.version(2).stores({
			snapshots: 'id, [parentId+timestamp], parentId, timestamp',
			worldInfo: 'id',
			memories: 'id, pinned, category',
			kv: 'key'
		});
		await legacy.open();
		await legacy.table('snapshots').add({
			id: 'n1',
			timestamp: 1,
			parentId: null,
			metadata: { type: 'root', desc: '初始状态' },
			delta: null
		});
		await legacy.table('worldInfo').add({
			id: 'w1',
			keys: ['x'],
			content: 'c',
			enabled: true,
			priority: 1
		});
		await legacy.table('memories').add({
			id: 'm1',
			content: 'c',
			category: '其他',
			keywords: [],
			importance: 3,
			pinned: false,
			source: 'manual',
			createdAt: 1,
			updatedAt: 1,
			lastUsedAt: 0,
			useCount: 0
		});
		await legacy.table('kv').add({ key: 'settings.llm', value: { provider: 'demo' } });
		legacy.close();

		// 用当前 schema（v3）重开：触发升级并把三张业务表盖章 default。
		const upgraded = new CosBoxDatabase(name);
		await upgraded.open();
		const snapshots = await upgraded.snapshots.toArray();
		const worldInfo = await upgraded.worldInfo.toArray();
		const memories = await upgraded.memories.toArray();
		expect(snapshots.map((node) => node.workspaceId)).toEqual(['default']);
		expect(worldInfo.map((entry) => entry.workspaceId)).toEqual(['default']);
		expect(memories.map((entry) => entry.workspaceId)).toEqual(['default']);
		// kv 不参与迁移，保持原样。
		expect((await upgraded.kv.get('settings.llm'))?.value).toEqual({ provider: 'demo' });
		await upgraded.close();
	});

	it('v2 → v3 迁移：空表升级不报错（跳过盖章）', async () => {
		const name = `test-migrate-empty-${Math.random().toString(36).slice(2)}`;
		const legacy = new Dexie(name);
		legacy.version(2).stores({
			snapshots: 'id, [parentId+timestamp], parentId, timestamp',
			worldInfo: 'id',
			memories: 'id, pinned, category',
			kv: 'key'
		});
		await legacy.open();
		legacy.close();

		const upgraded = new CosBoxDatabase(name);
		await upgraded.open();
		expect(await upgraded.snapshots.toArray()).toEqual([]);
		expect(await upgraded.worldInfo.toArray()).toEqual([]);
		expect(await upgraded.memories.toArray()).toEqual([]);
		await upgraded.close();
	});
});
