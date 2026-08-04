import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from '../core/errors';
import { OpenAiCompatibleClient } from './openai-client';
import type { LlmConfig } from './types';

const config: LlmConfig = {
	provider: 'openai-compatible',
	baseUrl: 'http://localhost:4000/v1/',
	apiKey: 'secret',
	model: 'test-model',
	temperature: 0.7,
	maxTokens: 512
};

function okResponse(content: string): Response {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content } }] }),
		text: async () => ''
	} as unknown as Response;
}

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
		const reply = await client.chat([{ role: 'user', content: 'hi' }], config);
		expect(reply).toBe('你好呀');
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
});
