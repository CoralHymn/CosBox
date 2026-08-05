import type { ChatMessageView } from '../core/types';

/** /help 帮助文本的稳定前缀（内容级兜底，兼容早期未打 skipContext 标记的快照）。 */
export const HELP_TEXT_PREFIX = '可用 RP 快捷命令';

/**
 * 过滤掉仅用于展示、不进入 LLM 上下文的消息（如 /help 帮助文本）。
 * 这类消息仍在会话/快照中完整保留，只是不发给模型。
 * 除了显式标记外，还按内容识别帮助文本，保证旧会话数据同样被排除。
 */
export function excludeFromContext(
	conversation: ReadonlyArray<ChatMessageView>
): ChatMessageView[] {
	return conversation.filter(
		(message) =>
			message.skipContext !== true &&
			!(message.role === 'system' && message.content.startsWith(HELP_TEXT_PREFIX))
	);
}

/** 历史压缩选项。 */
export interface HistoryOptions {
	/** 保留的最大消息数（至少 1）。 */
	maxMessages: number;
	/** 单条消息最大字符数，超出截断。 */
	maxCharsPerMessage?: number;
}

/** 历史处理结果。 */
export interface HistoryResult {
	messages: ChatMessageView[];
	/** 被压缩（丢弃）的早期消息数。 */
	compressedCount: number;
	/** 因过长而被截断的消息数。 */
	truncated: number;
}

/**
 * 为 LLM 准备对话历史：
 * - 超出 maxMessages 时保留最近 N 条，并在开头插入压缩占位系统消息。
 * - 超长消息截断到 maxCharsPerMessage。
 * 压缩为有损操作，故返回统计信息便于 UI/日志展示。
 */
export function prepareHistory(
	conversation: ReadonlyArray<ChatMessageView>,
	options: HistoryOptions = { maxMessages: 20 }
): HistoryResult {
	const contextMessages = excludeFromContext(conversation);
	const max = Math.max(1, Math.floor(options.maxMessages));
	const charLimit = options.maxCharsPerMessage ?? 1200;
	const kept = contextMessages.slice(-max);
	let truncated = 0;

	const messages = kept.map((message) => {
		let body = message.content;
		if (message.content.length > charLimit) {
			truncated += 1;
			body = `${message.content.slice(0, charLimit)}…`;
		}
		// 正文保持纯净：worldTime 原样保留在消息上，由 API 边界序列化时
		// 注入为元数据标注（见 llm/message-time.ts），避免模型模仿复述。
		return { ...message, content: body };
	});

	const compressedCount = Math.max(0, contextMessages.length - kept.length);
	if (compressedCount > 0) {
		messages.unshift({
			id: 'compressed',
			role: 'system',
			content: `【早前对话已压缩：${compressedCount} 条消息】`,
			timestamp: 0
		});
	}

	return { messages, compressedCount, truncated };
}
