/** 记忆来源：手动添加或 LLM 提取。 */
export type MemorySource = 'manual' | 'extract';

/** 预设记忆分类（UI 下拉与筛选用；允许自定义分类）。 */
export const MEMORY_CATEGORIES = [
	'人物关系',
	'重要事件',
	'角色偏好',
	'日常习惯',
	'地点相关',
	'约定承诺',
	'其他'
] as const;

/** 长期记忆条目：一句话事实 + 触发词 + 权重，随上下文召回注入。 */
export interface MemoryEntry {
	id: string;
	/**
	 * 所属工作区（多工作区分区键）。应用层创建时可省略，
	 * 由 db 层（MemoryRepository）统一盖章；落库后必存在。
	 */
	workspaceId?: string;
	/** 记忆正文（事实陈述，AI 注入时原样使用）。 */
	content: string;
	/** 分类（预设之一或自定义）。 */
	category: string;
	/** 召回触发词：命中最近对话内容时优先注入。 */
	keywords: string[];
	/** 重要度 1-5，越大越优先召回。 */
	importance: number;
	/** 置顶：每次都注入，不受召回数量限制（仍受注入上限约束）。 */
	pinned: boolean;
	source: MemorySource;
	createdAt: number;
	updatedAt: number;
	/** 最近一次被召回注入的时间。 */
	lastUsedAt: number;
	/** 累计被召回次数。 */
	useCount: number;
}

/** LLM 提取的候选记忆（尚未分配 id 与使用统计）。 */
export interface ExtractedMemory {
	content: string;
	category: string;
	keywords: string[];
	importance: number;
}
