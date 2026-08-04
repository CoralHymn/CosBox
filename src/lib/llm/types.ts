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
	/** 是否允许 AI 在对话中调用状态工具（改地点/时间/穿着/属性）。缺省视为关闭。 */
	allowAiStateTools?: boolean;
	/** 网页搜索配置（发送消息时可带搜索注入结果）。 */
	webSearch: WebSearchConfig;
}

/** 工具调用角色（仅出现在 LLM 循环内，不会落成用户可见的快照）。 */
export type LlmMessageRole = MessageRole | 'tool';

/** 模型发起的一次工具调用。 */
export interface ToolCall {
	id: string;
	name: string;
	/** 解析后的参数对象；非法 JSON 时为空对象。 */
	arguments: Record<string, unknown>;
}

/** 与 OpenAI Chat Completions 兼容的消息结构。 */
export interface ChatMessage {
	role: LlmMessageRole;
	content: string;
	/** assistant 消息携带的模型工具调用（回传给 API 时必须原样保留）。 */
	toolCalls?: ToolCall[];
	/** tool 消息指向的 tool_call id。 */
	toolCallId?: string;
	/** tool 消息对应的工具名。 */
	name?: string;
}

/** 一次带工具能力的对话结果。 */
export interface LlmChatResult {
	/** 最终文本；若本轮全部是工具调用则为 null。 */
	content: string | null;
	toolCalls: ToolCall[];
}

/** 统一的 LLM 客户端接口。chatWithTools 可选：客户端不支持工具时退化为纯文本对话。 */
export interface LlmClient {
	chat(messages: ChatMessage[], config: LlmConfig, signal?: AbortSignal): Promise<string>;
	chatWithTools?(
		messages: ChatMessage[],
		tools: readonly StateToolSchema[],
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmChatResult>;
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
	allowAiStateTools: false,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

/** 工具参数 JSON Schema（严格子集，足够描述 CosBox 状态工具）。 */
export interface StateToolSchema {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<
			string,
			{
				type: 'string' | 'number' | 'boolean';
				description: string;
				enum?: readonly string[];
			}
		>;
		required: readonly string[];
	};
}
