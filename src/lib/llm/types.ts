import type { MessageRole } from '../core/types';
import { DEFAULT_WEB_SEARCH_CONFIG, type WebSearchConfig } from '../search/types';
import { DEFAULT_COMPACT_THRESHOLD } from './compaction';

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
	/** 模型上下文窗口（token）；来自「获取模型列表」或手动填写，未知时不填。 */
	modelContextWindow?: number;
	/** 自动上下文压缩：接近上下文上限时把早期对话总结成摘要（缺省视为开启）。 */
	autoCompact?: boolean;
	/** 压缩触发阈值：估计用量（含输出预算）占上下文窗口的比例（缺省 0.8）。 */
	compactThreshold?: number;
	/** 流式输出：边生成边显示（真实端点按 SSE 解析；demo 保持一次性返回）。 */
	stream?: boolean;
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

/** 一次请求的 token 用量（来自 API usage 或本地估算）。 */
export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
}

/** 上下文压缩（摘要）的结果。 */
export interface LlmSummaryResult {
	/** 生成的延续摘要文本。 */
	summary: string;
	/** 摘要请求的 token 用量（端点提供时）。 */
	usage?: TokenUsage;
}

/** 一次带工具能力的对话结果。 */
export interface LlmChatResult {
	/** 最终文本；若本轮全部是工具调用则为 null。 */
	content: string | null;
	toolCalls: ToolCall[];
	/** 模型的思考过程（reasoning_content / reasoning）；仅展示，不随请求回传。 */
	thinking?: string;
	/** API 返回或本地估算的 token 用量；部分端点不提供时为 undefined。 */
	usage?: TokenUsage;
}

/** 统一的 LLM 客户端接口。chatWithTools 可选：客户端不支持工具时退化为纯文本对话。 */
export interface LlmClient {
	chat(
		messages: ChatMessage[],
		config: LlmConfig,
		signal?: AbortSignal,
		onDelta?: (delta: string) => void
	): Promise<LlmChatResult>;
	/** 上下文压缩用的延续摘要；不实现时由 ChatService 用 chat 兜底。 */
	summarize?(
		request: ChatMessage[],
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmSummaryResult>;
	chatWithTools?(
		messages: ChatMessage[],
		tools: readonly StateToolSchema[],
		config: LlmConfig,
		signal?: AbortSignal,
		onDelta?: (delta: string) => void
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
	autoCompact: true,
	compactThreshold: DEFAULT_COMPACT_THRESHOLD,
	stream: false,
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
