import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from '../core/types';
import { buildRecentLog } from './recent-log';

function msg(
	id: string,
	role: ChatMessageView['role'],
	content: string,
	extra: Partial<ChatMessageView> = {}
): ChatMessageView {
	return { id, role, content, timestamp: Number(id.replace(/\D/g, '') || 0), ...extra };
}

describe('buildRecentLog', () => {
	it('从最近一条用户发言开始记录，之前的历史不包含', () => {
		const conversation = [
			msg('1', 'user', '早前发言'),
			msg('2', 'assistant', '早前回复'),
			msg('3', 'user', '最近发言'),
			msg('4', 'assistant', '本次回复')
		];
		const log = buildRecentLog(conversation);
		expect(log).toContain('[用户] 最近发言');
		expect(log).toContain('[角色] 本次回复');
		expect(log).not.toContain('早前');
	});

	it('包含角色思考与系统/工具反馈，且顺序为对话顺序', () => {
		const conversation = [
			msg('1', 'user', '推进时间'),
			msg('2', 'assistant', '好的', { thinking: '我应该调用 advance_time' }),
			msg('3', 'system', '【工具调用】advance_time：时间推进到 周一 09:00'),
			msg('4', 'assistant', '时间过去了。')
		];
		const log = buildRecentLog(conversation);
		expect(log).toBe(
			'[用户] 推进时间\n\n[角色] 好的\n\n[角色思考] 我应该调用 advance_time\n\n' +
				'[系统] 【工具调用】advance_time：时间推进到 周一 09:00\n\n[角色] 时间过去了。'
		);
	});

	it('空正文的 assistant 不输出空角色行，仍记录思考', () => {
		const conversation = [
			msg('1', 'user', '你好'),
			msg('2', 'assistant', '', { thinking: '只思考没说话' })
		];
		const log = buildRecentLog(conversation);
		expect(log).toBe('[用户] 你好\n\n[角色思考] 只思考没说话');
		expect(log).not.toContain('[角色] \n');
	});

	it('没有用户发言时返回空串', () => {
		expect(buildRecentLog([])).toBe('');
		expect(buildRecentLog([msg('1', 'assistant', '只有回复')])).toBe('');
	});
});
