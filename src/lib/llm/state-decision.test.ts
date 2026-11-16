import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../core/state';
import type { ChatMessageView } from '../core/types';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import {
	buildConfirmationSystemPrompt,
	buildDecisionState,
	buildTurnPayload,
	normalizeDecisionConfig,
	runStateConfirmation,
	runStateDecision
} from './state-decision';
import { STATE_TOOLS, type StateToolContext } from './state-tools';
import { DEFAULT_DECISION_MODEL_CONFIG, type LlmConfig } from './types';

const config: LlmConfig = {
	provider: 'openai-compatible',
	providerId: 'custom',
	baseUrl: 'http://localhost:4000/v1',
	apiKey: '',
	model: 'agent',
	temperature: 0,
	maxTokens: 8,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

const decisionConfig = {
	...DEFAULT_DECISION_MODEL_CONFIG,
	apiKey: 'ts_test',
	threshold: 0.5
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

function jevFetch(noul: number): typeof fetch {
	return vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					model: 'jev-1.14.0',
					answers: { state_change: { type: 'noul', noul } },
					usage: { input_tokens: 120, output_tokens: 12 }
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
	) as unknown as typeof fetch;
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

describe('buildTurnPayload / buildDecisionState', () => {
	it('载荷只含最近发言、回复与思考', () => {
		const payload = buildTurnPayload(lastUser, lastAssistant);
		expect(payload).toContain('过了一段时间，我们走吧');
		expect(payload).toContain('（笑）嗯，天快黑了。');
		expect(payload).toContain('我应该推进时间到傍晚');
	});

	it('决策 state 同时包含角色状态摘要与最近一轮对话', () => {
		const state = buildDecisionState(createInitialState(), lastUser, lastAssistant);
		expect(state).toContain('【当前角色状态】');
		expect(state).toContain('【最近用户发言】');
		expect(state).toContain('学院正门');
	});
});

describe('normalizeDecisionConfig', () => {
	it('补全默认值并钳制阈值与地址', () => {
		const normalized = normalizeDecisionConfig({
			baseUrl: 'https://api.typesafe.ai///',
			apiKey: '  ts_x  ',
			model: '  ',
			threshold: 3
		});
		expect(normalized.baseUrl).toBe('https://api.typesafe.ai');
		expect(normalized.apiKey).toBe('ts_x');
		expect(normalized.model).toBe(DEFAULT_DECISION_MODEL_CONFIG.model);
		expect(normalized.threshold).toBe(1);
	});
});

describe('runStateDecision', () => {
	it('概率达到阈值时判定需要同步', async () => {
		const fetchImpl = jevFetch(0.82);
		const result = await runStateDecision({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			config: decisionConfig,
			fetchImpl
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.source).toBe('jev');
		expect(result.debug.probability).toBe(0.82);
		expect(result.debug.threshold).toBe(0.5);
	});

	it('概率低于阈值时判定无需同步', async () => {
		const result = await runStateDecision({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			config: decisionConfig,
			fetchImpl: jevFetch(0.2)
		});
		expect(result.needsTool).toBe(false);
		expect(result.debug.probability).toBe(0.2);
	});

	it('请求走 TypeSafe System One 端点并携带 Noul 问题', async () => {
		const fetchImpl = jevFetch(0.6);
		await runStateDecision({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			config: decisionConfig,
			fetchImpl
		});
		const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
			string,
			RequestInit
		];
		expect(url).toBe('https://api.typesafe.ai/v1/systemone');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ts_test');
		const body = JSON.parse(init.body as string) as {
			model: string;
			state: string;
			questions: Record<string, { type: string }>;
		};
		expect(body.model).toBe('jev-latest');
		expect(body.questions.state_change!.type).toBe('noul');
		expect(body.state).toContain('天快黑了');
	});

	it('未配置 API Key 时不发请求，按保守策略补执行', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const result = await runStateDecision({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			config: { ...decisionConfig, apiKey: '' },
			fetchImpl
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.needsTool).toBe(true);
		expect(result.debug.source).toBe('unconfigured');
	});

	it('请求失败时按保守策略补执行并保留错误', async () => {
		const fetchImpl = vi.fn(
			async () => new Response('bad key', { status: 401 })
		) as unknown as typeof fetch;
		const result = await runStateDecision({
			state: createInitialState(),
			lastUser,
			lastAssistant,
			config: decisionConfig,
			fetchImpl
		});
		expect(result.needsTool).toBe(true);
		expect(result.debug.source).toBe('error');
		expect(result.debug.error).toContain('401');
	});
});

describe('buildConfirmationSystemPrompt', () => {
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

describe('runStateConfirmation', () => {
	it('执行智能体发出的工具调用并回传反馈', async () => {
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
