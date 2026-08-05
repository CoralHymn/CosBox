import type { ChatMessageView } from '../core/types';
import { truncate } from '../utils/format';
import { formatWorldTimeLabel } from './message-time';
import type { ChatMessage } from './types';

/** 默认保留的最近消息条数：摘要之外原样发送。 */
export const DEFAULT_KEEP_RECENT = 20;
/** 默认压缩触发阈值：估计用量（含输出预算）占上下文窗口的比例。 */
export const DEFAULT_COMPACT_THRESHOLD = 0.8;
/** 压缩摘要消息的标记前缀。 */
export const SUMMARY_MARKER = '【上下文摘要】';

/** 压缩状态：摘要文本 + 摘要覆盖的边界消息 id。 */
export interface CompactionState {
	summary: string;
	/** 该 id 及其之后的消息尚未被摘要；id 之前的消息已并入 summary。 */
	boundaryId: string;
}

/** 摘要请求的系统提示：延续导向，保留角色扮演所需的关键细节。 */
export const SUMMARY_SYSTEM_PROMPT =
	'请把下面的对话压缩成一段面向「继续角色扮演」的延续摘要，直接输出摘要正文：' +
	'保留角色关系、当前处境、目标、已发生的重要事件与未完成的约定；' +
	'忽略寒暄、重复细节与无信息量的表述；如果提供了已有摘要，请把新消息合并进去而不是重复叙述。';

/**
 * 判断是否需要压缩：估算用量（含输出预留）达到阈值 × 上下文窗口。
 * 上下文窗口或阈值非法时返回 false（不压缩，避免误伤）。
 */
export function shouldCompact(
	totalTokens: number,
	outputBudget: number,
	contextWindow: number,
	threshold: number
): boolean {
	if (contextWindow <= 0 || threshold <= 0 || totalTokens < 0) {
		return false;
	}
	return totalTokens + Math.max(0, outputBudget) >= threshold * contextWindow;
}

/** 返回 boundaryId 在会话中的下标；未找到返回 -1。 */
export function findBoundaryIndex(
	conversation: ReadonlyArray<ChatMessageView>,
	boundaryId: string
): number {
	return conversation.findIndex((message) => message.id === boundaryId);
}

/**
 * 取 boundary 之后（含 boundary）的消息；boundary 缺失（如 checkout 到其他分支）时
 * 返回整段会话，让摘要从当前分支重新开始。
 */
export function messagesAfterBoundary(
	conversation: ReadonlyArray<ChatMessageView>,
	boundaryId: string | null
): ChatMessageView[] {
	if (boundaryId === null) {
		return [...conversation];
	}
	const index = findBoundaryIndex(conversation, boundaryId);
	return index === -1 ? [...conversation] : conversation.slice(index);
}

/**
 * 组装摘要请求消息：系统提示 + 已有摘要（可选）+ 待压缩消息序列化。
 * includePrevious 只在 boundary 仍存在于会话时置真，避免跨分支带入无关摘要。
 */
export function buildSummaryRequest(
	state: CompactionState | null,
	messages: ReadonlyArray<ChatMessageView>,
	includePrevious: boolean
): ChatMessage[] {
	const previous =
		includePrevious && state !== null && state.summary.trim() !== ''
			? `【已有摘要】\n${state.summary.trim()}\n\n请把下面新增的对话合并进上面的摘要，保持连贯。\n\n`
			: '';
	return [
		{ role: 'system', content: SUMMARY_SYSTEM_PROMPT },
		{
			role: 'user',
			content:
				previous +
				messages
					.map((message) => {
						const label =
							message.worldTime !== undefined ? formatWorldTimeLabel(message.worldTime) : '';
						return `[${message.role}]${label} ${message.content}`;
					})
					.join('\n')
		}
	];
}

/**
 * 组装压缩后的发送历史：摘要系统消息 + 最近消息（原样保留）。
 * 摘要为空时退化为只发最近消息，避免空摘要占位。
 */
export function buildCompactedHistory(
	summary: string,
	recent: ReadonlyArray<ChatMessageView>
): ChatMessageView[] {
	const clean = summary.trim();
	if (clean === '') {
		return [...recent];
	}
	return [
		{
			id: 'context-summary',
			role: 'system',
			content: `${SUMMARY_MARKER}\n${clean}`,
			timestamp: 0
		},
		...recent
	];
}

/**
 * 确定性兜底摘要：当模型摘要失败（非取消）时使用，保证对话不中断。
 * 仍比「直接丢弃」信息量大：说明压缩了多少条与最近话题。
 */
export function fallbackSummary(messages: ReadonlyArray<ChatMessageView>): string {
	const lastUser = [...messages].reverse().find((message) => message.role === 'user');
	const tail =
		lastUser === undefined ? '无可补充信息' : `最近提到「${truncate(lastUser.content, 40)}」`;
	return `（压缩摘要）已总结 ${messages.length} 条早期消息，${tail}。`;
}

/** 把摘要请求消息序列化为纯文本（供复制/调试）。 */
export function serializeSummaryRequest(messages: ReadonlyArray<ChatMessage>): string {
	return messages
		.map((message) => {
			const label = message.worldTime !== undefined ? formatWorldTimeLabel(message.worldTime) : '';
			return `[${message.role}]${label} ${message.content}`;
		})
		.join('\n\n');
}
