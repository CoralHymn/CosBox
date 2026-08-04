import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchError } from '../core/errors';
import { WebSearchClient } from './search-client';
import type { WebSearchConfig } from './types';

const config: WebSearchConfig = {
	enabled: true,
	provider: 'tavily',
	apiKey: 'key',
	maxResults: 3
};

function jsonResponse(data: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => data,
		text: async () => ''
	} as unknown as Response;
}

describe('WebSearchClient', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('空查询抛 SearchError', async () => {
		const client = new WebSearchClient();
		await expect(client.search('   ', config)).rejects.toThrow(SearchError);
	});

	it('未配置 API Key 抛 SearchError', async () => {
		const client = new WebSearchClient();
		await expect(client.search('x', { ...config, apiKey: ' ' })).rejects.toThrow(SearchError);
	});

	it('结果数超出 1-10 抛 SearchError', async () => {
		const client = new WebSearchClient();
		await expect(client.search('x', { ...config, maxResults: 11 })).rejects.toThrow(SearchError);
		await expect(client.search('x', { ...config, maxResults: 0 })).rejects.toThrow(SearchError);
	});

	it('Tavily 正常解析结果', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					results: [
						{ title: '标题A', url: 'https://a', content: '摘要A' },
						{ title: 42, url: 'https://b', content: '摘要B' }
					]
				})
			)
		);
		const client = new WebSearchClient();
		const results = await client.search('查询', config);
		expect(results).toEqual([
			{ title: '标题A', url: 'https://a', snippet: '摘要A' },
			{ title: '', url: 'https://b', snippet: '摘要B' }
		]);
	});

	it('Serper 使用 X-API-KEY 并解析 organic', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		fetchSpy.mockResolvedValue(
			jsonResponse({ organic: [{ title: 'T', link: 'https://s', snippet: 'S' }] })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new WebSearchClient();
		const results = await client.search('查询', { ...config, provider: 'serper' });
		expect(results[0]).toEqual({ title: 'T', url: 'https://s', snippet: 'S' });
		const [url, init] = fetchSpy.mock.calls[0]!;
		expect(String(url)).toBe('https://google.serper.dev/search');
		expect((init!.headers as Record<string, string>)['X-API-KEY']).toBe('key');
	});

	it('Brave 使用 GET 查询参数并解析 web.results', async () => {
		const fetchSpy = vi.fn<typeof fetch>();
		fetchSpy.mockResolvedValue(
			jsonResponse({ web: { results: [{ title: 'T', url: 'https://b', description: 'D' }] } })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const client = new WebSearchClient();
		const results = await client.search('查询', { ...config, provider: 'brave' });
		expect(results[0]).toEqual({ title: 'T', url: 'https://b', snippet: 'D' });
		const [url, init] = fetchSpy.mock.calls[0]!;
		expect(String(url)).toContain('api.search.brave.com');
		expect(String(url)).toContain('count=3');
		expect(init!.method).toBe('GET');
	});

	it('HTTP 错误抛 SearchError 并携带状态码', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({}, false, 429))
		);
		const client = new WebSearchClient();
		const err = await client.search('x', config).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(SearchError);
		expect((err as SearchError).message).toContain('429');
	});

	it('响应缺少结果数组抛 SearchError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({}))
		);
		const client = new WebSearchClient();
		await expect(client.search('x', config)).rejects.toThrow(SearchError);
	});

	it('网络失败与取消分别转为友好文案', async () => {
		const client = new WebSearchClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('boom')))
		);
		await expect(client.search('x', config)).rejects.toThrow('无法连接搜索服务');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new DOMException('Aborted', 'AbortError')))
		);
		await expect(client.search('x', config)).rejects.toThrow('请求已取消');
	});
});
