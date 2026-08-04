import { describe, expect, it, vi } from 'vitest';
import { addMinutes, applyStateDelta, createInitialState } from '../core/state';
import type { StatePatch } from '../core/types';
import type { ContextPipelineInput } from '../context/pipeline';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import { ChatService } from './chat-service';
import { STATE_TOOLS, type StateToolContext } from './state-tools';
import type { ChatMessage, LlmClient, LlmConfig } from './types';

const config: LlmConfig = {
	provider: 'demo',
	providerId: 'custom',
	baseUrl: '',
	apiKey: '',
	model: 'demo',
	temperature: 1,
	maxTokens: 100,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

describe('ChatService', () => {
	it('组装系统消息并调用客户端，返回回复与上下文包', async () => {
		const client: LlmClient = {
			chat: vi.fn(async (messages: ChatMessage[], passed: LlmConfig) => {
				expect(passed).toBe(config);
				expect(messages[0]!.role).toBe('system');
				expect(messages[0]!.content).toContain('时间：周一 08:00');
				expect(messages[1]!.content).toBe('早上好');
				return { content: '你好呀', toolCalls: [] };
			})
		};
		const service = new ChatService(client);
		const input: ContextPipelineInput = {
			state: createInitialState(),
			conversation: [{ id: '1', role: 'user', content: '早上好', timestamp: 1 }],
			worldInfo: []
		};
		const { reply, bundle } = await service.generateReply(input, config);
		expect(reply).toBe('你好呀');
		expect(bundle.stateSummary).toContain('学院正门');
	});

	it('客户端抛错时原样上抛', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => Promise.reject(new Error('模型挂了')))
		};
		const service = new ChatService(client);
		await expect(
			service.generateReply(
				{ state: createInitialState(), conversation: [], worldInfo: [] },
				config
			)
		).rejects.toThrow('模型挂了');
	});

	it('agent 循环：工具执行后携带结果继续请求，最终返回文本', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: '不应走到纯文本路径', toolCalls: [] })),
			chatWithTools: vi
				.fn()
				.mockResolvedValueOnce({
					content: null,
					toolCalls: [{ id: 'c1', name: 'goto_location', arguments: { name: '食堂' } }]
				})
				.mockResolvedValueOnce({ content: '我们到食堂了', toolCalls: [] })
		};
		const ctx = makeToolContext();
		const service = new ChatService(client);
		const input: ContextPipelineInput = {
			state: createInitialState(),
			conversation: [{ id: '1', role: 'user', content: '我们去食堂吧', timestamp: 1 }],
			worldInfo: []
		};
		const { reply, executedTools, bundle, debug } = await service.generateReply(input, config, {
			tools: [...STATE_TOOLS],
			toolContext: ctx
		});
		expect(reply).toBe('我们到食堂了');
		expect(executedTools).toHaveLength(1);
		expect(executedTools[0]!.name).toBe('goto_location');
		expect(executedTools[0]!.output).toContain('已切换地点');
		expect(ctx.getState().location.name).toBe('食堂');
		expect(bundle.stateSummary).toContain('食堂');
		expect(debug.systemMessage).toContain('食堂');
		expect(debug.messages.some((message) => message.role === 'tool')).toBe(true);

		const calls = vi.mocked(client.chatWithTools!).mock.calls;
		expect(calls).toHaveLength(2);
		const secondMessages = calls[1]![0] as ChatMessage[];
		expect(secondMessages[0]!.content).toContain('食堂');
		expect(
			secondMessages.some(
				(message) => message.role === 'tool' && message.content.includes('已切换地点')
			)
		).toBe(true);
	});

	it('agent 循环：超过最大轮数后以提示文本收尾', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: 'x', toolCalls: [] })),
			chatWithTools: vi.fn(async () => ({
				content: null,
				toolCalls: [{ id: 'c', name: 'goto_location', arguments: { name: '图书馆' } }]
			}))
		};
		const service = new ChatService(client);
		const { reply, executedTools } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [...STATE_TOOLS], toolContext: makeToolContext(), maxToolTurns: 2 }
		);
		expect(reply).toContain('已连续执行多次状态变更');
		expect(executedTools).toHaveLength(2);
		expect(vi.mocked(client.chatWithTools!).mock.calls).toHaveLength(2);
	});

	it('agent 循环：工具失败以错误文本回馈模型，循环继续', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: 'x', toolCalls: [] })),
			chatWithTools: vi
				.fn()
				.mockResolvedValueOnce({
					content: null,
					toolCalls: [{ id: 'c1', name: '不存在的工具', arguments: {} }]
				})
				.mockResolvedValueOnce({ content: '好的', toolCalls: [] })
		};
		const service = new ChatService(client);
		const { reply, executedTools } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [...STATE_TOOLS], toolContext: makeToolContext() }
		);
		expect(reply).toBe('好的');
		expect(executedTools[0]!.output).toContain('未知工具');
	});

	it('客户端不支持 chatWithTools 时即使传了工具也走纯文本', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: '纯文本回复', toolCalls: [] }))
		};
		const service = new ChatService(client);
		const { reply, executedTools } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [...STATE_TOOLS], toolContext: makeToolContext() }
		);
		expect(reply).toBe('纯文本回复');
		expect(executedTools).toEqual([]);
	});

	it('工具列表为空时走纯文本，不调用 chatWithTools', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: '普通对话', toolCalls: [] })),
			chatWithTools: vi.fn()
		};
		const service = new ChatService(client);
		const { reply } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [], toolContext: makeToolContext() }
		);
		expect(reply).toBe('普通对话');
		expect(client.chatWithTools).not.toHaveBeenCalled();
	});

	it('agent 循环：模型返回空内容且无工具调用时以空串收尾', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: 'x', toolCalls: [] })),
			chatWithTools: vi.fn(async () => ({ content: null, toolCalls: [] }))
		};
		const service = new ChatService(client);
		const { reply, executedTools } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [...STATE_TOOLS], toolContext: makeToolContext() }
		);
		expect(reply).toBe('');
		expect(executedTools).toEqual([]);
	});

	it('返回 debug 提示词视图：系统消息与消息数组', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: '回复', toolCalls: [] }))
		};
		const service = new ChatService(client);
		const { debug } = await service.generateReply(
			{
				state: createInitialState(),
				conversation: [{ id: '1', role: 'user', content: 'hi', timestamp: 1 }],
				worldInfo: []
			},
			config
		);
		expect(debug.systemMessage).toContain('【当前状态】');
		expect(debug.messages[0]!.content).toBe(debug.systemMessage);
		expect(debug.messages.map((message) => message.role)).toEqual(['system', 'user']);
	});

	it('纯文本路径透传客户端用量', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({
				content: '回复',
				toolCalls: [],
				usage: { promptTokens: 100, completionTokens: 20, cachedTokens: 5 }
			}))
		};
		const service = new ChatService(client);
		const { usage } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config
		);
		expect(usage).toEqual({ promptTokens: 100, completionTokens: 20, cachedTokens: 5 });
	});

	it('agent 循环：多轮用量累加返回', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: 'x', toolCalls: [] })),
			chatWithTools: vi
				.fn()
				.mockResolvedValueOnce({
					content: null,
					toolCalls: [{ id: 'c1', name: 'goto_location', arguments: { name: '食堂' } }],
					usage: { promptTokens: 50, completionTokens: 1, cachedTokens: 10 }
				})
				.mockResolvedValueOnce({
					content: '到了',
					toolCalls: [],
					usage: { promptTokens: 80, completionTokens: 4, cachedTokens: 20 }
				})
		};
		const service = new ChatService(client);
		const { reply, usage } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config,
			{ tools: [...STATE_TOOLS], toolContext: makeToolContext() }
		);
		expect(reply).toBe('到了');
		expect(usage).toEqual({ promptTokens: 130, completionTokens: 5, cachedTokens: 30 });
	});

	it('客户端不提供用量时返回 undefined', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => ({ content: '回复', toolCalls: [] }))
		};
		const service = new ChatService(client);
		const { usage } = await service.generateReply(
			{ state: createInitialState(), conversation: [], worldInfo: [] },
			config
		);
		expect(usage).toBeUndefined();
	});
});

/** 内存版工具上下文：状态在对象内直接演进。 */
function makeToolContext(initial = createInitialState()): StateToolContext {
	let state = initial;
	return {
		getState: () => state,
		update: async (patch: StatePatch) => {
			state = applyStateDelta(state, patch);
		},
		advanceTime: async (minutes: number) => {
			state = {
				...state,
				schedule: { ...state.schedule, time: addMinutes(state.schedule.time, minutes) }
			};
		}
	};
}
