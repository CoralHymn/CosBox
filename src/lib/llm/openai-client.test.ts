import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from '../core/errors';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import { OpenAiCompatibleClient } from './openai-client';
import type { ChatMessage, LlmConfig, StateToolSchema } from './types';

const config: LlmConfig = {
	provider: 'openai-compatible',
	providerId: 'custom',
	baseUrl: 'http://localhost:4000/v1/',
	apiKey: 'secret',
	model: 'test-model',
	temperature: 0.7,
	maxTokens: 512,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

function okResponse(content: string): Response {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content } }] }),
		text: async () => ''
	} as unknown as Response;
}

function toolResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => ''
	} as unknown as Response;
}

const TOOL_SCHEMAS: readonly StateToolSchema[] = [
	{
		name: 'goto_location',
		description: '切换地点',
		parameters: {
			type: 'object',
			properties: { name: { type: 'string', description: '地名' } },
			required: []
		}
	}
];

function fetchMock() {
	return vi.fn<typeof fetch>();
}

describe('OpenAiCompatibleClient', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('成功调用并返回 content，URL 去尾斜杠', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(okResponse('你好呀'));
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chat([{ role: 'user', content: 'hi' }], config);
		expect(result.content).toBe('你好呀');
		expect(result.toolCalls).toEqual([]);
		const [url, init] = fetchSpy.mock.calls[0]!;
		expect(url).toBe('http://localhost:4000/v1/chat/completions');
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer secret');
		const body = JSON.parse(init!.body as string);
		expect(body.model).toBe('test-model');
		expect(body.temperature).toBe(0.7);
		expect(body.max_tokens).toBe(512);
	});

	it('无 apiKey 时不带 Authorization 头', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(okResponse('x'));
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		await client.chat([], { ...config, apiKey: '' });
		const init = fetchSpy.mock.calls[0]![1] as RequestInit;
		expect(init.headers).not.toHaveProperty('Authorization');
	});

	it('空 baseUrl 抛 LlmError 且不发起请求', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const client = new OpenAiCompatibleClient();
		await expect(client.chat([], { ...config, baseUrl: '   ' })).rejects.toThrow(
			'未配置模型服务地址'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('网络失败抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('fetch failed')))
		);
		const client = new OpenAiCompatibleClient();
		await expect(client.chat([], config)).rejects.toThrow('无法连接模型服务');
	});

	it('AbortError 转为友好文案', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new DOMException('Aborted', 'AbortError')))
		);
		const client = new OpenAiCompatibleClient();
		await expect(client.chat([], config)).rejects.toThrow('请求已取消');
	});

	it('非 2xx 响应抛 LlmError 并携带状态码与摘要', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 429,
				text: async () => 'rate limited',
				json: async () => ({})
			}))
		);
		const client = new OpenAiCompatibleClient();
		const err = await client.chat([], config).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LlmError);
		expect((err as LlmError).status).toBe(429);
		expect((err as LlmError).message).toContain('rate limited');
	});

	it('非 2xx 且响应体读取失败时仍抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 500,
				text: async () => Promise.reject(new Error('body lost')),
				json: async () => ({})
			}))
		);
		const client = new OpenAiCompatibleClient();
		await expect(client.chat([], config)).rejects.toThrow('模型服务返回 500');
	});

	it('响应 JSON 无法解析抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => Promise.reject(new Error('bad json')),
				text: async () => ''
			}))
		);
		const client = new OpenAiCompatibleClient();
		await expect(client.chat([], config)).rejects.toThrow('无法解析');
	});

	it('缺少 choices 抛 LlmError', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as never)
		);
		await expect(client.chat([], config)).rejects.toThrow('缺少 choices');
	});

	it('content 非字符串抛 LlmError', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						json: async () => ({ choices: [{ message: { content: 42 } }] })
					}) as never
			)
		);
		await expect(client.chat([], config)).rejects.toThrow('缺少 choices');
	});

	it('choices 元素或 message 非对象抛 LlmError', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [42] }) }) as never)
		);
		await expect(client.chat([], config)).rejects.toThrow('缺少 choices');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({ ok: true, status: 200, json: async () => ({ choices: [{ message: 42 }] }) }) as never
			)
		);
		await expect(client.chat([], config)).rejects.toThrow('缺少 choices');
	});

	it('chatWithTools 请求体包含 tools 声明与序列化消息', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(okResponse('好的'));
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'hi' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'c1', name: 'goto_location', arguments: { name: '食堂' } }]
			},
			{ role: 'tool', content: '已切换', toolCallId: 'c1', name: 'goto_location' }
		];
		const result = await client.chatWithTools(messages, TOOL_SCHEMAS, config);
		expect(result.content).toBe('好的');
		expect(result.toolCalls).toEqual([]);
		const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
		expect(body.tools).toEqual([
			{
				type: 'function',
				function: {
					name: 'goto_location',
					description: '切换地点',
					parameters: TOOL_SCHEMAS[0]!.parameters
				}
			}
		]);
		expect(body.messages[1]!.tool_calls).toEqual([
			{
				id: 'c1',
				type: 'function',
				function: { name: 'goto_location', arguments: '{"name":"食堂"}' }
			}
		]);
		expect(body.messages[2]!.tool_call_id).toBe('c1');
	});

	it('chatWithTools 解析标准 tool_calls，content 可为 null', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: 'call_abc',
									type: 'function',
									function: { name: 'advance_time', arguments: '{"minutes":30}' }
								}
							]
						}
					}
				]
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.content).toBeNull();
		expect(result.toolCalls).toEqual([
			{ id: 'call_abc', name: 'advance_time', arguments: { minutes: 30 } }
		]);
	});

	it('chatWithTools 兼容 arguments 已是对象的响应', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: 'c1',
									type: 'function',
									function: {
										name: 'set_outfit',
										arguments: { slot: 'top', item: '白色衬衫' }
									}
								}
							]
						}
					}
				]
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.toolCalls).toEqual([
			{ id: 'c1', name: 'set_outfit', arguments: { slot: 'top', item: '白色衬衫' } }
		]);
	});

	it('chatWithTools 兼容纯文本 JSON 工具调用', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			okResponse(JSON.stringify({ tool: 'goto_location', args: { name: '图书馆' } }))
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.content).toBeNull();
		expect(result.toolCalls).toEqual([
			{ id: 'call_inline', name: 'goto_location', arguments: { name: '图书馆' } }
		]);
	});

	it('chatWithTools 忽略残缺 tool_calls 条目并跳过非法 JSON 参数', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [
					{
						message: {
							content: '继续',
							tool_calls: [
								42,
								{ id: 'c1' },
								{ id: 'c2', function: { name: '', arguments: '{}' } },
								{ id: 'c3', function: { name: 'x', arguments: 'not-json' } }
							]
						}
					}
				]
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.content).toBe('继续');
		expect(result.toolCalls).toEqual([{ id: 'c3', name: 'x', arguments: {} }]);
	});

	it('chatWithTools content 为 null 且无工具调用时抛 LlmError', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(toolResponse({ choices: [{ message: { content: null } }] }));
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		await expect(client.chatWithTools([], TOOL_SCHEMAS, config)).rejects.toThrow('缺少 choices');
	});

	it('chatWithTools 忽略非对象或缺失 tool 的内联 JSON', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal('fetch', fetchMock().mockResolvedValue(okResponse('[1,2]')));
		const arrayResult = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(arrayResult.content).toBe('[1,2]');
		expect(arrayResult.toolCalls).toEqual([]);

		vi.stubGlobal('fetch', fetchMock().mockResolvedValue(okResponse('{"args":{"name":"x"}}')));
		const noToolResult = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(noToolResult.content).toBe('{"args":{"name":"x"}}');
		expect(noToolResult.toolCalls).toEqual([]);
	});

	it('chatWithTools 内联工具参数为空串时返回空对象', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal(
			'fetch',
			fetchMock().mockResolvedValue(okResponse(JSON.stringify({ tool: 'goto_location', args: '' })))
		);
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.toolCalls).toEqual([{ id: 'call_inline', name: 'goto_location', arguments: {} }]);
	});

	it('chatWithTools 标准 tool_calls 参数为空串时返回空对象', async () => {
		const client = new OpenAiCompatibleClient();
		vi.stubGlobal(
			'fetch',
			fetchMock().mockResolvedValue(
				toolResponse({
					choices: [
						{
							message: {
								content: null,
								tool_calls: [
									{
										id: 'c1',
										type: 'function',
										function: { name: 'x', arguments: '' }
									}
								]
							}
						}
					]
				})
			)
		);
		const result = await client.chatWithTools([], TOOL_SCHEMAS, config);
		expect(result.toolCalls).toEqual([{ id: 'c1', name: 'x', arguments: {} }]);
	});

	it('chat 解析 usage：prompt/completion/cached 用量', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: '你好' } }],
				usage: {
					prompt_tokens: 120,
					completion_tokens: 30,
					prompt_tokens_details: { cached_tokens: 40 }
				}
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chat([], config);
		expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30, cachedTokens: 40 });
	});

	it('chat 解析 usage：缺省 cached 与小数向下取整', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: 'x' } }],
				usage: { prompt_tokens: 10.9, completion_tokens: 0 }
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chat([], config);
		expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 0, cachedTokens: 0 });
	});

	it('usage 缺失或字段非法时不返回 usage', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(toolResponse({ choices: [{ message: { content: 'x' } }] }));
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const missing = await client.chat([], config);
		expect(missing.usage).toBeUndefined();

		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: 'x' } }],
				usage: { prompt_tokens: 'many', completion_tokens: -3 }
			})
		);
		const invalid = await client.chat([], config);
		expect(invalid.usage).toBeUndefined();
	});

	it('summarize 把摘要请求当对话发送并取最终文本', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: '生成的延续摘要' } }],
				usage: { prompt_tokens: 30, completion_tokens: 8 }
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.summarize([{ role: 'user', content: '[user] 早期消息' }], config);
		expect(result.summary).toBe('生成的延续摘要');
		expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 8, cachedTokens: 0 });
	});

	it('chat 解析 reasoning_content 为 thinking', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [
					{
						message: {
							content: '最终回答',
							reasoning_content: '  让我先想想：状态是学校食堂。  '
						}
					}
				]
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const result = await client.chat([], config);
		expect(result.content).toBe('最终回答');
		expect(result.thinking).toBe('让我先想想：状态是学校食堂。');
	});

	it('chat 兼容 reasoning 字段，缺失或空串时无 thinking', async () => {
		const fetchSpy = fetchMock();
		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: '回答', reasoning: '思考内容' } }]
			})
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new OpenAiCompatibleClient();
		const withReasoning = await client.chat([], config);
		expect(withReasoning.thinking).toBe('思考内容');

		fetchSpy.mockResolvedValue(toolResponse({ choices: [{ message: { content: '回答' } }] }));
		const without = await client.chat([], config);
		expect(without.thinking).toBeUndefined();

		fetchSpy.mockResolvedValue(
			toolResponse({
				choices: [{ message: { content: '回答', reasoning_content: '   ' } }]
			})
		);
		const blank = await client.chat([], config);
		expect(blank.thinking).toBeUndefined();
	});
});
