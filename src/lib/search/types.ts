/** 支持的网页搜索服务商。 */
export type WebSearchProvider = 'tavily' | 'serper' | 'brave';

/** 网页搜索配置（挂在 LlmConfig.webSearch 下）。 */
export interface WebSearchConfig {
	/** 是否启用搜索。 */
	enabled: boolean;
	provider: WebSearchProvider;
	apiKey: string;
	/** 返回结果条数上限，1-10。 */
	maxResults: number;
}

/** 归一化的搜索结果。 */
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/** 网页搜索客户端接口。 */
export interface SearchClient {
	search(query: string, config: WebSearchConfig, signal?: AbortSignal): Promise<SearchResult[]>;
}

/** 默认搜索配置：关闭。 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
	enabled: false,
	provider: 'tavily',
	apiKey: '',
	maxResults: 5
};
