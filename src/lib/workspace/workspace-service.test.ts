import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from '../core/errors';
import type { SnapshotNode } from '../core/types';
import { KvRepository } from '../db/kv-repo';
import { createScopeKv } from '../db/scoped-kv';
import { CosBoxDatabase } from '../db/schema';
import { SnapshotRepository } from '../db/snapshot-repo';
import { MemoryRepository } from '../db/memory-repo';
import { WorldInfoRepository } from '../db/world-info-repo';
import { WorkspaceScope } from '../db/workspace-scope';
import type { WorkspaceData } from '../import-export/workspace';
import { parseWorkspace } from '../import-export/workspace';
import { CharacterManager } from '../manager/character-manager';
import { WorkspaceService } from './workspace-service';
import { WorkspaceRegistry } from './workspace-registry';

function makeWorkspaceData(): WorkspaceData {
	const root: SnapshotNode = {
		id: 'root',
		timestamp: 1,
		parentId: null,
		metadata: { type: 'root', desc: '初始状态' },
		delta: null
	};
	const msg: SnapshotNode = {
		id: 'msg',
		timestamp: 2,
		parentId: 'root',
		metadata: { type: 'message', desc: '用户消息' },
		delta: { kind: 'message', role: 'user', content: '你好' }
	};
	return {
		profile: { name: '绫音', systemPrompt: null },
		developerMode: true,
		worldInfo: [{ id: 'w1', keys: ['x'], content: 'c', enabled: true, priority: 1 }],
		memories: [
			{
				id: 'm1',
				content: '事实',
				category: '其他',
				keywords: [],
				importance: 3,
				pinned: false,
				source: 'manual',
				createdAt: 1,
				updatedAt: 1,
				lastUsedAt: 0,
				useCount: 0
			}
		],
		config: {},
		headId: 'msg',
		snapshots: [root, msg],
		workspaceName: '导入的故事'
	};
}

describe('WorkspaceService', () => {
	let db: CosBoxDatabase;
	let kv: KvRepository;
	let scope: WorkspaceScope;
	let snapshots: SnapshotRepository;
	let worldInfo: WorldInfoRepository;
	let memories: MemoryRepository;
	let manager: CharacterManager;
	let registry: WorkspaceRegistry;
	let service: WorkspaceService;
	let switchedCount: number;

	beforeEach(async () => {
		db = new CosBoxDatabase(`test-ws-svc-${Math.random().toString(36).slice(2)}`);
		kv = new KvRepository(db);
		scope = new WorkspaceScope();
		snapshots = new SnapshotRepository(db, scope);
		worldInfo = new WorldInfoRepository(db, scope);
		memories = new MemoryRepository(db, scope);
		manager = new CharacterManager({ snapshots, kv: createScopeKv(kv, scope) });
		registry = new WorkspaceRegistry(kv);
		await registry.migrateLegacy();
		switchedCount = 0;
		service = new WorkspaceService({
			registry,
			scope,
			snapshots,
			worldInfo,
			memories,
			kv,
			manager,
			onSwitched: async () => {
				switchedCount += 1;
			}
		});
	});

	afterEach(async () => {
		await db.close();
	});

	it('switchTo：切换工作区、重置 manager、空工作区自动建根、触发宿主重载', async () => {
		const second = await registry.create('第二');
		await service.switchTo(second.id);
		expect(scope.get()).toBe(second.id);
		expect(registry.getCurrentId()).toBe(second.id);
		expect(manager.getHeadId()).not.toBeNull();
		expect(switchedCount).toBe(1);
		// 首次进入不初始化旧工作区：默认工作区未被误建根，只有新工作区有根。
		expect(await snapshots.count('default')).toBe(0);
		expect(await snapshots.count(second.id)).toBe(1);
		// 默认工作区不受影响（切回来数据仍在）。
		await service.switchTo('default');
		expect(scope.get()).toBe('default');
		expect(switchedCount).toBe(2);
		expect(await snapshots.count('default')).toBe(1);
	});

	it('switchTo 不存在的工作区抛 WorkspaceError', async () => {
		await expect(service.switchTo('ghost')).rejects.toThrow(WorkspaceError);
	});

	it('createWorkspace：新建并切换，两个工作区数据隔离', async () => {
		// 默认工作区先留一条消息。
		await service.switchTo('default');
		await manager.addMessage('user', '默认的对话');

		const meta = await service.createWorkspace('新故事');
		expect(meta.name).toBe('新故事');
		expect(scope.get()).toBe(meta.id);
		// 新工作区只有自动建的根；默认工作区的对话不受影响。
		expect(await snapshots.count(meta.id)).toBe(1);
		expect(manager.getConversation()).toEqual([]);
		expect(await snapshots.count('default')).toBe(2);
		expect(switchedCount).toBe(2);
	});

	it('duplicateWorkspace：全量复制且 id 全部 remap（跨工作区不冲突）', async () => {
		await service.switchTo('default');
		await manager.addMessage('user', '你好');
		await worldInfo.upsert({ id: 'w1', keys: ['x'], content: 'c', enabled: true, priority: 1 });
		await memories.upsert({
			id: 'm1',
			content: '事实',
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
		await kv.set('ws:default:settings.profile', { name: '原角色', systemPrompt: null });

		const copy = await service.duplicateWorkspace('default', '副本');
		expect(scope.get()).toBe(copy.id);
		const copiedNodes = await snapshots.getAll(copy.id);
		expect(copiedNodes).toHaveLength(2);
		// 原 id 不复用；parentId 引用重写为副本内新 id。
		const originalIds = new Set((await snapshots.getAll('default')).map((n) => n.id));
		for (const node of copiedNodes) {
			expect(originalIds.has(node.id)).toBe(false);
		}
		const child = copiedNodes.find((n) => n.metadata.type === 'message')!;
		const root = copiedNodes.find((n) => n.metadata.type === 'root')!;
		expect(child.parentId).toBe(root.id);
		// head 经映射指向副本内节点。
		const headId = await kv.get<string>(`ws:${copy.id}:lastHeadId`);
		expect(headId).toBe(child.id);
		// 世界书/记忆/档案复制。
		expect((await worldInfo.getAll(copy.id)).map((e) => e.id)).not.toContain('w1');
		expect(await memories.getAll(copy.id)).toHaveLength(1);
		expect(await kv.get(`ws:${copy.id}:settings.profile`)).toEqual({
			name: '原角色',
			systemPrompt: null
		});
	});

	it('duplicateWorkspace：名称冲突自动追加编号；源不存在时无副作用', async () => {
		await service.switchTo('default');
		await manager.addMessage('user', '你好');
		await registry.create('默认工作区 副本'); // 预占副本名
		const copy = await service.duplicateWorkspace('default', '默认工作区 副本');
		expect(copy.name).toBe('默认工作区 副本 2');
		expect(scope.get()).toBe(copy.id);
		expect(await snapshots.count(copy.id)).toBe(2);

		const before = registry.getWorkspaces().length;
		await expect(service.duplicateWorkspace('ghost', 'x')).rejects.toThrow(WorkspaceError);
		expect(registry.getWorkspaces()).toHaveLength(before);
	});

	it('removeWorkspace：删除数据与作用域键；删除当前工作区自动切走', async () => {
		await service.switchTo('default');
		await manager.addMessage('user', '你好');
		await kv.set('ws:default:settings.profile', { name: 'x', systemPrompt: null });
		const second = await service.createWorkspace('第二');

		await service.removeWorkspace('default');
		expect(scope.get()).toBe(second.id);
		expect(await snapshots.count('default')).toBe(0);
		expect(await kv.get('ws:default:settings.profile')).toBeUndefined();
		expect(registry.getById('default')).toBeUndefined();

		await expect(service.removeWorkspace(second.id)).rejects.toThrow(WorkspaceError);
	});

	it('importAsNewWorkspace：.cbox 数据落新工作区并切换，head 经 remap 指向新节点', async () => {
		const meta = await service.importAsNewWorkspace(makeWorkspaceData());
		expect(meta.name).toBe('导入的故事');
		expect(scope.get()).toBe(meta.id);
		const nodes = await snapshots.getAll(meta.id);
		expect(nodes).toHaveLength(2);
		const root = nodes.find((n) => n.metadata.type === 'root')!;
		const msg = nodes.find((n) => n.metadata.type === 'message')!;
		expect(msg.parentId).toBe(root.id);
		const headId = await kv.get<string>(`ws:${meta.id}:lastHeadId`);
		expect(headId).toBe(msg.id);
		expect(await worldInfo.getAll(meta.id)).toHaveLength(1);
		expect(await memories.getAll(meta.id)).toHaveLength(1);
		expect(await kv.get(`ws:${meta.id}:settings.profile`)).toEqual({
			name: '绫音',
			systemPrompt: null
		});
		expect(await kv.get(`ws:${meta.id}:settings.developer`)).toBe(true);
		expect(manager.getConversation()).toHaveLength(1);
		expect(switchedCount).toBe(1);
	});

	it('importAsNewWorkspace 显式名称优先于 manifest 名称', async () => {
		const meta = await service.importAsNewWorkspace(makeWorkspaceData(), ' 我的导入 ');
		expect(meta.name).toBe('我的导入');
	});

	it('collectWorkspaceData 与 exportWorkspace 往返完整数据', async () => {
		await service.importAsNewWorkspace(makeWorkspaceData());
		const current = scope.get();
		const data = await service.collectWorkspaceData(current);
		expect(data.profile.name).toBe('绫音');
		expect(data.memories).toHaveLength(1);
		expect(data.workspaceName).toBe('导入的故事');
		expect(data.headId).not.toBeNull();

		const parsed = parseWorkspace(await service.exportWorkspace(current));
		expect(parsed.memories).toHaveLength(1);
		expect(parsed.workspaceName).toBe('导入的故事');
		expect(parsed.snapshots).toHaveLength(2);
	});
});
