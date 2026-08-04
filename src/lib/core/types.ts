/**
 * CosBox 核心领域类型。
 *
 * 所有类型均为「第一公民数据」：角色状态、快照、世界信息都是独立的结构化实体，
 * 而不是聊天消息的附件。
 */

/** 世界时间：星期几 + 24 小时制。 */
export interface WorldTime {
	/** 0=周一，1=周二 … 6=周日。 */
	day: number;
	/** 小时，0-23。 */
	hour: number;
	/** 分钟，0-59。 */
	minute: number;
}

/** 日程条目：某一天内的一个时间段。 */
export interface ScheduleEntry {
	/** 稳定标识。 */
	id: string;
	/** 0=周一 … 6=周日。 */
	day: number;
	/** 当日 00:00 起的开始分钟数，0-1439。 */
	start: number;
	/** 当日 00:00 起的结束分钟数，1-1440。 */
	end: number;
	/** 活动标题。 */
	title: string;
	/** 可选：关联地点 id。 */
	locationId?: string;
}

/** 日程状态：当前世界时间 + 周期性日程表。 */
export interface ScheduleState {
	time: WorldTime;
	entries: ScheduleEntry[];
}

/** 穿着状态：结构化服装槽位。 */
export interface OutfitState {
	top: string | null;
	bottom: string | null;
	shoes: string | null;
	/** 配饰列表，整体替换语义。 */
	accessories: string[];
}

/** 地点状态。 */
export interface LocationState {
	id: string;
	name: string;
	description: string;
}

/** 属性值：仅允许 number / string / boolean。 */
export type AttributeValue = number | string | boolean;

/** 角色属性表（亲和度、信任、金钱等自由键值）。 */
export type CharacterAttributes = Record<string, AttributeValue>;

/** 角色完整状态：穿 / 地 / 程 / 属 四大块。 */
export interface CharacterState {
	outfit: OutfitState;
	location: LocationState;
	schedule: ScheduleState;
	attributes: CharacterAttributes;
}

/** 状态补丁：各子结构均可部分更新（用于增量快照与 store.update）。 */
export interface StatePatch {
	outfit?: Partial<OutfitState>;
	location?: Partial<LocationState>;
	schedule?: Partial<ScheduleState>;
	attributes?: Partial<CharacterAttributes>;
}

/** 消息角色。 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 会话中展示用的消息视图（由快照链重建而来）。 */
export interface ChatMessageView {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
}

/** 快照元信息：类型 + 人类可读描述。 */
export interface SnapshotMetadata {
	/** root=初始根；state=状态变更；message=对话消息；checkpoint=手动检查点。 */
	type: 'root' | 'state' | 'message' | 'checkpoint';
	desc: string;
}

/** 快照 delta：状态补丁、消息、或空（检查点）。 */
export type SnapshotDelta =
	| { kind: 'state'; patch: StatePatch }
	| { kind: 'message'; role: MessageRole; content: string }
	| null;

/** 版本图节点：单父多子的增量快照。 */
export interface SnapshotNode {
	id: string;
	timestamp: number;
	parentId: string | null;
	metadata: SnapshotMetadata;
	delta: SnapshotDelta;
}

/** 分支摘要：每个无子节点的 tip 代表一条分支的末端。 */
export interface BranchSummary {
	tipId: string;
	/** 从根到 tip 的节点数减一（深度）。 */
	depth: number;
	lastTimestamp: number;
	desc: string;
	type: SnapshotMetadata['type'];
}

/** 世界信息条目：关键词触发式设定注入。 */
export interface WorldInfoEntry {
	id: string;
	/** 触发关键词（大小写不敏感，多词关键词按字面连续匹配）。 */
	keys: string[];
	/** 命中后注入到上下文的内容。 */
	content: string;
	enabled: boolean;
	/** 优先级，越大越靠前。 */
	priority: number;
	/** 备注（用于导入导出映射）。 */
	comment?: string;
}

/** 给 UI 使用的不可变会话视图（快照一次后的组合对象）。 */
export interface CharacterSessionView {
	state: CharacterState;
	headId: string | null;
	conversation: ChatMessageView[];
	snapshots: SnapshotNode[];
	branches: BranchSummary[];
}
