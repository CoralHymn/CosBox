import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateValidationError } from '../core/errors';
import { createInitialState } from '../core/state';
import type { ScheduleEntry, StatePatch } from '../core/types';
import { KvRepository } from '../db/kv-repo';
import { CosBoxDatabase } from '../db/schema';
import { SnapshotRepository } from '../db/snapshot-repo';
import { CharacterManager } from './character-manager';

describe('CharacterManager', () => {
	let db: CosBoxDatabase;
	let snapshots: SnapshotRepository;
	let kv: KvRepository;
	let clock: number;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-mgr-${Math.random().toString(36).slice(2)}`);
		snapshots = new SnapshotRepository(db);
		kv = new KvRepository(db);
		clock = 1000;
	});

	afterEach(async () => {
		await db.close();
	});

	function createManager(): CharacterManager {
		return new CharacterManager({
			snapshots,
			kv,
			now: () => {
				clock += 1;
				return clock;
			}
		});
	}

	it('init 在空库创建根快照', async () => {
		const manager = createManager();
		await manager.init();
		expect(await snapshots.count()).toBe(1);
		expect(manager.getHeadId()).not.toBeNull();
		expect(manager.getState().attributes.name).toBe('绫音');
	});

	it('init 幂等', async () => {
		const manager = createManager();
		await manager.init();
		await manager.init();
		expect(await snapshots.count()).toBe(1);
	});

	it('init 恢复 kv 中保存的 head', async () => {
		const manager = createManager();
		await manager.init();
		const head = manager.getHeadId()!;
		const manager2 = createManager();
		await manager2.init();
		expect(manager2.getHeadId()).toBe(head);
	});

	it('init 在 kv 缺失时选择最新分支 tip', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await manager.update({ outfit: { top: '毛衣' } }, { desc: '分支A换装' });
		await manager.addMessage('user', '分支A');
		await manager.checkout(root);
		await manager.update({ outfit: { top: '运动服' } }, { desc: '分支B换装' });
		const latest = manager.getHeadId()!;
		expect(manager.getBranches().length).toBe(2);
		await kv.remove('lastHeadId');
		const manager2 = createManager();
		await manager2.init();
		expect(manager2.getHeadId()).toBe(latest);
		expect(manager2.getState().outfit.top).toBe('运动服');
	});

	it('update 校验、落快照、应用状态并推进 head', async () => {
		const manager = createManager();
		await manager.init();
		const node = await manager.update(
			{ location: { id: 'lib', name: '图书馆' } },
			{ desc: '移动到图书馆' }
		);
		expect(manager.getHeadId()).toBe(node.id);
		expect(manager.getState().location.name).toBe('图书馆');
		expect(await snapshots.count()).toBe(2);
		expect(node.delta).toEqual({
			kind: 'state',
			patch: { location: { id: 'lib', name: '图书馆' } }
		});
	});

	it('update 非法补丁抛错且不产生快照', async () => {
		const manager = createManager();
		await manager.init();
		await expect(
			manager.update({ schedule: { time: { day: 9, hour: 0, minute: 0 } } }, { desc: '非法' })
		).rejects.toThrow(StateValidationError);
		expect(await snapshots.count()).toBe(1);
	});

	it('update 兼容含不可克隆属性的补丁（structuredClone 失败时退回 JSON 深拷贝）', async () => {
		const manager = createManager();
		await manager.init();
		const entry = {
			id: 'x',
			day: 0,
			start: 600,
			end: 660,
			title: '自习',
			evil: () => 1
		} as ScheduleEntry & { evil: () => number };
		const node = await manager.update({ schedule: { entries: [entry] } }, { desc: '新增条目' });
		expect(manager.getState().schedule.entries).toEqual([
			{ id: 'x', day: 0, start: 600, end: 660, title: '自习' }
		]);
		const delta = node.delta as { kind: 'state'; patch: StatePatch };
		expect(delta.patch.schedule?.entries).toEqual([
			{ id: 'x', day: 0, start: 600, end: 660, title: '自习' }
		]);
	});

	it('addMessage 追加消息快照并重建会话', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '你好');
		await manager.addMessage('assistant', '你也好');
		expect(manager.getConversation().map((m) => m.content)).toEqual(['你好', '你也好']);
		expect(manager.getConversation()[0]!.role).toBe('user');
	});

	it('addMessage 空内容抛错', async () => {
		const manager = createManager();
		await manager.init();
		await expect(manager.addMessage('user', '   ')).rejects.toThrow(StateValidationError);
	});

	it('addMessage 空正文但带 thinking 时允许（仅思考的回复）', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('assistant', '   ', { thinking: '让我想想' });
		expect(manager.getConversation()[0]!.content).toBe('');
		expect(manager.getConversation()[0]!.thinking).toBe('让我想想');
	});

	it('editMessage 原地改写正文并保留 thinking 与 worldTime', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '你好');
		await manager.addMessage('assistant', '原回复', { thinking: '思考过程' });
		const id = manager.getHeadId()!;
		await manager.editMessage(id, '改后的回复');
		const conversation = manager.getConversation();
		expect(conversation[1]!.content).toBe('改后的回复');
		expect(conversation[1]!.thinking).toBe('思考过程');
		expect(conversation[1]!.worldTime).toEqual({ day: 0, hour: 8, minute: 0 });
	});

	it('editMessage 的修改在重载后保留', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '你好');
		await manager.addMessage('assistant', '原回复');
		const id = manager.getHeadId()!;
		await manager.editMessage(id, '改后的回复');
		const reloaded = createManager();
		await reloaded.init();
		expect(reloaded.getConversation()[1]!.content).toBe('改后的回复');
	});

	it('editMessage 空正文抛错且不改动原内容', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('assistant', '回复');
		const id = manager.getHeadId()!;
		await expect(manager.editMessage(id, '   ')).rejects.toThrow(StateValidationError);
		expect(manager.getConversation()[0]!.content).toBe('回复');
	});

	it('editMessage 只能编辑消息快照', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ outfit: { top: '外套' } }, { desc: '换装' });
		const stateId = manager.getHeadId()!;
		await expect(manager.editMessage(stateId, '新内容')).rejects.toThrow('只能编辑消息快照');
	});

	it('editMessage 编辑中间消息后，后续重建引用新正文', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '问题');
		await manager.addMessage('assistant', '回答一');
		const assistantId = manager.getHeadId()!;
		await manager.addMessage('user', '追问');
		await manager.editMessage(assistantId, '回答一（改）');
		expect(manager.getConversation().map((message) => message.content)).toEqual([
			'问题',
			'回答一（改）',
			'追问'
		]);
	});

	it('addMessage 支持 system 角色', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('system', '旁白：远处传来钟声');
		expect(manager.getConversation().map((m) => m.role)).toEqual(['system']);
	});

	it('addMessage 的 skipContext 选项写入快照并随重建保留', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('system', '可用 RP 快捷命令', { skipContext: true });
		await manager.addMessage('user', '你好');
		expect(manager.getConversation()[0]!.skipContext).toBe(true);
		expect(manager.getConversation()[1]!.skipContext).toBeUndefined();
		// checkout 重建后标记仍保留（帮助消息只展示、不进上下文）
		const headId = manager.getHeadId()!;
		await manager.checkout(headId);
		expect(manager.getConversation()[0]!.skipContext).toBe(true);
	});

	it('addMessage 的 thinking 选项写入快照并随重建保留', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('assistant', '回答', { thinking: '  思考内容  ' });
		expect(manager.getConversation()[0]!.thinking).toBe('思考内容');
		const headId = manager.getHeadId()!;
		await manager.checkout(headId);
		expect(manager.getConversation()[0]!.thinking).toBe('思考内容');
	});

	it('addMessage 的 thinking 为空时不写入该字段', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('assistant', '回答', { thinking: '   ' });
		expect(manager.getConversation()[0]!.thinking).toBeUndefined();
	});

	it('addMessage 记录消息产生时的世界时间', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '你好');
		expect(manager.getConversation()[0]!.worldTime).toEqual({ day: 0, hour: 8, minute: 0 });
		await manager.advanceTime(30);
		await manager.addMessage('assistant', '你也好');
		expect(manager.getConversation()[1]!.worldTime).toEqual({ day: 0, hour: 8, minute: 30 });
	});

	it('未注入 now 时回退到 Date.now', async () => {
		const manager = new CharacterManager({ snapshots, kv });
		await manager.init();
		expect(manager.getHeadId()).not.toBeNull();
		expect(manager.getState().schedule.time.hour).toBe(8);
	});

	it('checkout 切换状态与会话且不产生新快照', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await manager.update({ outfit: { top: '卫衣' } }, { desc: '换装A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;
		const countBefore = await snapshots.count();

		await manager.checkout(root);
		expect(manager.getHeadId()).toBe(root);
		expect(manager.getState().outfit.top).toBe(createInitialState().outfit.top);
		expect(manager.getConversation()).toEqual([]);
		expect(await snapshots.count()).toBe(countBefore);

		// 从根再开一条新分支
		await manager.addMessage('user', '分支B消息');
		expect(manager.getHeadId()).not.toBe(branchAHead);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['分支B消息']);
		expect(
			manager
				.getBranches()
				.map((b) => b.tipId)
				.sort()
		).toEqual([branchAHead, manager.getHeadId()!].sort());
	});

	it('checkout 不存在的 id 抛 SnapshotError 且保持原状', async () => {
		const manager = createManager();
		await manager.init();
		const head = manager.getHeadId();
		await expect(manager.checkout('ghost')).rejects.toThrow();
		expect(manager.getHeadId()).toBe(head);
	});

	it('advanceTime 推进时间并生成快照', async () => {
		const manager = createManager();
		await manager.init();
		await manager.advanceTime(30);
		expect(manager.getState().schedule.time.minute).toBe(30);
		await manager.advanceTime(-60);
		expect(manager.getState().schedule.time.hour).toBe(7);
		expect(manager.getState().schedule.time.minute).toBe(30);
		await expect(manager.advanceTime(Number.NaN)).rejects.toThrow(StateValidationError);
	});

	it('addCheckpoint 创建空 delta 快照，空描述用默认值', async () => {
		const manager = createManager();
		await manager.init();
		const node = await manager.addCheckpoint('   ');
		expect(node.delta).toBeNull();
		expect(node.metadata.desc).toBe('手动检查点');
		expect(manager.getHeadId()).toBe(node.id);
	});

	it('subscribe 在变更后收到通知，unsubscribe 生效', async () => {
		const manager = createManager();
		await manager.init();
		let calls = 0;
		const unsubscribe = manager.subscribe(() => {
			calls += 1;
		});
		await manager.addMessage('user', 'hi');
		expect(calls).toBeGreaterThan(0);
		unsubscribe();
		const before = calls;
		await manager.addMessage('assistant', 'yo');
		expect(calls).toBe(before);
	});

	it('snapshot() 返回组合视图', async () => {
		const manager = createManager();
		await manager.init();
		const view = manager.snapshot();
		expect(view.headId).toBe(manager.getHeadId());
		expect(view.state).toBe(manager.getState());
		expect(view.snapshots.length).toBe(1);
	});

	it('公开 getter 返回内部字段', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', 'hi');
		expect(manager.getSnapshots().length).toBe(2);
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['hi']);
	});

	it('未显式 init 时通过 ensureInit 自动初始化', async () => {
		const manager = createManager();
		await manager.addMessage('user', '自动初始化');
		expect(manager.getHeadId()).not.toBeNull();
		expect(manager.getConversation().map((m) => m.content)).toEqual(['自动初始化']);
		expect(await snapshots.count()).toBe(2);
	});

	it('并发 init 共享初始化流程，只创建一次根', async () => {
		const manager = createManager();
		await Promise.all([manager.init(), manager.init(), manager.init()]);
		expect(await snapshots.count()).toBe(1);
	});

	it('并发 update 串行落地：单链无分支且全部生效', async () => {
		const manager = createManager();
		await manager.init();
		const results = await Promise.all([
			manager.update({ attributes: { step: 1 } }, { desc: 's1' }),
			manager.update({ attributes: { step: 2 } }, { desc: 's2' }),
			manager.update({ attributes: { step: 3 } }, { desc: 's3' }),
			manager.update({ attributes: { step: 4 } }, { desc: 's4' }),
			manager.update({ attributes: { step: 5 } }, { desc: 's5' })
		]);
		expect(results.map((node) => node.metadata.desc)).toEqual(['s1', 's2', 's3', 's4', 's5']);
		expect(manager.getState().attributes.step).toBe(5);
		expect(await snapshots.count()).toBe(6);
		expect(manager.getBranches()).toHaveLength(1);
		const chain = await snapshots.chainOf(manager.getHeadId()!);
		expect(chain.map((node) => node.metadata.desc)).toEqual([
			'初始状态',
			's1',
			's2',
			's3',
			's4',
			's5'
		]);
	});

	it('并发混合消息与状态变更保持顺序', async () => {
		const manager = createManager();
		await manager.init();
		await Promise.all([
			manager.addMessage('user', '第一条'),
			manager.update({ outfit: { top: '新外套' } }, { desc: '换装' }),
			manager.addMessage('assistant', '第二条')
		]);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['第一条', '第二条']);
		expect(manager.getState().outfit.top).toBe('新外套');
		expect(manager.getBranches()).toHaveLength(1);
	});

	it('deleteBranch 删除 tip 链并保留分支点，head 不受影响', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		const branchBHead = manager.getHeadId()!;

		expect(manager.getBranches()).toHaveLength(2);
		const deleted = await manager.deleteBranch(branchAHead);
		expect(deleted).toBe(2);
		expect(manager.getHeadId()).toBe(branchBHead);
		expect(manager.getState().outfit.top).toBe('分支B上衣');
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getBranches()[0]!.tipId).toBe(branchBHead);
		const remaining = manager.getSnapshots().map((node) => node.id);
		expect(remaining).toContain(root);
		expect(remaining).toContain(fork);
		expect(remaining).toContain(branchBHead);
		expect(remaining).not.toContain(branchAHead);
		expect(await snapshots.count()).toBe(3);
	});

	it('deleteBranch 当 head 位于删除链时先切回分支点再删除', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		await manager.checkout(branchAHead);

		const deleted = await manager.deleteBranch(branchAHead);
		expect(deleted).toBe(2);
		expect(manager.getHeadId()).toBe(fork);
		expect(manager.getState().outfit.top).toBe(createInitialState().outfit.top);
		expect(manager.getConversation()).toEqual([]);
		expect(await snapshots.count()).toBe(3);
	});

	it('deleteBranch 拒绝非末端节点，避免孤儿链', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		const mid = manager.getHeadId()!;
		await manager.addMessage('user', '分支A消息');

		await expect(manager.deleteBranch(mid)).rejects.toThrow('只能删除分支末端的快照');
		expect(await snapshots.count()).toBe(4);
	});

	it('deleteBranch 只剩一个分支时拒绝删除，避免清空全部历史', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ outfit: { top: '普通上衣' } }, { desc: '换装' });
		await manager.addMessage('user', '只有一条分支');
		const tip = manager.getHeadId()!;

		await expect(manager.deleteBranch(tip)).rejects.toThrow('只剩一个分支');
		expect(manager.getHeadId()).toBe(tip);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['只有一条分支']);
		expect(await snapshots.count()).toBe(3);
	});

	it('deleteBranch 根快照或不存在节点抛 SnapshotError', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await expect(manager.deleteBranch(root)).rejects.toThrow('无法删除根快照');
		await expect(manager.deleteBranch('missing')).rejects.toThrow('无法删除根快照');
		expect(await snapshots.count()).toBe(1);
	});

	it('deleteBranches 空选择或非分支末端节点抛错', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '一');
		const mid = manager.getHeadId()!;
		await manager.addMessage('assistant', '二');
		await expect(manager.deleteBranches([])).rejects.toThrow('没有可删除的分支');
		await expect(manager.deleteBranches([mid])).rejects.toThrow('没有可删除的分支');
	});

	it('deleteBranches 删除当前分支并回退到分叉点', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		const branchBHead = manager.getHeadId()!;

		await manager.checkout(branchAHead);
		const removed = await manager.deleteBranches([branchAHead]);
		expect(removed).toBe(2);
		expect(manager.getHeadId()).toBe(fork);
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getBranches()[0]!.tipId).toBe(branchBHead);
	});

	it('deleteBranches 同时删除多条分支，保留共享分支点', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		const branchBHead = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支C上衣' } }, { desc: '分支C' });
		const branchCHead = manager.getHeadId()!;

		const removed = await manager.deleteBranches([branchAHead, branchBHead]);
		expect(removed).toBe(3);
		expect(manager.getHeadId()).toBe(branchCHead);
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getBranches()[0]!.tipId).toBe(branchCHead);
	});

	it('deleteBranches 删除全部分支时拒绝', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		const branchAHead = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		const branchBHead = manager.getHeadId()!;

		await expect(manager.deleteBranches([branchAHead, branchBHead])).rejects.toThrow(
			'只剩一个分支'
		);
		expect(manager.getBranches()).toHaveLength(2);
	});

	it('deleteBranch 多分支下删除一条分支后仍保留其余分支', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		await manager.addMessage('user', '分支A消息');
		const branchAHead = manager.getHeadId()!;
		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });
		const branchBHead = manager.getHeadId()!;

		const deleted = await manager.deleteBranch(branchAHead);
		expect(deleted).toBe(2);
		expect(manager.getHeadId()).toBe(branchBHead);
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getBranches()[0]!.tipId).toBe(branchBHead);
		expect(manager.getState().outfit.top).toBe('分支B上衣');
	});

	it('deleteBranch 与其他变更并发时按入队顺序串行落地', async () => {
		const manager = createManager();
		await manager.init();
		await manager.update({ attributes: { step: 0 } }, { desc: '分支点' });
		const fork = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支A上衣' } }, { desc: '分支A' });
		const branchAHead = manager.getHeadId()!;

		await manager.checkout(fork);
		await manager.update({ outfit: { top: '分支B上衣' } }, { desc: '分支B' });

		await Promise.all([
			manager.addMessage('user', '分支B新消息'),
			manager.deleteBranch(branchAHead)
		]);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['分支B新消息']);
		expect(manager.getHeadId()).not.toBe(branchAHead);
		expect(manager.getBranches()).toHaveLength(1);
		expect(manager.getBranches()[0]!.tipId).not.toBe(branchAHead);
		expect(await snapshots.count()).toBe(4);
	});

	it('now 在同一毫秒内仍然单调递增（分支排序稳定）', async () => {
		const manager = new CharacterManager({ snapshots, kv, now: () => 1000 });
		await manager.init();
		await manager.update({ attributes: { step: 1 } }, { desc: 's1' });
		await manager.update({ attributes: { step: 2 } }, { desc: 's2' });
		const nodes = await snapshots.getAll();
		expect(nodes.map((node) => node.timestamp).sort((a, b) => a - b)).toEqual([1000, 1001, 1002]);
	});

	it('applyConfig 更新状态并持久化，但不生成快照、不推进 head', async () => {
		const manager = createManager();
		await manager.init();
		const head = manager.getHeadId()!;
		await manager.applyConfig({
			places: [{ id: 'sea', category: '校外', name: '海边', description: '浪很大' }],
			wardrobe: [
				{ id: 'w1', category: '常服', kind: 'top', name: '红色风衣', description: '修身款' }
			],
			scheduleEntries: [{ id: 's1', day: 0, start: 600, end: 660, title: '自习' }]
		});
		expect(manager.getState().places.map((place) => place.name)).toEqual(['海边']);
		expect(manager.getState().outfit.wardrobe.map((item) => item.name)).toEqual(['红色风衣']);
		expect(manager.getState().schedule.entries.map((entry) => entry.title)).toEqual(['自习']);
		expect(manager.getHeadId()).toBe(head);
		expect(await snapshots.count()).toBe(1);
		const saved = await kv.get('config.overrides');
		expect(saved).toEqual({
			places: [{ id: 'sea', category: '校外', name: '海边', description: '浪很大' }],
			wardrobe: [
				{ id: 'w1', category: '常服', kind: 'top', name: '红色风衣', description: '修身款' }
			],
			scheduleEntries: [{ id: 's1', day: 0, start: 600, end: 660, title: '自习' }]
		});
	});

	it('checkout 重建后叠加世界配置覆盖，剧情状态仍回退', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await manager.applyConfig({
			places: [{ id: 'lake', category: '校外', name: '湖边', description: '' }]
		});
		await manager.update({ outfit: { top: '故事里的外套' } }, { desc: '换装' });
		await manager.checkout(root);
		expect(manager.getState().outfit.top).toBe(createInitialState().outfit.top);
		expect(manager.getState().places.map((place) => place.name)).toEqual(['湖边']);
	});

	it('getStateAt 重建历史快照处的状态（含配置覆盖）且不改动 head', async () => {
		const manager = createManager();
		await manager.init();
		const root = manager.getHeadId()!;
		await manager.applyConfig({
			places: [{ id: 'lake', category: '校外', name: '湖边', description: '' }]
		});
		await manager.update({ outfit: { top: '故事里的外套' } }, { desc: '换装' });
		await manager.addMessage('user', '过了一段时间');
		// 历史时刻：换装前的根快照（配置覆盖仍然叠加）。
		const stateAtRoot = await manager.getStateAt(root);
		expect(stateAtRoot.outfit.top).toBe(createInitialState().outfit.top);
		expect(stateAtRoot.places.map((place) => place.name)).toEqual(['湖边']);
		// 历史时刻：消息快照处的状态等于其父状态（消息不改变状态）。
		const messageId = manager.getConversation()[0]!.id;
		const stateAtMessage = await manager.getStateAt(messageId);
		expect(stateAtMessage.outfit.top).toBe('故事里的外套');
		// getStateAt 是纯读：不改动 head 与会话。
		expect(manager.getHeadId()).toBe(messageId);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['过了一段时间']);
	});

	it('applyConfig 非法配置抛错且不落 kv、不改状态', async () => {
		const manager = createManager();
		await manager.init();
		await expect(
			manager.applyConfig({
				scheduleEntries: [{ id: 'bad', day: 9, start: 0, end: 10, title: 'x' }]
			})
		).rejects.toThrow(StateValidationError);
		expect(await kv.get('config.overrides')).toBeUndefined();
		expect(manager.getState().schedule.entries).toHaveLength(3);
	});

	it('restoreWorkspace 写入配置覆盖与 head 并整体重载', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', '你好');
		await manager.applyConfig({
			places: [{ id: 'p1', category: '学校', name: '食堂', description: 'x' }]
		});
		const headId = manager.getHeadId()!;
		const config = {
			places: [{ id: 'p2', category: '郊外', name: '海边', description: 'y' }]
		};
		await manager.restoreWorkspace(config, headId);
		expect(manager.getHeadId()).toBe(headId);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['你好']);
		expect(manager.getState().places.map((p) => p.name)).toEqual(['海边']);
	});

	it('restoreWorkspace headId 为 null 时回退到最新 tip', async () => {
		const manager = createManager();
		await manager.init();
		await manager.addMessage('user', 'hi');
		await manager.restoreWorkspace({}, null);
		expect(manager.getConversation().map((m) => m.content)).toEqual(['hi']);
	});

	it('applyConfig 的覆盖在重新初始化后仍生效', async () => {
		const manager = createManager();
		await manager.init();
		await manager.applyConfig({
			places: [{ id: 'park', category: '校外', name: '公园', description: '' }]
		});
		const manager2 = createManager();
		await manager2.init();
		expect(manager2.getState().places.map((place) => place.name)).toEqual(['公园']);
	});

	it('applyConfig 与其他变更按入队顺序串行落地', async () => {
		const manager = createManager();
		await manager.init();
		await Promise.all([
			manager.applyConfig({
				places: [{ id: 'a', category: '', name: '地点A', description: '' }]
			}),
			manager.update({ outfit: { top: '外套' } }, { desc: '换装' })
		]);
		expect(manager.getState().places[0]!.name).toBe('地点A');
		expect(manager.getState().outfit.top).toBe('外套');
		expect(await snapshots.count()).toBe(2);
	});
});
