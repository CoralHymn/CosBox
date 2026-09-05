import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from '../core/errors';
import { fetchModelList, parseModelListResponse, testConnection } from './model-service';

function response(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => ''
	} as unknown as Response;
}

describe('parseModelListResponse', () => {
	it('提取 id 与上下文窗口（context_window 优先）', () => {
		const models = parseModelListResponse({
			data: [
				{ id: 'a', context_window: 32_000, context_length: 64_000 },
				{ id: 'b', max_context_length: 128_000 },
				{ id: 'c', max_context_window: 256_000 },
				{ id: 'd', meta: { context_length: 512_000 } }
			]
		});
		expect(models).toEqual([
			{ id: 'a', contextWindow: 32_000 },
			{ id: 'b', contextWindow: 128_000 },
			{ id: 'c', contextWindow: 256_000 },
			{ id: 'd', contextWindow: 512_000 }
		]);
	});

	it('无上下文字段时不附带 contextWindow', () => {
		const models = parseModelListResponse({
			data: [{ id: 'x' }, { id: 'y', meta: { context_length: 'nope' } }]
		});
		expect(models).toEqual([{ id: 'x' }, { id: 'y' }]);
	});

	it('跳过空 id、非对象条目与非法上下文', () => {
		const models = parseModelListResponse({
			data: [
				{ id: '' },
				{ id: '  ' },
				42,
				{ id: 'ok', context_window: 0 },
				{ id: 'neg', context_window: -1 },
				{ id: 'str', context_window: 'big' },
				{ id: 'float', context_window: 10.7 }
			]
		});
		expect(models).toEqual([
			{ id: 'ok' },
			{ id: 'neg' },
			{ id: 'str' },
			{ id: 'float', contextWindow: 10 }
		]);
	});

	it('data 缺失或非数组返回空列表', () => {
		expect(parseModelListResponse({})).toEqual([]);
		expect(parseModelListResponse({ data: 'nope' })).toEqual([]);
		expect(parseModelListResponse(null)).toEqual([]);
	});
});

describe('fetchModelList', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('成功拉取并附带 Authorization，URL 去尾斜杠', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		fetchSpy.mockResolvedValue(response({ data: [{ id: 'm1', context_window: 8000 }] }));
		vi.stubGlobal('fetch', fetchSpy);
		const models = await fetchModelList('https://api.example.com/v1/', 'secret');
		expect(models).toEqual([{ id: 'm1', contextWindow: 8000 }]);
		const [url, init] = fetchSpy.mock.calls[0]!;
		expect(url).toBe('https://api.example.com/v1/models');
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer secret');
	});

	it('开启内置通道时把 /models 换成 /llm-proxy/<host>/ 前缀', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		fetchSpy.mockResolvedValue(response({ data: [] }));
		vi.stubGlobal('fetch', fetchSpy);
		await fetchModelList('https://opencode.ai/zen/go/v1', 'k', true);
		expect(fetchSpy.mock.calls[0]![0]).toBe('/llm-proxy/opencode.ai/zen/go/v1/models');
		await testConnection('https://opencode.ai/zen/v1', 'k', true);
		expect(fetchSpy.mock.calls[1]![0]).toBe('/llm-proxy/opencode.ai/zen/v1/models');
		// 不开通道就是直连。
		await fetchModelList('https://opencode.ai/zen/v1', 'k');
		expect(fetchSpy.mock.calls[2]![0]).toBe('https://opencode.ai/zen/v1/models');
	});

	it('无 apiKey 时不带 Authorization 头', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		fetchSpy.mockResolvedValue(response({ data: [] }));
		vi.stubGlobal('fetch', fetchSpy);
		await fetchModelList('http://localhost:11434/v1', '   ');
		const init = fetchSpy.mock.calls[0]![1] as RequestInit;
		expect(init.headers).not.toHaveProperty('Authorization');
	});

	it('空 baseUrl 抛 LlmError 且不发起请求', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchSpy);
		await expect(fetchModelList('   ', 'k')).rejects.toThrow('未配置模型服务地址');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('网络失败抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('fetch failed')))
		);
		await expect(fetchModelList('https://api.example.com/v1', 'k')).rejects.toThrow(
			'无法连接模型服务'
		);
	});

	it('非 2xx 抛 LlmError 并携带状态码', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: false,
						status: 401,
						json: async () => ({}),
						text: async () => 'unauthorized'
					}) as never
			)
		);
		const err = await fetchModelList('https://api.example.com/v1', 'k').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LlmError);
		expect((err as LlmError).status).toBe(401);
		expect((err as LlmError).message).toContain('unauthorized');
	});

	it('非 2xx 且响应体读取失败仍抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: false,
						status: 500,
						json: async () => ({}),
						text: async () => Promise.reject(new Error('body lost'))
					}) as never
			)
		);
		await expect(fetchModelList('https://api.example.com/v1', 'k')).rejects.toThrow(
			'模型服务返回 500'
		);
	});

	it('响应 JSON 无法解析抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						json: async () => Promise.reject(new Error('bad json')),
						text: async () => ''
					}) as never
			)
		);
		await expect(fetchModelList('https://api.example.com/v1', 'k')).rejects.toThrow('无法解析');
	});

	it('响应 JSON 解析异常非 Error 实例时用通用文案', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						json: async () => Promise.reject('boom'),
						text: async () => ''
					}) as never
			)
		);
		await expect(fetchModelList('https://api.example.com/v1', 'k')).rejects.toThrow(
			'无法解析的响应：JSON 错误'
		);
	});

	it('网络失败且异常非 Error 实例时用通用文案', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject('boom'))
		);
		await expect(fetchModelList('https://api.example.com/v1', 'k')).rejects.toThrow(
			'无法连接模型服务：网络错误'
		);
	});
});

describe('testConnection', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('端点可用时正常返回', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response({ data: [{ id: 'm' }] }))
		);
		await expect(testConnection('https://api.example.com/v1', 'k')).resolves.toBeUndefined();
	});

	it('端点不可用时抛 LlmError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('connection refused')))
		);
		await expect(testConnection('https://api.example.com/v1', 'k')).rejects.toThrow(
			'无法连接模型服务'
		);
	});
});
