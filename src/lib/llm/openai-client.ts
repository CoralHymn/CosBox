import { LlmError } from '../core/errors';
import type {
	ChatMessage,
	LlmChatResult,
	LlmClient,
	LlmConfig,
	LlmSummaryResult,
	StateToolSchema,
	ToolCall,
	TokenUsage
} from './types';

/**
 * OpenAI-compatible Chat Completions 客户端。
 * 通过原生 fetch 调用任意兼容端点（LiteLLM Proxy、vLLM、Ollama 等均可）。
 */
export class OpenAiCompatibleClient implements LlmClient {
	/** 发送对话并返回 assistant 文本。失败统一抛 LlmError。 */
	async chat(
		messages: ChatMessage[],
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmChatResult> {
		return this.chatWithTools(messages, [], config, signal);
	}

	/** 上下文压缩摘要：把摘要请求当普通对话发送，取最终文本。 */
	async summarize(
		request: ChatMessage[],
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmSummaryResult> {
		const result = await this.chat(request, config, signal);
		return { summary: result.content ?? '', usage: result.usage };
	}

	/**
	 * 发送带工具声明的对话，返回文本与结构化工具调用。
	 * 兼容两种返回形态：标准 choices[0].message.tool_calls，以及
	 * 部分端点/演示客户端返回的纯文本 JSON（{"tool": "...", "args": {...}}）。
	 */
	async chatWithTools(
		messages: ChatMessage[],
		tools: readonly StateToolSchema[],
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmChatResult> {
		const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
		if (baseUrl === '') {
			throw new LlmError('未配置模型服务地址');
		}

		let response: Response;
		try {
			response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
				},
				body: JSON.stringify(buildRequestBody(messages, tools, config)),
				signal
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new LlmError('请求已取消');
			}
			throw new LlmError(`无法连接模型服务：${err instanceof Error ? err.message : '网络错误'}`);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new LlmError(
				`模型服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
				response.status
			);
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch (err) {
			throw new LlmError(
				`模型服务返回了无法解析的响应：${err instanceof Error ? err.message : 'JSON 错误'}`
			);
		}

		const content = extractContent(data);
		const toolCalls = extractToolCalls(data);
		const usage = extractUsage(data);
		if (toolCalls.length > 0) {
			return { content, toolCalls, usage };
		}
		if (content !== null) {
			const inline = extractInlineToolCall(content);
			if (inline.length > 0) {
				return { content: null, toolCalls: inline, usage };
			}
			return { content, toolCalls: [], usage };
		}
		throw new LlmError('模型响应缺少 choices[0].message.content');
	}
}

/** 组装请求体：基础字段 + 可选 tools 声明。 */
function buildRequestBody(
	messages: ChatMessage[],
	tools: readonly StateToolSchema[],
	config: LlmConfig
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: config.model,
		messages: messages.map(serializeMessage),
		temperature: config.temperature,
		max_tokens: config.maxTokens
	};
	if (tools.length > 0) {
		body.tools = tools.map(serializeTool);
	}
	return body;
}

/** 把内部消息结构序列化为 OpenAI-compatible 消息。 */
function serializeMessage(message: ChatMessage): Record<string, unknown> {
	const serialized: Record<string, unknown> = { role: message.role, content: message.content };
	if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
		serialized.tool_calls = message.toolCalls.map((call) => ({
			id: call.id,
			type: 'function',
			function: { name: call.name, arguments: JSON.stringify(call.arguments) }
		}));
	}
	if (message.role === 'tool') {
		serialized.tool_call_id = message.toolCallId ?? '';
	}
	return serialized;
}

/** 把内部工具 schema 序列化为 function 工具声明。 */
function serializeTool(tool: StateToolSchema): Record<string, unknown> {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters
		}
	};
}

/** 从 Chat Completions 响应中提取文本内容；格式不符返回 null。 */
function extractContent(data: unknown): string | null {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return null;
	}
	if (!isRecord(data.choices[0]) || !isRecord(data.choices[0].message)) {
		return null;
	}
	return typeof data.choices[0].message.content === 'string'
		? data.choices[0].message.content
		: null;
}

/** 从响应中提取标准 tool_calls；格式不符返回空数组。 */
function extractToolCalls(data: unknown): ToolCall[] {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return [];
	}
	const message = data.choices[0]?.message;
	if (!isRecord(message) || !Array.isArray(message.tool_calls)) {
		return [];
	}
	const calls: ToolCall[] = [];
	message.tool_calls.forEach((entry, index) => {
		if (!isRecord(entry)) {
			return;
		}
		const fn = entry.function;
		if (!isRecord(fn)) {
			return;
		}
		const name = typeof fn.name === 'string' ? fn.name : '';
		if (name === '') {
			return;
		}
		const argumentsRaw = typeof fn.arguments === 'string' ? fn.arguments : '';
		calls.push({
			id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `call_${index}`,
			name,
			arguments: parseJsonObject(argumentsRaw)
		});
	});
	return calls;
}

/**
 * 从响应中提取 usage 用量：
 * prompt_tokens / completion_tokens 必填（可为 0），
 * prompt_tokens_details.cached_tokens 可选（部分端点提供）。
 * 字段缺失或非法时按 0 处理；完全缺失 usage 返回 undefined。
 */
function extractUsage(data: unknown): TokenUsage | undefined {
	if (!isRecord(data) || !isRecord(data.usage)) {
		return undefined;
	}
	const usage = data.usage;
	const promptTokens = toNonNegativeInt(usage.prompt_tokens);
	const completionTokens = toNonNegativeInt(usage.completion_tokens);
	if (promptTokens === null && completionTokens === null) {
		return undefined;
	}
	const details = usage.prompt_tokens_details;
	const cachedTokens = toNonNegativeInt(isRecord(details) ? details.cached_tokens : undefined);
	return {
		promptTokens: promptTokens ?? 0,
		completionTokens: completionTokens ?? 0,
		cachedTokens: cachedTokens ?? 0
	};
}

/** 读取非负整数；缺失/非法返回 null。 */
function toNonNegativeInt(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return Math.floor(value);
}

/** 兼容纯文本 JSON 工具调用形态：{"tool": "...", "args": {...}}。 */
function extractInlineToolCall(content: string): ToolCall[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [];
	}
	if (!isRecord(parsed)) {
		return [];
	}
	const tool = parsed.tool;
	if (typeof tool !== 'string' || tool.trim() === '') {
		return [];
	}
	return [
		{
			id: 'call_inline',
			name: tool,
			arguments: isRecord(parsed.args) ? parsed.args : {}
		}
	];
}

/** 解析工具参数 JSON；空串或非法 JSON 返回空对象。 */
function parseJsonObject(raw: string): Record<string, unknown> {
	if (raw.trim() === '') {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** 类型守卫：非空对象（Record）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
