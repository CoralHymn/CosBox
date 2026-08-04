import { describe, expect, it } from 'vitest';
import { SnapshotError } from './errors';
import {
	chainToRoot,
	collectLinearChain,
	createRootSnapshot,
	getBranchTips,
	getChildrenMap,
	getDepth,
	isBranchPoint,
	isMessageDelta,
	isStateDelta,
	rebuildFromNodes,
	sortNodes
} from './snapshot';
import { createInitialState } from './state';
import type { SnapshotNode } from './types';

function makeNode(
	id: string,
	parentId: string | null,
	delta: SnapshotNode['delta'],
	timestamp = 1
): SnapshotNode {
	return {
		id,
		timestamp,
		parentId,
		metadata: {
			type: delta?.kind === 'message' ? 'message' : delta ? 'state' : 'checkpoint',
			desc: id
		},
		delta
	};
}

function toMap(nodes: SnapshotNode[]): Map<string, SnapshotNode> {
	return new Map(nodes.map((node) => [node.id, node]));
}

describe('createRootSnapshot', () => {
	it('创建无父节点、delta 为 null 的根', () => {
		const root = createRootSnapshot(createInitialState(), 100, 'root-1');
		expect(root.parentId).toBeNull();
		expect(root.delta).toBeNull();
		expect(root.metadata.type).toBe('root');
		expect(root.id).toBe('root-1');
	});

	it('非法初始状态抛错', () => {
		expect(() => createRootSnapshot({ ...createInitialState(), outfit: null as never })).toThrow();
	});
});

describe('delta 判断', () => {
	it('isStateDelta 只认 state 补丁', () => {
		expect(isStateDelta({ kind: 'state', patch: {} })).toBe(true);
		expect(isStateDelta({ kind: 'message', role: 'user', content: 'hi' })).toBe(false);
		expect(isStateDelta(null)).toBe(false);
	});

	it('isMessageDelta 只认消息', () => {
		expect(isMessageDelta({ kind: 'message', role: 'user', content: 'hi' })).toBe(true);
		expect(isMessageDelta({ kind: 'state', patch: {} })).toBe(false);
		expect(isMessageDelta(null)).toBe(false);
	});
});

describe('sortNodes', () => {
	it('按 timestamp 再按 id 排序且不修改原数组', () => {
		const a = makeNode('a', null, null, 5);
		const b = makeNode('b', null, null, 2);
		const c = makeNode('c', null, null, 2);
		const sorted = sortNodes([a, b, c]);
		expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
		expect([a, b, c].map((n) => n.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('chainToRoot', () => {
	it('返回根到目标的链', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode('a', 'root', { kind: 'state', patch: {} }, 2),
			makeNode('b', 'a', { kind: 'message', role: 'user', content: 'hi' }, 3)
		]);
		expect(chainToRoot(nodes, 'b').map((n) => n.id)).toEqual(['root', 'a', 'b']);
	});

	it('目标不存在抛 SnapshotError', () => {
		expect(() => chainToRoot(new Map(), 'missing')).toThrow(SnapshotError);
	});

	it('检测成环', () => {
		const nodes = toMap([makeNode('a', 'b', null, 1), makeNode('b', 'a', null, 2)]);
		expect(() => chainToRoot(nodes, 'a')).toThrow(SnapshotError);
	});
});

describe('rebuildFromNodes', () => {
	it('根节点自身不参与 delta 应用', () => {
		const root: SnapshotNode = {
			...makeNode('root', null, null, 1),
			delta: { kind: 'state', patch: { attributes: { x: 1 } } }
		};
		const result = rebuildFromNodes(toMap([root]), 'root', createInitialState());
		expect(result.state.attributes.x).toBeUndefined();
		expect(result.appliedDeltas).toBe(0);
	});

	it('120+ 次 delta 应用后重建正确（状态+消息+空补丁混合）', () => {
		const nodes: SnapshotNode[] = [makeNode('root', null, null, 0)];
		let parent = 'root';
		const initial = createInitialState();
		let expectedAffection = initial.attributes.affection as number;
		for (let i = 1; i <= 120; i += 1) {
			if (i % 3 === 0) {
				nodes.push(
					makeNode(
						`msg-${i}`,
						parent,
						{ kind: 'message', role: 'user', content: `第${i}条消息` },
						i
					)
				);
			} else if (i % 3 === 1) {
				expectedAffection += 1;
				nodes.push(
					makeNode(
						`st-${i}`,
						parent,
						{ kind: 'state', patch: { attributes: { affection: expectedAffection } } },
						i
					)
				);
			} else {
				nodes.push(makeNode(`empty-${i}`, parent, null, i));
			}
			parent = nodes[nodes.length - 1]!.id;
		}
		const result = rebuildFromNodes(toMap(nodes), parent, initial);
		expect(result.state.attributes.affection).toBe(expectedAffection);
		expect(result.messages).toHaveLength(40);
		expect(result.messages[0]!.content).toBe('第3条消息');
		expect(result.messages[39]!.content).toBe('第120条消息');
		expect(result.appliedDeltas).toBe(40);
	});

	it('空 delta 与检查点安全跳过', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode('ck', 'root', null, 2),
			makeNode('msg', 'ck', { kind: 'message', role: 'assistant', content: '你好' }, 3)
		]);
		const result = rebuildFromNodes(nodes, 'msg');
		expect(result.state.attributes.name).toBe('绫音');
		expect(result.messages.map((m) => m.content)).toEqual(['你好']);
		expect(result.appliedDeltas).toBe(0);
	});

	it('最终状态非法时抛错（数据损坏防护）', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode(
				'bad',
				'root',
				{ kind: 'state', patch: { schedule: { time: { day: 9, hour: 0, minute: 0 } } } },
				2
			)
		]);
		expect(() => rebuildFromNodes(nodes, 'bad')).toThrow();
	});
});

describe('getChildrenMap / getDepth / isBranchPoint / getBranchTips', () => {
	it('getChildrenMap 按时间排序且忽略根', () => {
		const nodes = [
			makeNode('root', null, null, 1),
			makeNode('late', 'root', null, 5),
			makeNode('early', 'root', null, 2)
		];
		expect(
			getChildrenMap(nodes)
				.get('root')
				?.map((n) => n.id)
		).toEqual(['early', 'late']);
		expect(getChildrenMap(nodes).has('early')).toBe(false);
	});

	it('getDepth 根为 0、后代递增', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode('a', 'root', null, 2),
			makeNode('b', 'a', null, 3)
		]);
		expect(getDepth(nodes, 'root')).toBe(0);
		expect(getDepth(nodes, 'a')).toBe(1);
		expect(getDepth(nodes, 'b')).toBe(2);
	});

	it('getBranchTips 返回所有无子节点 tip', () => {
		const nodes = [
			makeNode('root', null, null, 1),
			makeNode('a1', 'root', null, 2),
			makeNode('a2', 'root', null, 3),
			makeNode('b1', 'a1', { kind: 'message', role: 'user', content: 'x' }, 4)
		];
		const tips = getBranchTips(nodes);
		expect(tips.map((t) => t.tipId).sort()).toEqual(['a2', 'b1']);
		const b1 = tips.find((t) => t.tipId === 'b1')!;
		expect(b1.depth).toBe(2);
		expect(b1.lastTimestamp).toBe(4);
		expect(b1.type).toBe('message');
	});

	it('空节点集合返回空 tip 列表', () => {
		expect(getBranchTips([])).toEqual([]);
	});

	it('isBranchPoint 判断多子节点', () => {
		const nodes = [
			makeNode('root', null, null, 1),
			makeNode('a', 'root', null, 2),
			makeNode('b', 'root', null, 3)
		];
		expect(isBranchPoint(nodes, 'root')).toBe(true);
		expect(isBranchPoint(nodes, 'a')).toBe(false);
	});
});

describe('collectLinearChain', () => {
	it('单链返回全部节点（含起点）', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode('a', 'root', null, 2),
			makeNode('b', 'a', null, 3)
		]);
		const chain = collectLinearChain(getChildrenMap(nodes.values()), nodes.get('root')!);
		expect(chain.map((n) => n.id)).toEqual(['root', 'a', 'b']);
	});

	it('分支点处停止（不含分支孩子）', () => {
		const nodes = toMap([
			makeNode('root', null, null, 1),
			makeNode('a', 'root', null, 2),
			makeNode('b', 'root', null, 3)
		]);
		const chain = collectLinearChain(getChildrenMap(nodes.values()), nodes.get('root')!);
		expect(chain.map((n) => n.id)).toEqual(['root']);
	});

	it('叶子返回自身', () => {
		const nodes = toMap([makeNode('leaf', null, null, 1)]);
		const chain = collectLinearChain(getChildrenMap(nodes.values()), nodes.get('leaf')!);
		expect(chain.map((n) => n.id)).toEqual(['leaf']);
	});
});
