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
	/** 帽子/头饰。 */
	headwear: string | null;
	top: string | null;
	/** 内衣。 */
	underwear: string | null;
	/** 内裤。 */
	underpants: string | null;
	bottom: string | null;
	/** 袜子。 */
	socks: string | null;
	shoes: string | null;
	/** 配饰列表，整体替换语义。 */
	accessories: string[];
	/** 衣柜：可选的衣物预设库（含穿后描述），供 AI 换装时挑选。 */
	wardrobe: ClothingItem[];
}

/** 地点状态（当前所在地）。 */
export interface LocationState {
	id: string;
	/** 大类，如「学校」；空串表示未分类。 */
	category: string;
	name: string;
	description: string;
}

/** 衣柜条目：衣物预设 + 穿上后的外观描述。 */
export interface ClothingItem {
	id: string;
	/** 大类，如「常服」「工作服」；空串表示未分类。 */
	category: string;
	name: string;
	/** 衣物类型（适用槽位）；缺省视为 any（任意槽位可选）。 */
	kind?: ClothingKind;
	/** 穿上后的描述（面料、版型、细节），供 LLM 精确还原穿着。 */
	description: string;
}

/** 衣物类型：与穿着槽位一一对应；any = 任意槽位可选（兼容未标注的老数据）。 */
export type ClothingKind =
	| 'headwear'
	| 'top'
	| 'underwear'
	| 'underpants'
	| 'bottom'
	| 'socks'
	| 'shoes'
	| 'accessory'
	| 'any';

/** 命名穿着槽位（OutfitState 中与衣柜条目类型对应的键）。 */
export type OutfitSlot =
	'headwear' | 'top' | 'underwear' | 'underpants' | 'bottom' | 'socks' | 'shoes';

/** 地点定义：AI 认知中的已知地点。 */
export interface LocationDef {
	id: string;
	/** 大类，如「学校」；空串表示未分类。 */
	category: string;
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
	/** 当前所在地（地点库 places 中的一项或其快照）。 */
	location: LocationState;
	/** 地点库：AI 知道的所有地点，与日程相互独立。 */
	places: LocationDef[];
	schedule: ScheduleState;
	attributes: CharacterAttributes;
}

/** 状态补丁：各子结构均可部分更新（用于增量快照与 store.update）。 */
export interface StatePatch {
	outfit?: Partial<OutfitState>;
	location?: Partial<LocationState>;
	/** 地点库整体替换。 */
	places?: LocationDef[];
	schedule?: Partial<ScheduleState>;
	attributes?: Partial<CharacterAttributes>;
}

/**
 * 世界配置覆盖：地点库 / 衣柜 / 日程条目的维护编辑不进入版本历史，
 * 而是单独持久化并在重建状态后叠加（剧情状态仍走快照链）。
 */
export interface ConfigOverrides {
	places?: LocationDef[];
	wardrobe?: ClothingItem[];
	scheduleEntries?: ScheduleEntry[];
}

/** 配置补丁：仅允许地点库 / 衣柜 / 日程条目三个字段。 */
export type ConfigPatch = {
	places?: LocationDef[];
	wardrobe?: ClothingItem[];
	scheduleEntries?: ScheduleEntry[];
};

/** 消息角色。 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** AI 一轮回复内的一个展示段：思考 / 正文 / 工具调用。 */
export interface MessageSegment {
	kind: 'thinking' | 'text' | 'tool';
	/** 段落内容（思考文本 / 对话正文 / 工具执行反馈）。 */
	content: string;
	/** 工具段：工具名（如 advance_time / set_outfit），展示用。 */
	toolName?: string;
	/** 工具段：参数摘要（如「minutes=30」），展示用。 */
	toolArgs?: string;
	/** 工具段状态：running=执行中（流式 transient）；error=执行失败。 */
	status?: 'running' | 'error';
}

/** 会话中展示用的消息视图（由快照链重建而来）。 */
export interface ChatMessageView {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
	/** 消息产生时的世界时间（供上下文标注，如「（周一 09:00）」）。 */
	worldTime?: WorldTime;
	/** 模型的思考过程（reasoning_content / reasoning），仅展示不发送。 */
	thinking?: string;
	/**
	 * AI 一轮回复的分段内容（思考 / 正文 / 工具调用按序排列）。
	 * 存在时气泡按段渲染；旧数据无此字段时回退到 thinking + content。
	 */
	segments?: MessageSegment[];
	/** 仅用于界面展示、不进入发送给 LLM 的上下文（如 /help 帮助文本）。 */
	skipContext?: boolean;
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
	| {
			kind: 'message';
			role: MessageRole;
			content: string;
			worldTime?: WorldTime;
			thinking?: string;
			segments?: MessageSegment[];
			skipContext?: boolean;
	  }
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
