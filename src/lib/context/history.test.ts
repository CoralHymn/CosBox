import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from '../core/types';
import { excludeFromContext, prepareHistory } from './history';

function msg(id: string, content: string): ChatMessageView {
	return { id, role: 'user', content, timestamp: Number(id) };
}

describe('prepareHistory', () => {
	it('数量未超限时原样保留', () => {
		const conversation = [msg('1', 'a'), msg('2', 'b')];
		const result = prepareHistory(conversation, { maxMessages: 5 });
		expect(result.messages).toEqual(conversation);
		expect(result.compressedCount).toBe(0);
		expect(result.truncated).toBe(0);
	});

	it('超限时保留最近 N 条并插入压缩占位', () => {
		const conversation = [msg('1', 'a'), msg('2', 'b'), msg('3', 'c'), msg('4', 'd')];
		const result = prepareHistory(conversation, { maxMessages: 2 });
		expect(result.compressedCount).toBe(2);
		expect(result.messages.map((m) => m.content)).toEqual([
			'【早前对话已压缩：2 条消息】',
			'c',
			'd'
		]);
		expect(result.messages[0]!.role).toBe('system');
	});

	it('maxMessages 为 0 时仍保留 1 条', () => {
		const conversation = [msg('1', 'a'), msg('2', 'b')];
		const result = prepareHistory(conversation, { maxMessages: 0 });
		expect(result.compressedCount).toBe(1);
		expect(result.messages.map((m) => m.content)).toEqual(['【早前对话已压缩：1 条消息】', 'b']);
	});

	it('超长消息截断并统计', () => {
		const long = msg('1', 'x'.repeat(20));
		const result = prepareHistory([long], { maxMessages: 10, maxCharsPerMessage: 5 });
		expect(result.truncated).toBe(1);
		expect(result.messages[0]!.content).toBe('xxxxx…');
	});

	it('空会话安全返回', () => {
		const result = prepareHistory([], { maxMessages: 5 });
		expect(result.messages).toEqual([]);
		expect(result.compressedCount).toBe(0);
	});

	it('skipContext 消息不进入发送历史，也不计入压缩数', () => {
		const conversation: ChatMessageView[] = [
			{ id: '1', role: 'system', content: '可用 RP 快捷命令', timestamp: 1, skipContext: true },
			{ id: '2', role: 'user', content: '早上好', timestamp: 2 },
			{ id: '3', role: 'assistant', content: '你好呀', timestamp: 3 }
		];
		const result = prepareHistory(conversation, { maxMessages: 2 });
		expect(result.messages.map((m) => m.content)).toEqual(['早上好', '你好呀']);
		expect(result.compressedCount).toBe(0);
	});
});

describe('excludeFromContext', () => {
	it('过滤 skipContext 消息，其余原样保留', () => {
		const conversation: ChatMessageView[] = [
			{ id: '1', role: 'system', content: '帮助', timestamp: 1, skipContext: true },
			{ id: '2', role: 'user', content: '你好', timestamp: 2 },
			{ id: '3', role: 'system', content: '命令已执行', timestamp: 3 }
		];
		expect(excludeFromContext(conversation).map((m) => m.id)).toEqual(['2', '3']);
	});

	it('未标记 skipContext 的消息全部保留', () => {
		const conversation: ChatMessageView[] = [
			{ id: '1', role: 'user', content: 'a', timestamp: 1 },
			{ id: '2', role: 'assistant', content: 'b', timestamp: 2 }
		];
		expect(excludeFromContext(conversation)).toEqual(conversation);
	});
});
