import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from '../core/errors';
import { KvRepository } from '../db/kv-repo';
import { CosBoxDatabase } from '../db/schema';
import { WorkspaceRegistry } from './workspace-registry';

describe('WorkspaceRegistry', () => {
	let db: CosBoxDatabase;
	let kv: KvRepository;
	let registry: WorkspaceRegistry;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-ws-reg-${Math.random().toString(36).slice(2)}`);
		kv = new KvRepository(db);
		registry = new WorkspaceRegistry(kv);
	});

	afterEach(async () => {
		await db.close();
	});

	it('migrateLegacy：注册表缺失时创建默认工作区并迁移旧裸键', async () => {
		// 模拟旧版本：裸键存档案/开发者/head，应用级 llm 键保持裸键。
		await kv.set('settings.profile', { name: '旧角色', systemPrompt: null });
		await kv.set('settings.developer', true);
		await kv.set('lastHeadId', 'h1');
		await kv.set('settings.llm', { provider: 'demo' });

		await registry.migrateLegacy();

		const metas = registry.getWorkspaces();
		expect(metas).toHaveLength(1);
		expect(metas[0]!.id).toBe('default');
		expect(metas[0]!.name).toBe('默认工作区');
		expect(registry.getCurrentId()).toBe('default');
		// 旧裸键已迁移到 ws:default: 前缀并删除旧键。
		expect(await kv.get('settings.profile')).toBeUndefined();
		expect(await kv.get('ws:default:settings.profile')).toEqual({
			name: '旧角色',
			systemPrompt: null
		});
		expect(await kv.get('ws:default:settings.developer')).toBe(true);
		expect(await kv.get('ws:default:lastHeadId')).toBe('h1');
		// 应用级键不动。
		expect(await kv.get('settings.llm')).toEqual({ provider: 'demo' });

		// 幂等：再次调用不重复迁移、不重建列表。
		await kv.set('settings.developer', false);
		await registry.migrateLegacy();
		expect(registry.getWorkspaces()).toHaveLength(1);
	});

	it('load 恢复列表与当前工作区；无效 current 回退 null', async () => {
		await registry.migrateLegacy();
		const second = await registry.create('第二');
		await registry.setCurrent(second.id);
		await registry.rename(second.id, '第二改名');
		const reloaded = new WorkspaceRegistry(kv);
		await reloaded.load();
		expect(reloaded.getWorkspaces().map((m) => m.name)).toContain('默认工作区');
		expect(reloaded.getWorkspaces().map((m) => m.name)).toContain('第二改名');
		expect(reloaded.getById(reloaded.getCurrentId() ?? '')?.name).toBe('第二改名');

		// 注册表指向不存在的工作区时回退 null。
		await kv.set('workspaces.current', 'ghost');
		const broken = new WorkspaceRegistry(kv);
		await broken.load();
		expect(broken.getCurrentId()).toBeNull();
	});

	it('create 校验名称非空且不重复', async () => {
		await registry.migrateLegacy();
		await expect(registry.create('   ')).rejects.toThrow(WorkspaceError);
		await registry.create('故事');
		await expect(registry.create('故事')).rejects.toThrow(WorkspaceError);
		expect(registry.getWorkspaces().map((m) => m.name)).toEqual(
			expect.arrayContaining(['故事', '默认工作区'])
		);
	});

	it('rename 校验并持久化；同名无操作', async () => {
		await registry.migrateLegacy();
		const a = await registry.create('A');
		const b = await registry.create('B');
		await expect(registry.rename('missing', 'x')).rejects.toThrow(WorkspaceError);
		await expect(registry.rename(a.id, 'B')).rejects.toThrow(WorkspaceError);
		await registry.rename(a.id, 'A');
		await registry.rename(a.id, 'C');
		expect(registry.getById(a.id)?.name).toBe('C');
		expect(registry.getById(b.id)?.name).toBe('B');
	});

	it('remove 不得删除最后一个；删除当前工作区回退到其余第一个', async () => {
		await registry.migrateLegacy();
		const second = await registry.create('第二');
		await registry.setCurrent(second.id);
		await registry.remove(second.id);
		expect(registry.getCurrentId()).toBe('default');
		await expect(registry.remove('default')).rejects.toThrow(WorkspaceError);
	});

	it('touch 更新最近使用时间并影响排序（最近的在前）', async () => {
		await registry.migrateLegacy();
		await new Promise((resolve) => setTimeout(resolve, 5));
		await registry.create('新');
		const list = registry.getWorkspaces();
		expect(list[0]!.name).toBe('新');
		await registry.touch('default');
		expect(registry.getWorkspaces()[0]!.id).toBe('default');
	});

	it('patch 局部更新头像与会话摘要，不刷新最近使用排序；不存在时报错', async () => {
		await registry.migrateLegacy();
		const second = await registry.create('第二');
		const beforeUpdatedAt = registry.getById(second.id)!.updatedAt;
		await registry.patch(second.id, {
			avatar: { kind: 'glyph', color: '#6d8dff', glyph: '澪' },
			lastMessagePreview: '你好',
			lastMessageAt: 123
		});
		const patched = registry.getById(second.id)!;
		expect(patched.avatar).toEqual({ kind: 'glyph', color: '#6d8dff', glyph: '澪' });
		expect(patched.lastMessagePreview).toBe('你好');
		expect(patched.lastMessageAt).toBe(123);
		expect(patched.updatedAt).toBe(beforeUpdatedAt);
		// 持久化：重载后仍在。
		const reloaded = new WorkspaceRegistry(kv);
		await reloaded.load();
		expect(reloaded.getById(second.id)?.avatar).toEqual({
			kind: 'glyph',
			color: '#6d8dff',
			glyph: '澪'
		});
		await expect(registry.patch('missing', { lastMessagePreview: 'x' })).rejects.toThrow(
			WorkspaceError
		);
	});

	it('subscribe 在注册表变化时通知', async () => {
		await registry.migrateLegacy();
		let notified = 0;
		const unsubscribe = registry.subscribe(() => {
			notified += 1;
		});
		await registry.create('x');
		expect(notified).toBe(1);
		unsubscribe();
		await registry.create('y');
		expect(notified).toBe(1);
	});
});
