import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from '../core/types';
import {
	buildCompactedHistory,
	buildSummaryRequest,
	fallbackSummary,
	findBoundaryIndex,
	messagesAfterBoundary,
	serializeSummaryRequest,
	shouldCompact,
	SUMMARY_MARKER,
	SUMMARY_SYSTEM_PROMPT,
	type CompactionState
} from './compaction';

function message(id: string, role: ChatMessageView['role'], content: string): ChatMessageView {
	return { id, role, content, timestamp: 1 };
}

describe('shouldCompact', () => {
	it('用量 + 输出预算达到阈值时返回 true', () => {
		expect(shouldCompact(70, 10, 100, 0.8)).toBe(true);
	});

	it('未达到阈值时返回 false', () => {
		expect(shouldCompact(60, 10, 100, 0.8)).toBe(false);
	});

	it('非法上下文窗口 / 阈值 / 用量返回 false', () => {
		expect(shouldCompact(100, 10, 0, 0.8)).toBe(false);
		expect(shouldCompact(100, 10, 100, 0)).toBe(false);
		expect(shouldCompact(-1, 10, 100, 0.8)).toBe(false);
	});

	it('负输出预算按 0 计', () => {
		expect(shouldCompact(80, -5, 100, 0.8)).toBe(true);
	});
});

describe('findBoundaryIndex / messagesAfterBoundary', () => {
	const conversation = [message('a', 'user', '1'), message('b', 'assistant', '2')];

	it('找到 boundary 下标', () => {
		expect(findBoundaryIndex(conversation, 'b')).toBe(1);
	});

	it('未找到返回 -1', () => {
		expect(findBoundaryIndex(conversation, 'zz')).toBe(-1);
	});

	it('boundary 为 null 时返回整段会话', () => {
		expect(messagesAfterBoundary(conversation, null)).toEqual(conversation);
	});

	it('boundary 存在时返回其后的消息（含 boundary）', () => {
		expect(messagesAfterBoundary(conversation, 'b').map((m) => m.id)).toEqual(['b']);
	});

	it('boundary 缺失（如 checkout）时返回整段会话', () => {
		expect(messagesAfterBoundary(conversation, 'zz').map((m) => m.id)).toEqual(['a', 'b']);
	});
});

describe('buildSummaryRequest', () => {
	const state: CompactionState = { summary: '早前摘要', boundaryId: 'b' };
	const messages = [message('b', 'user', '新消息')];

	it('includePrevious 时附带已有摘要', () => {
		const request = buildSummaryRequest(state, messages, true);
		expect(request[0]!.role).toBe('system');
		expect(request[0]!.content).toBe(SUMMARY_SYSTEM_PROMPT);
		expect(request[1]!.content).toContain('【已有摘要】');
		expect(request[1]!.content).toContain('早前摘要');
		expect(request[1]!.content).toContain('[user] 新消息');
	});

	it('includePrevious 为 false 时不附带已有摘要', () => {
		const request = buildSummaryRequest(state, messages, false);
		expect(request[1]!.content).not.toContain('【已有摘要】');
		expect(request[1]!.content).toContain('[user] 新消息');
	});

	it('state 为 null 时同样只序列化消息', () => {
		const request = buildSummaryRequest(null, messages, true);
		expect(request[1]!.content).not.toContain('【已有摘要】');
	});

	it('带世界时间的消息在角色标签同行标注时间', () => {
		const withTime = [
			{
				...message('b', 'user', '新消息'),
				worldTime: { day: 0, hour: 9, minute: 0 }
			}
		];
		const request = buildSummaryRequest(null, withTime, false);
		expect(request[1]!.content).toContain('[user]（周一 09:00） 新消息');
	});

	it('已有摘要为空串时跳过 previous 块', () => {
		const request = buildSummaryRequest({ summary: '   ', boundaryId: 'b' }, messages, true);
		expect(request[1]!.content).not.toContain('【已有摘要】');
	});
});

describe('buildCompactedHistory', () => {
	it('摘要非空时前置摘要系统消息', () => {
		const recent = [message('c', 'user', '3')];
		const history = buildCompactedHistory('摘要正文', recent);
		expect(history[0]!.role).toBe('system');
		expect(history[0]!.content).toBe(`${SUMMARY_MARKER}\n摘要正文`);
		expect(history.slice(1)).toEqual(recent);
	});

	it('摘要为空时只保留最近消息', () => {
		const recent = [message('c', 'user', '3')];
		expect(buildCompactedHistory('   ', recent)).toEqual(recent);
	});
});

describe('fallbackSummary / serializeSummaryRequest', () => {
	it('兜底摘要引用最近用户消息并截断', () => {
		const summary = fallbackSummary([
			message('a', 'user', 'x'.repeat(60)),
			message('b', 'assistant', '回复')
		]);
		expect(summary).toContain('已总结 2 条早期消息');
		expect(summary).toContain('最近提到「');
		expect(summary).toContain('…');
	});

	it('无用户消息时兜底摘要不引用', () => {
		const summary = fallbackSummary([message('a', 'assistant', '回复')]);
		expect(summary).toContain('无可补充信息');
	});

	it('摘要请求序列化为文本', () => {
		const request = buildSummaryRequest(null, [message('a', 'user', 'hi')], false);
		expect(serializeSummaryRequest(request)).toContain('[system]');
		expect(serializeSummaryRequest(request)).toContain('[user] hi');
	});
});
