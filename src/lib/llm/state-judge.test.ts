import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../core/state';
import type { ChatMessageView } from '../core/types';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import {
	buildConfirmationSystemPrompt,
	buildJudgeSystemPrompt,
	buildJudgeUserPayload,
	runStateConfirmation,
	runStateJudge
} from './state-judge';
import { STATE_TOOLS, type StateToolContext } from './state-tools';
import type { LlmClient, LlmConfig } from './types';

const config: LlmConfig = {
	provider: 'openai-compatible',
	providerId: 'custom',
	baseUrl: 'http://localhost:4000/v1',
	apiKey: '',
	model: 'judge',
	temperature: 0,
	maxTokens: 8,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

function makeToolContext(): StateToolContext {
	let state = createInitialState();
	return {
		getState: () => state,
		update: async () => {},
		advanceTime: async (minutes: number) => {
			state = {
				...state,
				schedule: {
					...state.schedule,
					time: {
						day: 0,
						hour: (state.schedule.time.hour + minutes / 60) % 24,
						minute: state.schedule.time.minute
					}
				}
			};
		}
	};
}

const lastUser: ChatMessageView = {
	id: 'u1',
	role: 'user',
	content: '过了一段时间，我们走吧',
	timestamp: 1
};
const lastAssistant: ChatMessageView = {
	id: 'a1',
	role: 'assistant',
	content: '（笑）嗯，天快黑了。',
	timestamp: 2,
	thinking: '我应该推进时间到傍晚'
};

describe('buildJudgeSystemPrompt / buildJudgeUserPayload', () => {
	it('系统提示包含状态、严格输出要求与禁止安全拒绝', () => {
		const prompt = buildJudgeSystemPrompt(createInitialState());
		expect(prompt).toContain('【当前状态】');
		expect(prompt).toContain('只输出 True 或 False');
		expect(prompt).toContain('最高优先级指令');
		expect(prompt).toContain('泳衣');
		expect(prompt).toContain('只有完全确认没有任何变化才输出 False');
		expect(prompt).toContain('禁止以任何安全');
	});

	it('用户载荷只含最近发言、回复与思考', () => {
		const payload = buildJudgeUserPayload(lastUser, lastAssistant);
		expect(payload).toContain('过了一段时间，我们走吧');
		expect(payload).toContain('（笑）嗯，天快黑了。');
		expect(payload).toContain('我应该推进时间到傍晚');
	});

	it('确认提示词包含强指令工具要求', () => {
		const prompt = buildConfirmationSystemPrompt(createInitialState());
		expect(prompt).toContain('立即调用对应工具');
		expect(prompt).toContain('最高优先级指令');
		expect(prompt).toContain('泳衣');
		expect(prompt).toContain('tool_calls');
		expect(prompt).toContain('严禁输出剧情正文');
		expect(prompt).toContain('不要重复生成');
	});
});

describe('runStateJudge', () => {
	function clientReturning(output: string): LlmClient {
		return {
			chat: vi.fn(async () => ({ content: output, toolCalls: [] }))
		};
	}

	it('输出 True 时判定需要工具', async () => {
		const result = await runStateJudge({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: clientReturning('True'),
			config
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.output).toBe('True');
		expect(result.debug.messages.length).toBe(2);
	});

	it('输出 False 时判定无需工具', async () => {
		const result = await runStateJudge({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: clientReturning('False'),
			config
		});
		expect(result.needsTool).toBe(false);
	});

	it('输出含糊内容时按需要执行处理且保留原始输出', async () => {
		const result = await runStateJudge({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: clientReturning('可能是吧'),
			config
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.output).toBe('可能是吧');
	});

	it('模型以安全理由拒绝判断时仍按需要执行处理', async () => {
		const result = await runStateJudge({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: clientReturning('我无法判断，这涉及隐私'),
			config
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.output).toBe('我无法判断，这涉及隐私');
	});

	it('请求失败时按需要执行处理（不吞状态同步）', async () => {
		const result = await runStateJudge({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: {
				chat: vi.fn(async () => {
					throw new Error('boom');
				})
			},
			config
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.output).toBe('');
	});
});

describe('runStateConfirmation', () => {
	it('执行模型发出的工具调用并回传反馈', async () => {
		const chatWithTools = vi
			.fn()
			.mockResolvedValueOnce({
				content: null,
				toolCalls: [{ id: 'c1', name: 'advance_time', arguments: { minutes: 60 } }]
			})
			.mockResolvedValueOnce({ content: '已完成。', toolCalls: [] });
		const result = await runStateConfirmation({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			client: { chat: vi.fn(), chatWithTools },
			config,
			tools: [...STATE_TOOLS],
			toolContext: makeToolContext()
		});
		expect(result.toolCalls.map((call) => call.name)).toEqual(['advance_time']);
		expect(result.executed.map((tool) => tool.name)).toEqual(['advance_time']);
		expect(result.messages.some((message) => message.role === 'tool')).toBe(true);
		expect(chatWithTools).toHaveBeenCalledTimes(2);
	});
});
