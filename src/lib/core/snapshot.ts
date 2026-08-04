import { SnapshotError } from './errors';
import { clonePlain } from './clone';
import { applyStateDelta, createInitialState, validateCharacterState } from './state';
import type {
	BranchSummary,
	CharacterState,
	ChatMessageView,
	MessageRole,
	SnapshotDelta,
	SnapshotNode,
	StatePatch
} from './types';
import { newId } from '../utils/id';

/** 重建结果：目标快照处的完整状态 + 按时间排序的消息序列。 */
export interface RebuildResult {
	state: CharacterState;
	messages: ChatMessageView[];
	/** 实际应用了多少个状态补丁（空补丁不计）。 */
	appliedDeltas: number;
}

/**
 * 创建根快照。根快照是版本图的唯一无父节点，delta 固定为 null，
 * 初始状态由 createInitialState() 提供（见 rebuildFromNodes）。
 */
export function createRootSnapshot(
	initialState: CharacterState = createInitialState(),
	timestamp: number = Date.now(),
	id: string = newId()
): SnapshotNode {
	validateCharacterState(initialState);
	return {
		id,
		timestamp,
		parentId: null,
		metadata: { type: 'root', desc: '初始状态' },
		delta: null
	};
}

/** 判断 delta 是否为状态补丁。 */
export function isStateDelta(delta: SnapshotDelta): delta is { kind: 'state'; patch: StatePatch } {
	return delta !== null && delta.kind === 'state';
}

/** 判断 delta 是否为消息。 */
export function isMessageDelta(delta: SnapshotDelta): delta is {
	kind: 'message';
	role: MessageRole;
	content: string;
	thinking?: string;
	skipContext?: boolean;
} {
	return delta !== null && delta.kind === 'message';
}

/** 按 timestamp 升序、id 升序排序节点（确定性顺序，供 UI 与测试）。 */
export function sortNodes(nodes: SnapshotNode[]): SnapshotNode[] {
	return [...nodes].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/**
 * 从任意节点沿 parentId 回溯到根，返回「根 -> 目标」顺序的链。
 * 节点缺失或出现环时抛 SnapshotError。
 */
export function chainToRoot(
	nodes: ReadonlyMap<string, SnapshotNode>,
	targetId: string
): SnapshotNode[] {
	const chain: SnapshotNode[] = [];
	const visited = new Set<string>();
	let cursor: string | null = targetId;
	while (cursor !== null) {
		if (visited.has(cursor)) {
			throw new SnapshotError(`快照链出现环：${cursor}`);
		}
		visited.add(cursor);
		const node = nodes.get(cursor);
		if (!node) {
			throw new SnapshotError(`快照不存在：${cursor}`);
		}
		chain.push(node);
		cursor = node.parentId;
	}
	chain.reverse();
	return chain;
}

/**
 * 从节点集合重建目标快照处的状态与会话。
 * 规则：
 * - 从根开始依次应用状态补丁（根自身的 delta 不参与，初始状态即根的基线）。
 * - 消息节点按链顺序收集为 ChatMessageView。
 * - null delta（检查点）安全跳过。
 * 纯函数：不修改传入的 nodes。
 */
export function rebuildFromNodes(
	nodes: ReadonlyMap<string, SnapshotNode>,
	targetId: string,
	initialState: CharacterState = createInitialState()
): RebuildResult {
	const chain = chainToRoot(nodes, targetId);
	let state = clonePlain(initialState);
	const messages: ChatMessageView[] = [];
	let appliedDeltas = 0;

	for (const node of chain) {
		if (node.parentId === null) {
			continue;
		}
		const delta = node.delta;
		if (isStateDelta(delta)) {
			state = applyStateDelta(state, delta.patch);
			appliedDeltas += 1;
		} else if (isMessageDelta(delta)) {
			messages.push({
				id: node.id,
				role: delta.role,
				content: delta.content,
				timestamp: node.timestamp,
				...(delta.thinking !== undefined && delta.thinking !== ''
					? { thinking: delta.thinking }
					: {}),
				...(delta.skipContext === true ? { skipContext: true } : {})
			});
		}
	}

	validateCharacterState(state);
	return { state, messages, appliedDeltas };
}

/** 构建 parentId -> 子节点数组 的映射，子节点按时间升序。 */
export function getChildrenMap(nodes: Iterable<SnapshotNode>): Map<string, SnapshotNode[]> {
	const map = new Map<string, SnapshotNode[]>();
	for (const node of nodes) {
		if (node.parentId === null) {
			continue;
		}
		const siblings = map.get(node.parentId) ?? [];
		siblings.push(node);
		map.set(node.parentId, siblings);
	}
	for (const [parentId, siblings] of map) {
		map.set(parentId, sortNodes(siblings));
	}
	return map;
}

/** 计算某节点从根开始的深度（根深度为 0）。 */
export function getDepth(nodes: ReadonlyMap<string, SnapshotNode>, id: string): number {
	return Math.max(0, chainToRoot(nodes, id).length - 1);
}

/**
 * 返回所有分支 tip：没有子节点的节点即分支末端。
 * 结果按 lastTimestamp 升序，便于 UI 稳定渲染。
 */
export function getBranchTips(nodes: Iterable<SnapshotNode>): BranchSummary[] {
	const list = sortNodes([...nodes]);
	const children = getChildrenMap(list);
	const tips = list.filter((node) => !children.has(node.id));
	return tips.map((tip) => ({
		tipId: tip.id,
		depth: getDepth(new Map(list.map((n) => [n.id, n])), tip.id),
		lastTimestamp: tip.timestamp,
		desc: tip.metadata.desc,
		type: tip.metadata.type
	}));
}

/** 某节点是否有多个子节点（即分支点）。 */
export function isBranchPoint(nodes: Iterable<SnapshotNode>, id: string): boolean {
	const children = getChildrenMap(nodes).get(id);
	return children !== undefined && children.length > 1;
}

/**
 * 收集从 start 开始沿单链向下的节点序列（含起点）。
 * 遇到叶子（无孩子）或分支点（多个孩子）时停止。
 * 用于版本树 UI：链式节点平级渲染，避免快照树随对话增长无限向右缩进。
 */
export function collectLinearChain(
	childrenMap: ReadonlyMap<string, SnapshotNode[]>,
	start: SnapshotNode
): SnapshotNode[] {
	const chain: SnapshotNode[] = [];
	let cursor: SnapshotNode | undefined = start;
	while (cursor !== undefined) {
		chain.push(cursor);
		const children: SnapshotNode[] = childrenMap.get(cursor.id) ?? [];
		if (children.length !== 1) {
			break;
		}
		cursor = children[0];
	}
	return chain;
}

/**
 * 收集分支链：从 tip 沿 parentId 向上，直到分支点（多子节点）或根为止（不含分支点与根）。
 * 用于「删除分支」：删除该链上的节点后，分支点保留。
 */
export function collectBranchPath(
	childrenMap: ReadonlyMap<string, SnapshotNode[]>,
	nodes: ReadonlyMap<string, SnapshotNode>,
	tipId: string
): SnapshotNode[] {
	const path: SnapshotNode[] = [];
	let cursor: string | null = tipId;
	while (cursor !== null) {
		const node = nodes.get(cursor);
		if (node === undefined || node.parentId === null) {
			break;
		}
		path.push(node);
		const siblings = childrenMap.get(node.parentId) ?? [];
		if (siblings.length > 1) {
			break;
		}
		cursor = node.parentId;
	}
	return path;
}
