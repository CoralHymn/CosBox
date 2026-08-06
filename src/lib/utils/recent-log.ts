import type { ChatMessageView } from '../core/types';

/**
 * 从会话中构建「最近消息日志」：从**最近一条用户发言**开始，
 * 记录其后的全部文本（角色回复、思考过程、系统/工具反馈）。
 * 若会话中没有用户发言，返回空串。
 */
export function buildRecentLog(conversation: ReadonlyArray<ChatMessageView>): string {
	let lastUserIndex = -1;
	for (let i = conversation.length - 1; i >= 0; i -= 1) {
		if (conversation[i]!.role === 'user') {
			lastUserIndex = i;
			break;
		}
	}
	if (lastUserIndex === -1) {
		return '';
	}
	const lines: string[] = [];
	for (let i = lastUserIndex; i < conversation.length; i += 1) {
		const message = conversation[i]!;
		if (message.role === 'user') {
			lines.push(`[用户] ${message.content}`);
		} else if (message.role === 'assistant') {
			if (message.content.trim() !== '') {
				lines.push(`[角色] ${message.content}`);
			}
			if (message.thinking !== undefined && message.thinking.trim() !== '') {
				lines.push(`[角色思考] ${message.thinking}`);
			}
		} else if (message.role === 'system') {
			lines.push(`[系统] ${message.content}`);
		}
	}
	return lines.join('\n\n');
}
