import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from '../core/types';
import { prepareHistory } from './history';

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
});
