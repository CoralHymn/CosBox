import type { MessageRole } from '../core/types';
import { DEFAULT_WEB_SEARCH_CONFIG, type WebSearchConfig } from '../search/types';

/** LLM 服务配置（demo = 内置离线演示，openai-compatible = 任意兼容端点）。 */
export interface LlmConfig {
	provider: 'demo' | 'openai-compatible';
	/** 服务商预设 id（见 providers.ts）；'custom' 表示自定义端点。 */
	providerId: string;
	/** OpenAI-compatible 基址，如 http://localhost:4000/v1。 */
	baseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	/** 网页搜索配置（发送消息时可带搜索注入结果）。 */
	webSearch: WebSearchConfig;
}

/** 与 OpenAI Chat Completions 兼容的消息结构。 */
export interface ChatMessage {
	role: MessageRole;
	content: string;
}

/** 统一的 LLM 客户端接口。 */
export interface LlmClient {
	chat(messages: ChatMessage[], config: LlmConfig, signal?: AbortSignal): Promise<string>;
}

/** 默认配置：离线 demo，开箱即用。 */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
	provider: 'demo',
	providerId: 'custom',
	baseUrl: 'http://localhost:4000/v1',
	apiKey: '',
	model: 'gpt-4o-mini',
	temperature: 0.8,
	maxTokens: 1024,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};
