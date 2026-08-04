import { describe, expect, it, vi } from 'vitest';
import { addMinutes, applyStateDelta, createInitialState } from '../core/state';
import type { ChatMessageView, StatePatch } from '../core/types';
import type { ContextPipelineInput } from '../context/pipeline';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import { ChatService, serializeDebugPrompt, type CompactionOptions } from './chat-service';
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

	it('自动压缩：用量达到阈值时用摘要替换早期消息并累加用量', async () => {
		const summarize = vi.fn(async () => ({
			summary: '延续摘要',
			usage: { promptTokens: 50, completionTokens: 10, cachedTokens: 0 }
		}));
		const client: LlmClient = {
			chat: vi.fn(async () => ({
				content: '好的',
				toolCalls: [],
				usage: { promptTokens: 100, completionTokens: 20, cachedTokens: 5 }
			})),
			summarize
		};
		const conversation = makeConversation(25);
		const service = new ChatService(client);
		const compaction: CompactionOptions = {
			contextWindow: 600,
			threshold: 0.5,
			keepRecent: 20,
			state: null
		};
		const {
			reply,
			compaction: resultState,
			usage,
			bundle
		} = await service.generateReply(
			{ state: createInitialState(), conversation, worldInfo: [] },
			config,
			{ compaction }
		);
		expect(reply).toBe('好的');
		expect(summarize).toHaveBeenCalledTimes(1);
		expect(resultState?.summary).toBe('延续摘要');
		expect(resultState?.boundaryId).toBe('5');
		expect(bundle.messages.some((message) => message.content.includes('延续摘要'))).toBe(true);
		expect(usage).toEqual({ promptTokens: 150, completionTokens: 30, cachedTokens: 5 });
	});

	it('自动压缩：用量未达阈值时完整发送且不调用摘要', async () => {
		const summarize = vi.fn();
		const chat = vi.fn(async () => ({ content: '好的', toolCalls: [] }));
		const client: LlmClient = { chat, summarize };
		const conversation = makeConversation(25);
		const service = new ChatService(client);
		const { compaction, debug } = await service.generateReply(
			{ state: createInitialState(), conversation, worldInfo: [] },
			config,
			{
				compaction: {
					contextWindow: 1_000_000,
					threshold: 0.8,
					keepRecent: 20,
					state: null
				}
			}
		);
		expect(summarize).not.toHaveBeenCalled();
		expect(compaction).toBeNull();
		expect(debug.messages).toHaveLength(26);
	});

	it('已有压缩状态时发送摘要 + 边界后消息，且不重复压缩', async () => {
		const chat = vi.fn(async () => ({ content: '好的', toolCalls: [] }));
		const service = new ChatService({ chat });
		const conversation = makeConversation(25);
		const { compaction, debug } = await service.generateReply(
			{ state: createInitialState(), conversation, worldInfo: [] },
			config,
			{
				compaction: {
					contextWindow: 1_000_000,
					threshold: 0.8,
					keepRecent: 20,
					state: { summary: '旧摘要', boundaryId: '20' }
				}
			}
		);
		expect(compaction).toEqual({ summary: '旧摘要', boundaryId: '20' });
		expect(debug.messages).toHaveLength(7);
		expect(debug.messages.some((message) => message.content.includes('旧摘要'))).toBe(true);
	});

	it('手动压缩：总结边界后的早期消息并返回新状态', async () => {
		const summarize = vi.fn(async () => ({ summary: '手动摘要', usage: undefined }));
		const service = new ChatService({ chat: vi.fn(), summarize });
		const result = await service.compactConversation(makeConversation(25), config);
		expect(result.state?.summary).toBe('手动摘要');
		expect(result.state?.boundaryId).toBe('5');
		expect(summarize).toHaveBeenCalledTimes(1);
	});

	it('手动压缩：已有状态时从边界继续并携带旧摘要', async () => {
		const summarize = vi.fn(async (request: ChatMessage[], _config: LlmConfig) => {
			void request;
			void _config;
			return { summary: '合并摘要', usage: undefined };
		});
		const service = new ChatService({ chat: vi.fn(), summarize });
		const result = await service.compactConversation(makeConversation(30), config, {
			state: { summary: '旧摘要', boundaryId: '5' }
		});
		expect(result.state?.summary).toBe('合并摘要');
		expect(result.state?.boundaryId).toBe('10');
		const request = summarize.mock.calls[0]![0] as ChatMessage[];
		expect(request[1]!.content).toContain('旧摘要');
		expect(request[1]!.content).toContain('[assistant] 消息5');
	});

	it('手动压缩：消息数不超过保留窗口时原样返回', async () => {
		const summarize = vi.fn();
		const service = new ChatService({ chat: vi.fn(), summarize });
		const result = await service.compactConversation(makeConversation(3), config);
		expect(result.state).toBeNull();
		expect(summarize).not.toHaveBeenCalled();
	});

	it('手动压缩：摘要失败（非取消）时回退确定性兜底', async () => {
		const summarize = vi.fn(async () => Promise.reject(new Error('模型挂了')));
		const service = new ChatService({ chat: vi.fn(), summarize });
		const result = await service.compactConversation(makeConversation(25), config);
		expect(result.state?.summary).toContain('压缩摘要');
		expect(result.usage).toBeUndefined();
	});

	it('手动压缩：取消时如实上抛', async () => {
		const controller = new AbortController();
		const summarize = vi.fn(async () => Promise.reject(new DOMException('Aborted', 'AbortError')));
		const service = new ChatService({ chat: vi.fn(), summarize });
		controller.abort();
		await expect(
			service.compactConversation(makeConversation(25), config, {}, controller.signal)
		).rejects.toThrow();
	});

	it('客户端无 summarize 时用 chat 兜底生成摘要', async () => {
		const chat = vi.fn(async () => ({ content: 'chat 摘要', toolCalls: [] }));
		const service = new ChatService({ chat });
		const result = await service.compactConversation(makeConversation(25), config);
		expect(result.state?.summary).toBe('chat 摘要');
		expect(chat).toHaveBeenCalled();
	});

	it('skipContext 消息不进入发送给模型的消息数组', async () => {
		const chat = vi.fn(async (_messages: ChatMessage[], _config: LlmConfig) => {
			void _messages;
			void _config;
			return { content: '好的', toolCalls: [] };
		});
		const service = new ChatService({ chat });
		const conversation: ChatMessageView[] = [
			{
				id: 'help',
				role: 'system',
				content: '可用 RP 快捷命令',
				timestamp: 0,
				skipContext: true
			},
			{ id: '1', role: 'user', content: '你好', timestamp: 1 }
		];
		const { debug } = await service.generateReply(
			{ state: createInitialState(), conversation, worldInfo: [] },
			config
		);
		expect(debug.messages.map((m) => m.role)).toEqual(['system', 'user']);
		expect(debug.messages[1]!.content).toBe('你好');
		const sent = vi.mocked(chat).mock.calls[0]![0] as ChatMessage[];
		expect(sent.some((m) => m.content.includes('可用 RP 快捷命令'))).toBe(false);
	});

	it('已有压缩状态时 skipContext 消息同样不进入发送历史', async () => {
		const chat = vi.fn(async () => ({ content: '好的', toolCalls: [] }));
		const service = new ChatService({ chat });
		const conversation: ChatMessageView[] = [
			{
				id: 'help',
				role: 'system',
				content: '可用 RP 快捷命令',
				timestamp: 0,
				skipContext: true
			},
			...makeConversation(25)
		];
		const { debug } = await service.generateReply(
			{ state: createInitialState(), conversation, worldInfo: [] },
			config,
			{
				compaction: {
					contextWindow: 1_000_000,
					threshold: 0.8,
					keepRecent: 20,
					state: { summary: '旧摘要', boundaryId: '20' }
				}
			}
		);
		expect(debug.messages).toHaveLength(7);
		expect(debug.messages.some((m) => m.content.includes('可用 RP 快捷命令'))).toBe(false);
	});
});

describe('serializeDebugPrompt', () => {
	it('序列化系统消息、普通消息与工具调用', () => {
		const text = serializeDebugPrompt({
			systemMessage: '系统提示',
			messages: [
				{ role: 'user', content: '你好' },
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'c1', name: 'goto_location', arguments: { name: '食堂' } }]
				}
			]
		});
		expect(text).toContain('[system] 系统提示');
		expect(text).toContain('[user] 你好');
		expect(text).toContain('[tool_calls]');
		expect(text).toContain('"name": "goto_location"');
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

/** 构造 n 条交替 user/assistant 的消息序列。 */
function makeConversation(count: number): ChatMessageView[] {
	return Array.from({ length: count }, (_, index) => ({
		id: String(index),
		role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
		content: `消息${index}`,
		timestamp: index
	}));
}
