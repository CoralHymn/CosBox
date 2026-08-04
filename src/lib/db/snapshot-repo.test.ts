import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotError, StorageError } from '../core/errors';
import { createInitialState } from '../core/state';
import { CosBoxDatabase } from './schema';
import { SnapshotRepository } from './snapshot-repo';

describe('SnapshotRepository', () => {
	let db: CosBoxDatabase;
	let repo: SnapshotRepository;

	beforeEach(() => {
		db = new CosBoxDatabase(`test-snap-${Math.random().toString(36).slice(2)}`);
		repo = new SnapshotRepository(db);
	});

	afterEach(async () => {
		await db.close();
	});

	it('addSnapshot 创建根节点并持久化', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: '初始状态' },
			delta: null
		});
		expect(root.parentId).toBeNull();
		expect(root.metadata.type).toBe('root');
		expect(await repo.getNode(root.id)).toEqual(root);
		expect(await repo.count()).toBe(1);
	});

	it('addSnapshot 拒绝不存在的父节点', async () => {
		await expect(
			repo.addSnapshot({
				parentId: 'ghost',
				metadata: { type: 'state', desc: 'x' },
				delta: { kind: 'state', patch: {} }
			})
		).rejects.toThrow(SnapshotError);
	});

	it('getNode 不存在时返回 undefined', async () => {
		expect(await repo.getNode('missing')).toBeUndefined();
	});

	it('getChildren 按时间升序返回直接子节点', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: 'r' },
			delta: null
		});
		const late = await repo.addSnapshot({
			parentId: root.id,
			metadata: { type: 'message', desc: 'late' },
			delta: { kind: 'message', role: 'user', content: 'b' },
			timestamp: 200
		});
		const early = await repo.addSnapshot({
			parentId: root.id,
			metadata: { type: 'state', desc: 'early' },
			delta: { kind: 'state', patch: {} },
			timestamp: 100
		});
		const children = await repo.getChildren(root.id);
		expect(children.map((n) => n.id)).toEqual([early.id, late.id]);
	});

	it('rebuildState 在 100+ 次 delta 后重建正确', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: 'r' },
			delta: null
		});
		let parent = root.id;
		const initial = createInitialState();
		let affection = initial.attributes.affection as number;
		for (let i = 1; i <= 110; i += 1) {
			if (i % 2 === 0) {
				affection += 1;
				const node = await repo.addSnapshot({
					parentId: parent,
					metadata: { type: 'state', desc: `s${i}` },
					delta: { kind: 'state', patch: { attributes: { affection } } },
					timestamp: i
				});
				parent = node.id;
			} else {
				const node = await repo.addSnapshot({
					parentId: parent,
					metadata: { type: 'message', desc: `m${i}` },
					delta: { kind: 'message', role: 'assistant', content: `msg${i}` },
					timestamp: i
				});
				parent = node.id;
			}
		}
		const result = await repo.rebuildState(parent);
		expect(result.state.attributes.affection).toBe(affection);
		expect(result.messages).toHaveLength(55);
		expect(result.appliedDeltas).toBe(55);
	});

	it('rebuildState 目标不存在抛 SnapshotError', async () => {
		await expect(repo.rebuildState('missing')).rejects.toThrow(SnapshotError);
	});

	it('checkout 与 rebuildState 等价且不写库', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: 'r' },
			delta: null
		});
		const node = await repo.addSnapshot({
			parentId: root.id,
			metadata: { type: 'state', desc: '换装' },
			delta: { kind: 'state', patch: { outfit: { top: '红毛衣' } } },
			timestamp: 5
		});
		const countBefore = await repo.count();
		const checked = await repo.checkout(node.id);
		expect(checked.state.outfit.top).toBe('红毛衣');
		expect(checked.state).toEqual((await repo.rebuildState(node.id)).state);
		expect(await repo.count()).toBe(countBefore);
	});

	it('getBranches 返回分支 tip', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: 'r' },
			delta: null
		});
		const a = await repo.addSnapshot({
			parentId: root.id,
			metadata: { type: 'state', desc: 'a' },
			delta: { kind: 'state', patch: {} },
			timestamp: 2
		});
		await repo.addSnapshot({
			parentId: a.id,
			metadata: { type: 'message', desc: 'b' },
			delta: { kind: 'message', role: 'user', content: 'hi' },
			timestamp: 3
		});
		const branches = await repo.getBranches();
		expect(branches).toHaveLength(1);
		expect(branches[0]!.depth).toBe(2);
	});

	it('chainOf 返回祖先链', async () => {
		const root = await repo.addSnapshot({
			parentId: null,
			metadata: { type: 'root', desc: 'r' },
			delta: null
		});
		const child = await repo.addSnapshot({
			parentId: root.id,
			metadata: { type: 'state', desc: 'c' },
			delta: { kind: 'state', patch: {} }
		});
		const chain = await repo.chainOf(child.id);
		expect(chain.map((n) => n.id)).toEqual([root.id, child.id]);
	});

	it('数据库关闭后读操作抛 StorageError', async () => {
		await db.close();
		await expect(repo.getAll()).rejects.toThrow(StorageError);
		await expect(repo.getNode('x')).rejects.toThrow(StorageError);
		await expect(repo.getChildren('x')).rejects.toThrow(StorageError);
		await expect(repo.count()).rejects.toThrow(StorageError);
		await expect(
			repo.addSnapshot({ parentId: null, metadata: { type: 'root', desc: 'r' }, delta: null })
		).rejects.toThrow(StorageError);
		await expect(repo.getBranches()).rejects.toThrow(StorageError);
	});
});
