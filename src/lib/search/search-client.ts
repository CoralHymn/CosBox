import { SearchError } from '../core/errors';
import type { SearchClient, SearchResult, WebSearchConfig } from './types';

/** 归一化搜索结果。 */
export interface RawSearchItem {
	title?: unknown;
	url?: unknown;
	link?: unknown;
	snippet?: unknown;
	content?: unknown;
	description?: unknown;
}

/**
 * 网页搜索客户端：支持 Tavily / Serper / Brave 三家服务商。
 * 统一返回归一化结果；任何失败都抛 SearchError。
 */
export class WebSearchClient implements SearchClient {
	/** 执行搜索。空 query 或未配置 key 时抛 SearchError。 */
	async search(
		query: string,
		config: WebSearchConfig,
		signal?: AbortSignal
	): Promise<SearchResult[]> {
		const trimmed = query.trim();
		if (trimmed === '') {
			throw new SearchError('搜索关键词不能为空');
		}
		const key = config.apiKey.trim();
		if (key === '') {
			throw new SearchError('未配置搜索 API Key');
		}
		if (!Number.isInteger(config.maxResults) || config.maxResults < 1 || config.maxResults > 10) {
			throw new SearchError('搜索条数需在 1-10 之间');
		}

		switch (config.provider) {
			case 'tavily':
				return this.searchTavily(trimmed, key, config.maxResults, signal);
			case 'serper':
				return this.searchSerper(trimmed, key, config.maxResults, signal);
			case 'brave':
				return this.searchBrave(trimmed, key, config.maxResults, signal);
		}
	}

	private async searchTavily(
		query: string,
		apiKey: string,
		maxResults: number,
		signal?: AbortSignal
	): Promise<SearchResult[]> {
		const data = await this.post(
			'https://api.tavily.com/search',
			{ query, max_results: maxResults, search_depth: 'basic' },
			{ Authorization: `Bearer ${apiKey}` },
			signal
		);
		const results = readArray(data, 'results');
		return results.map((item) => ({
			title: readString(item, 'title'),
			url: readString(item, 'url'),
			snippet: readString(item, 'content')
		}));
	}

	private async searchSerper(
		query: string,
		apiKey: string,
		maxResults: number,
		signal?: AbortSignal
	): Promise<SearchResult[]> {
		const data = await this.post(
			'https://google.serper.dev/search',
			{ q: query, num: maxResults, gl: 'cn', hl: 'zh-cn' },
			{ 'X-API-KEY': apiKey },
			signal
		);
		const results = readArray(data, 'organic');
		return results.map((item) => ({
			title: readString(item, 'title'),
			url: readString(item, 'link'),
			snippet: readString(item, 'snippet')
		}));
	}

	private async searchBrave(
		query: string,
		apiKey: string,
		maxResults: number,
		signal?: AbortSignal
	): Promise<SearchResult[]> {
		const url = new URL('https://api.search.brave.com/res/v1/web/search');
		url.searchParams.set('q', query);
		url.searchParams.set('count', String(maxResults));
		const data = await this.fetchJson(
			url.toString(),
			{ 'X-Subscription-Token': apiKey },
			undefined,
			signal
		);
		const web = isRecord(data) && isRecord(data.web) ? (data.web as Record<string, unknown>) : {};
		const results = readArray(web, 'results');
		return results.map((item) => ({
			title: readString(item, 'title'),
			url: readString(item, 'url'),
			snippet: readString(item, 'description')
		}));
	}

	private async post(
		url: string,
		body: Record<string, unknown>,
		headers: Record<string, string>,
		signal?: AbortSignal
	): Promise<unknown> {
		return this.fetchJson(
			url,
			{ 'Content-Type': 'application/json', ...headers },
			JSON.stringify(body),
			signal
		);
	}

	private async fetchJson(
		url: string,
		headers: Record<string, string>,
		body: string | undefined,
		signal?: AbortSignal
	): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(url, {
				method: body === undefined ? 'GET' : 'POST',
				headers,
				body,
				signal
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new SearchError('搜索请求已取消');
			}
			throw new SearchError(`无法连接搜索服务：${err instanceof Error ? err.message : '网络错误'}`);
		}
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new SearchError(
				`搜索服务返回 ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`
			);
		}
		try {
			return await response.json();
		} catch (err) {
			throw new SearchError(
				`搜索服务返回了无法解析的响应：${err instanceof Error ? err.message : 'JSON 错误'}`
			);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readArray(data: unknown, key: string): RawSearchItem[] {
	const value = isRecord(data) ? data[key] : undefined;
	if (!Array.isArray(value)) {
		throw new SearchError(`搜索响应缺少 ${key} 数组`);
	}
	return value as RawSearchItem[];
}

function readString(item: RawSearchItem, key: keyof RawSearchItem): string {
	const value = item[key];
	return typeof value === 'string' ? value : '';
}
