import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KvRepository } from './kv-repo';
import { createScopeKv, createWorkspaceKv, workspaceKvKey, workspaceKvPrefix } from './scoped-kv';
import { CosBoxDatabase } from './schema';
import { WorkspaceScope } from './workspace-scope';

describe('scoped-kv', () => {
	it('workspaceKvPrefix / workspaceKvKey 拼接正确', () => {
		expect(workspaceKvPrefix('abc')).toBe('ws:abc:');
		expect(workspaceKvKey('abc', 'settings.profile')).toBe('ws:abc:settings.profile');
	});
});

describe('scoped-kv 读写', () => {
	let db: CosBoxDatabase;
	let kv: KvRepository;
	let scope: WorkspaceScope;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-scoped-kv-${Math.random().toString(36).slice(2)}`);
		kv = new KvRepository(db);
		scope = new WorkspaceScope();
	});

	afterEach(async () => {
		await db.close();
	});

	it('键自动带当前工作区前缀，切换 scope 后读写落到新工作区', async () => {
		const scoped = createScopeKv(kv, scope);
		scope.set('ws-a');
		await scoped.set('lastHeadId', 'h1');
		expect(await scoped.get<string>('lastHeadId')).toBe('h1');
		// 底层存储键带前缀。
		const record = await db.kv.get('ws:ws-a:lastHeadId');
		expect(record?.value).toBe('h1');

		scope.set('ws-b');
		expect(await scoped.get<string>('lastHeadId')).toBeUndefined();
		await scoped.set('lastHeadId', 'h2');
		scope.set('ws-a');
		expect(await scoped.get<string>('lastHeadId')).toBe('h1');
		scope.set('ws-b');
		expect(await scoped.get<string>('lastHeadId')).toBe('h2');

		await scoped.remove('lastHeadId');
		expect(await scoped.get<string>('lastHeadId')).toBeUndefined();
	});

	it('createWorkspaceKv 固定工作区，不受 scope 影响', async () => {
		const fixed = createWorkspaceKv(kv, 'ws-x');
		await fixed.set('settings.developer', true);
		scope.set('ws-y');
		const other = createScopeKv(kv, scope);
		expect(await other.get<boolean>('settings.developer')).toBeUndefined();
		expect(await fixed.get<boolean>('settings.developer')).toBe(true);
	});

	it('removeByPrefix 清理某工作区全部作用域键', async () => {
		const a = createWorkspaceKv(kv, 'ws-a');
		const b = createWorkspaceKv(kv, 'ws-b');
		await a.set('k1', 1);
		await a.set('k2', 2);
		await b.set('k1', 3);
		await kv.removeByPrefix('ws:ws-a:');
		expect(await a.get<number>('k1')).toBeUndefined();
		expect(await a.get<number>('k2')).toBeUndefined();
		expect(await b.get<number>('k1')).toBe(3);
	});
});

describe('WorkspaceScope', () => {
	it('默认定位 default 工作区，set 触发订阅、相同 id 不重复通知', () => {
		const scope = new WorkspaceScope();
		expect(scope.get()).toBe('default');
		let notified = 0;
		const unsubscribe = scope.subscribe(() => {
			notified += 1;
		});
		scope.set('default');
		expect(notified).toBe(0);
		scope.set('ws-a');
		scope.set('ws-b');
		expect(notified).toBe(2);
		expect(scope.get()).toBe('ws-b');
		unsubscribe();
		scope.set('ws-c');
		expect(notified).toBe(2);
	});
});
