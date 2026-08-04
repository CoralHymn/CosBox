import type { CharacterState, ChatMessageView, WorldInfoEntry } from '../core/types';
import type { ChatMessage } from '../llm/types';
import type { SearchResult } from '../search/types';
import {
	excludeFromContext,
	prepareHistory,
	type HistoryOptions,
	type HistoryResult
} from './history';
import { summarizeState } from './state-summary';
import { findWorldInfoHits, type WorldInfoHit } from './world-info';

/** 上下文管道的输入：当前状态 + 最近对话 + 世界信息。 */
export interface ContextPipelineInput {
	state: CharacterState;
	conversation: ReadonlyArray<ChatMessageView>;
	worldInfo: ReadonlyArray<WorldInfoEntry>;
	/** 角色名（默认取 attributes.name）。 */
	characterName?: string;
	/** 自定义系统提示（默认使用内置角色扮演模板）。 */
	systemPrompt?: string;
	/** 历史压缩参数。 */
	historyOptions?: HistoryOptions;
	/** 允许 AI 调用状态工具时，在系统提示中注入工具使用说明。 */
	enableStateTools?: boolean;
	/** 最近一次工具执行反馈（agent 循环注入），让模型确认工具已调用并生效。 */
	toolFeedback?: string;
	/** 可选的网络搜索结果，命中时注入系统提示。 */
	searchResults?: ReadonlyArray<SearchResult>;
}

/** 上下文管道的结构化输出。 */
export interface ContextBundle {
	/** 最终系统消息：基础提示 + 状态摘要 + 世界信息命中。 */
	systemMessage: string;
	/** 可直接发给 OpenAI-compatible API 的消息数组。 */
	messages: ChatMessage[];
	stateSummary: string;
	worldInfoHits: WorldInfoHit[];
	/** 处理后的历史（可能含压缩占位）。 */
	history: ChatMessageView[];
	compressedCount: number;
	searchResults: SearchResult[];
}

/** 默认角色扮演系统提示模板。 */
export function defaultSystemPrompt(name: string): string {
	return (
		`你是「${name}」，一名生活在虚拟学园中的角色。请以沉浸式角色扮演回应：\n` +
		`- 始终以角色身份说话，绝不承认自己是 AI 或模型。\n` +
		`- 下列【当前状态】是事实约束：穿着、地点、时间、日程与属性不得违背。\n` +
		`- 使用自然、简短的口语，符合角色年龄与性格。`
	);
}

/** 状态工具使用说明：让模型知道它可以主动调用工具更新剧情状态。 */
export function buildToolGuidance(): string {
	return [
		'【工具使用】',
		'你必须在剧情中主动调用工具来同步状态，不允许只口头描述或假设状态已变化：',
		'- 只要剧情暗示时间流逝（排队、等待、赶路、闲聊、用餐、入夜等）→ 立即调用 advance_time 推进到合理时刻；',
		'- 离开某地或到达新地点 → 立即调用 goto_location（优先从【已知地点】中选择）；',
		'- 穿上/脱下衣物 → 立即调用 set_outfit（必须从【衣柜】中选择，item 用精确名称；用「无」表示脱掉）；',
		'- 属性发生变化 → 立即调用 set_attribute。',
		'每次调用工具都会立即生效并返回反馈；「我这就去」「过了几分钟」这类表述不算数，必须真的调用工具。'
	].join('\n');
}

/**
 * 组装上下文：
 * 1) 世界信息关键词触发；
 * 2) 状态摘要注入；
 * 3) 历史压缩。
 */
export function buildContext(input: ContextPipelineInput): ContextBundle {
	// 只展示不给模型的消息（如 /help）不参与历史与世界信息触发。
	const contextConversation = excludeFromContext(input.conversation);
	const name =
		(input.characterName && input.characterName.trim()) ||
		(typeof input.state.attributes.name === 'string' ? input.state.attributes.name : '角色');
	const stateSummary = summarizeState(input.state);
	const historyResult: HistoryResult = prepareHistory(
		contextConversation,
		input.historyOptions ?? { maxMessages: 20 }
	);
	const worldInfoHits = findWorldInfoHits(
		contextConversation.map((message) => message.content),
		input.worldInfo
	);
	const searchResults = [...(input.searchResults ?? [])];

	const worldInfoBlock =
		worldInfoHits.length > 0
			? `\n【世界设定】\n${worldInfoHits.map((hit) => `- ${hit.content}`).join('\n')}`
			: '';
	const basePrompt = input.systemPrompt?.trim() || defaultSystemPrompt(name);
	const searchBlock =
		searchResults.length > 0
			? `\n【网络搜索结果】\n${searchResults
					.map((result) => `- ${result.title}：${result.snippet}（${result.url}）`)
					.join('\n')}`
			: '';
	const toolBlock = input.enableStateTools === true ? `\n\n${buildToolGuidance()}` : '';
	const feedbackBlock =
		input.toolFeedback !== undefined && input.toolFeedback.trim() !== ''
			? `\n\n${input.toolFeedback.trim()}`
			: '';
	const systemMessage = `${basePrompt}\n\n${stateSummary}${worldInfoBlock}${searchBlock}${toolBlock}${feedbackBlock}`;
	const messages: ChatMessage[] = historyResult.messages.map((message) => ({
		role: message.role,
		content: message.content
	}));

	return {
		systemMessage,
		messages,
		stateSummary,
		worldInfoHits,
		history: historyResult.messages,
		compressedCount: historyResult.compressedCount,
		searchResults
	};
}
