import { LlmError } from '../core/errors';
import type { MessageSegment } from '../core/types';
import { annotateWorldTime } from './message-time';
import { isDeepSeekModel } from './providers';
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

/** 流式读取看门狗：超过该时长未收到任何数据块，判定连接挂起并抛错。 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;
/** 看门狗触发时的用户可见错误信息。 */
const STREAM_IDLE_TIMEOUT_MESSAGE = '模型服务 120 秒未返回数据，连接可能挂起';

/**
 * OpenAI-compatible Chat Completions 客户端。
 * 通过原生 fetch 调用任意兼容端点（LiteLLM Proxy、vLLM、Ollama 等均可）。
 */
export class OpenAiCompatibleClient implements LlmClient {
	/** 发送对话并返回 assistant 文本。失败统一抛 LlmError。 */
	async chat(
		messages: ChatMessage[],
		config: LlmConfig,
		signal?: AbortSignal,
		onDelta?: (delta: string) => void,
		options?: { jsonMode?: boolean; onThinkingDelta?: (delta: string) => void }
	): Promise<LlmChatResult> {
		return this.chatWithTools(messages, [], config, signal, onDelta, options);
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
		signal?: AbortSignal,
		onDelta?: (delta: string) => void,
		options?: {
			forceToolCall?: boolean;
			jsonMode?: boolean;
			onThinkingDelta?: (delta: string) => void;
		}
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
				body: JSON.stringify(
					buildRequestBody(
						messages,
						tools,
						config,
						options?.forceToolCall === true,
						options?.jsonMode === true
					)
				),
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

		if (config.stream === true) {
			return await parseStreamedResult(response, onDelta, options?.onThinkingDelta);
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch (err) {
			throw new LlmError(
				`模型服务返回了无法解析的响应：${err instanceof Error ? err.message : 'JSON 错误'}`
			);
		}
		return buildChatResult(data);
	}
}

/** 从完整 JSON 响应组装结果（非流式 + 流式降级共用）。 */
function buildChatResult(data: unknown): LlmChatResult {
	const content = extractContent(data);
	const toolCalls = extractToolCalls(data);
	const usage = extractUsage(data);
	const thinking = extractThinking(data);
	const finishReason = extractFinishReason(data);
	// 响应里带 tool_calls 数组但没有任何合法条目（函数名为空/结构残缺）：
	// 说明模型试图调用工具但格式无效，标记给上层回写错误提示，而不是静默当作普通回复。
	const malformedToolCall = hasToolCallEntries(data) && toolCalls.length === 0;
	// 非流式响应只有一个 thinking + 一个 content，不存在交错；仍按段返回方便气泡统一渲染。
	const segments = buildSimpleSegments(thinking, content);
	if (toolCalls.length > 0) {
		return { content, toolCalls, usage, thinking, finishReason, segments, malformedToolCall };
	}
	if (content !== null) {
		const inline = extractInlineToolCall(content);
		if (inline.length > 0) {
			return {
				content: null,
				toolCalls: inline,
				usage,
				thinking,
				finishReason,
				segments,
				malformedToolCall
			};
		}
		return { content, toolCalls: [], usage, thinking, finishReason, segments, malformedToolCall };
	}
	// content 为 null/缺失但响应结构里有 choices[0].message：这是合法的「空回复」
	// （仅思考过程 / 命中长度上限 / 模型没说话），按空正文处理，不再误报协议错误。
	if (hasInvalidContentType(data)) {
		throw new LlmError(
			`模型响应缺少 choices[0].message.content（类型异常）：${summarizeResponse(data)}`
		);
	}
	if (hasMessageRecord(data)) {
		return {
			content: '',
			toolCalls: [],
			usage,
			thinking,
			finishReason,
			segments,
			malformedToolCall
		};
	}
	throw new LlmError(`模型响应缺少 choices[0].message：${summarizeResponse(data)}`);
}

/**
 * 解析 SSE 流式响应：逐块累积 content / reasoning / tool_calls / usage，
 * 实时回调 onDelta 供 UI 流式渲染。
 * 端点忽略 stream 直接返回 JSON 时，回退到 buildChatResult 解析。
 */
async function parseStreamedResult(
	response: Response,
	onDelta: ((delta: string) => void) | undefined,
	onThinkingDelta: ((delta: string) => void) | undefined
): Promise<LlmChatResult> {
	let content = '';
	const thinkingParts: string[] = [];
	// 按流中实际顺序记录思考/正文段落（interleaved thinking），供气泡分段展示。
	const segments: MessageSegment[] = [];
	let lastSegmentKind: 'thinking' | 'text' | null = null;
	let usage: TokenUsage | undefined;
	let finishReason: string | undefined;
	const toolMap = new Map<number, { id: string; name: string; argumentsRaw: string }>();
	// 流中是否出现过 tool_calls delta（即使全部无效也记一次，用于判定「尝试调用但失败」）。
	let sawToolCallDeltas = false;
	let sawEvent = false;
	let sawMeaningfulEvent = false;
	let rawText = '';
	try {
		const result = await readSse(response.body, (payload) => {
			sawEvent = true;
			let data: unknown;
			try {
				data = JSON.parse(payload);
			} catch {
				return;
			}
			const delta = extractStreamDelta(data);
			if (
				delta.content !== undefined ||
				delta.thinking !== undefined ||
				delta.toolCalls !== undefined ||
				delta.usage !== undefined
			) {
				sawMeaningfulEvent = true;
			}
			if (delta.content !== undefined && delta.content !== '') {
				content += delta.content;
				onDelta?.(delta.content);
				if (lastSegmentKind === 'text' && segments.length > 0) {
					segments[segments.length - 1]!.content += delta.content;
				} else {
					segments.push({ kind: 'text', content: delta.content });
					lastSegmentKind = 'text';
				}
			}
			if (delta.thinking !== undefined && delta.thinking !== '') {
				thinkingParts.push(delta.thinking);
				onThinkingDelta?.(delta.thinking);
				if (lastSegmentKind === 'thinking' && segments.length > 0) {
					segments[segments.length - 1]!.content += delta.thinking;
				} else {
					segments.push({ kind: 'thinking', content: delta.thinking });
					lastSegmentKind = 'thinking';
				}
			}
			if (delta.toolCalls !== undefined) {
				sawToolCallDeltas = true;
				accumulateStreamToolCalls(toolMap, delta.toolCalls);
			}
			if (delta.usage !== undefined) {
				usage = delta.usage;
			}
			if (delta.finishReason !== undefined) {
				finishReason = delta.finishReason;
			}
		});
		rawText = result.rawText;
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new LlmError('请求已取消');
		}
		throw new LlmError(`无法读取流式响应：${err instanceof Error ? err.message : '网络错误'}`);
	}

	// 端点忽略 stream 参数、返回完整 JSON：按非流式解析。
	if (!sawEvent) {
		let data: unknown;
		try {
			data = JSON.parse(rawText);
		} catch {
			throw new LlmError('模型服务返回了无法解析的响应');
		}
		return buildChatResult(data);
	}

	const toolEntries = [...toolMap.entries()].sort((a, b) => a[0] - b[0]);
	const toolCalls = toolEntries
		.map(([index, entry]) =>
			entry.name === ''
				? null
				: {
						id: entry.id === '' ? `call_${index}` : entry.id,
						name: entry.name,
						arguments: parseJsonObject(entry.argumentsRaw)
					}
		)
		.filter((call): call is ToolCall => call !== null);
	// 出现了 tool_calls delta 却没有任何合法条目（或部分条目函数名为空被丢弃）：
	// 标记给上层，让模型知道调用没被接收，而不是以为已经生效。
	const droppedToolEntries = toolEntries.some(([, entry]) => entry.name === '');
	const malformedToolCall = sawToolCallDeltas && (toolCalls.length === 0 || droppedToolEntries);
	const finalSegments = segments.length > 0 ? segments : undefined;
	const thinking = thinkingParts.join('').trim() || undefined;
	if (toolCalls.length > 0) {
		return {
			content: content === '' ? null : content,
			toolCalls,
			usage,
			thinking,
			finishReason,
			segments: finalSegments,
			malformedToolCall
		};
	}
	if (content !== '') {
		return {
			content,
			toolCalls: [],
			usage,
			thinking,
			finishReason,
			segments: finalSegments,
			malformedToolCall
		};
	}
	// 流中收到过有效数据块（思考/用量等）但最终没有正文：按空回复处理，
	// 避免「模型只思考不开口」被误判为协议错误。
	if (sawMeaningfulEvent) {
		return {
			content: '',
			toolCalls: [],
			usage,
			thinking,
			finishReason,
			segments: finalSegments,
			malformedToolCall
		};
	}
	throw new LlmError(
		`模型响应缺少 choices[0].message（无有效内容块）：${summarizeResponse(rawText)}`
	);
}

/** 非流式结果按「思考在前、正文在后」组装为两段（无思考则只有正文段）。 */
function buildSimpleSegments(
	thinking: string | undefined,
	content: string | null
): MessageSegment[] | undefined {
	const segments: MessageSegment[] = [];
	if (thinking !== undefined && thinking.trim() !== '') {
		segments.push({ kind: 'thinking', content: thinking });
	}
	if (content !== null && content.trim() !== '') {
		segments.push({ kind: 'text', content });
	}
	return segments.length > 0 ? segments : undefined;
}

/** 响应中是否存在 tool_calls 数组（哪怕全部条目无效）。 */
function hasToolCallEntries(data: unknown): boolean {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return false;
	}
	const message = isRecord(data.choices[0]) ? data.choices[0].message : undefined;
	return isRecord(message) && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

/** 逐行读取 SSE 流，回调每个 data: 载荷；返回是否收到事件与原始文本。 */
async function readSse(
	body: ReadableStream<Uint8Array> | null,
	onPayload: (payload: string) => void
): Promise<{ sawEvent: boolean; rawText: string }> {
	if (body === null) {
		return { sawEvent: false, rawText: '' };
	}
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let rawText = '';
	let sawEvent = false;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	/** 清除看门狗计时器（读到数据或流结束时调用）。 */
	function clearIdleTimer(): void {
		if (idleTimer !== undefined) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	}
	try {
		while (true) {
			// 每次等待数据块前挂上看门狗：长时间无字节说明服务端挂起，
			// 立即取消读取并抛出可读错误，避免界面永远停在「思考中」。
			const idleGuard = new Promise<never>((_, reject) => {
				clearIdleTimer();
				idleTimer = setTimeout(() => {
					void reader.cancel().catch(() => undefined);
					reject(new Error(STREAM_IDLE_TIMEOUT_MESSAGE));
				}, STREAM_IDLE_TIMEOUT_MS);
			});
			const { done, value } = await Promise.race([reader.read(), idleGuard]);
			clearIdleTimer();
			if (done) {
				break;
			}
			if (value !== undefined) {
				const text = decoder.decode(value, { stream: true });
				rawText += text;
				buffer += text;
			}
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
				buffer = buffer.slice(newlineIndex + 1);
				const trimmed = line.trim();
				if (trimmed.startsWith('data:')) {
					const payload = trimmed.slice(5).trim();
					if (payload !== '' && payload !== '[DONE]') {
						sawEvent = true;
						onPayload(payload);
					}
				}
			}
		}
	} finally {
		clearIdleTimer();
		reader.releaseLock();
	}
	return { sawEvent, rawText };
}

/** 提取单个 SSE 块的 delta：content / thinking / tool_calls / usage。 */
function extractStreamDelta(data: unknown): {
	content?: string;
	thinking?: string;
	toolCalls?: unknown[];
	usage?: TokenUsage;
	finishReason?: string;
} {
	if (!isRecord(data)) {
		return {};
	}
	const choices = data.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		// stream_options.include_usage 时最后一个块带 usage、无 choices。
		const usage = extractUsage(data);
		return usage === undefined ? {} : { usage };
	}
	const delta = isRecord(choices[0]) ? choices[0].delta : undefined;
	if (!isRecord(delta)) {
		return {};
	}
	const result: {
		content?: string;
		thinking?: string;
		toolCalls?: unknown[];
		finishReason?: string;
	} = {};
	if (typeof choices[0].finish_reason === 'string') {
		result.finishReason = choices[0].finish_reason;
	}
	if (typeof delta.content === 'string') {
		result.content = delta.content;
	} else if (Array.isArray(delta.content)) {
		// 部分端点把 content 作为多段数组流式下发，兼容提取 text 片段。
		const parts = delta.content
			.filter(
				(part): part is Record<string, unknown> =>
					isRecord(part) && (part.type === 'text' || part.type === 'input_text')
			)
			.map((part) => (typeof part.text === 'string' ? part.text : ''))
			.join('');
		if (parts !== '') {
			result.content = parts;
		}
	}
	const thinking = delta.reasoning_content ?? delta.reasoning;
	if (typeof thinking === 'string') {
		result.thinking = thinking;
	}
	if (Array.isArray(delta.tool_calls)) {
		result.toolCalls = delta.tool_calls;
	}
	return result;
}

/** 累积流式 tool_calls 增量（按 index 合并 id/name/arguments 片段）。 */
function accumulateStreamToolCalls(
	map: Map<number, { id: string; name: string; argumentsRaw: string }>,
	entries: unknown[]
): void {
	for (const entry of entries) {
		if (!isRecord(entry)) {
			continue;
		}
		const index = typeof entry.index === 'number' ? entry.index : 0;
		const current = map.get(index) ?? { id: '', name: '', argumentsRaw: '' };
		if (typeof entry.id === 'string' && entry.id !== '') {
			current.id = entry.id;
		}
		const fn = entry.function;
		if (isRecord(fn)) {
			if (typeof fn.name === 'string' && fn.name !== '') {
				current.name = fn.name;
			}
			if (typeof fn.arguments === 'string') {
				current.argumentsRaw += fn.arguments;
			}
		}
		map.set(index, current);
	}
}

/**
 * 从响应中提取思考过程：兼容 reasoning_content（DeepSeek 等）与 reasoning 字段。
 * 空串或缺失返回 undefined；思考内容只用于展示，不会回传给 API。
 */
function extractThinking(data: unknown): string | undefined {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return undefined;
	}
	const choice = data.choices[0];
	const message = isRecord(choice) ? choice.message : undefined;
	const candidate =
		isRecord(message) && typeof message.reasoning_content === 'string'
			? message.reasoning_content
			: isRecord(message) && typeof message.reasoning === 'string'
				? message.reasoning
				: undefined;
	const trimmed = candidate?.trim() ?? '';
	return trimmed === '' ? undefined : trimmed;
}

/** 从响应中提取 finish_reason（stop / length 等）；缺失或非法返回 undefined。 */
function extractFinishReason(data: unknown): string | undefined {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return undefined;
	}
	const choice = data.choices[0];
	if (!isRecord(choice)) {
		return undefined;
	}
	return typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
}

/** 组装请求体：基础字段 + 可选 tools 声明。导出供调试视图展示实际发送内容。 */
export function buildRequestBody(
	messages: ChatMessage[],
	tools: readonly StateToolSchema[],
	config: LlmConfig,
	forceToolCall = false,
	jsonMode = false
): Record<string, unknown> {
	// DeepSeek V4 思考模式：多轮历史里每条 assistant 消息都必须带 reasoning_content
	// （空字符串也可），否则切换模型/跨轮次后 API 返回 400 或思考行为异常。
	// 这里统一在序列化层补全，避免上层各调用点遗漏。
	const deepSeekThinking = isDeepSeekModel(config);
	const body: Record<string, unknown> = {
		model: config.model,
		messages: messages.map((message) => serializeMessage(message, deepSeekThinking)),
		temperature: config.temperature,
		max_tokens: config.maxTokens
	};
	if (jsonMode) {
		// DeepSeek JSON Output：要求响应为合法 JSON 对象，提示词中须包含 "json" 字样。
		body.response_format = { type: 'json_object' };
	}
	if (config.stream === true) {
		body.stream = true;
		body.stream_options = { include_usage: true };
	}
	if (tools.length > 0) {
		body.tools = tools.map(serializeTool);
		// DeepSeek V4 思考模式不接受 tool_choice（400），跳过强制档，靠强提示驱动。
		if (forceToolCall && !isDeepSeekModel(config)) {
			// 对齐 openai-agents / AG2：强制模型至少发一个工具调用（部分端点不支持）。
			body.tool_choice = 'required';
		}
	}
	return body;
}

/** 把内部消息结构序列化为 OpenAI-compatible 消息。 */
function serializeMessage(
	message: ChatMessage,
	deepSeekThinking = false
): Record<string, unknown> {
	// 世界时间只在「序列化给模型」这一步注入为元数据行，消息正文始终纯净。
	const content =
		message.worldTime !== undefined
			? annotateWorldTime(message.content, message.worldTime)
			: message.content;
	const serialized: Record<string, unknown> = { role: message.role, content };
	if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
		serialized.tool_calls = message.toolCalls.map((call) => ({
			id: call.id,
			type: 'function',
			function: { name: call.name, arguments: JSON.stringify(call.arguments) }
		}));
	}
	// DeepSeek 思考模式：所有 assistant 历史消息都必须带 reasoning_content——
	// 有思考原样回传，没有（如来自其他模型的轮次）补空字符串，保证思考模式连续性。
	if (message.role === 'assistant' && deepSeekThinking) {
		serialized.reasoning_content =
			message.reasoning !== undefined && message.reasoning !== '' ? message.reasoning : '';
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

/**
 * 从 Chat Completions 响应中提取文本内容。
 * 兼容 content 为字符串与多段数组（[{type:'text',text:'…'}]）两种形态；
 * 缺失 / null / 无文本片段返回 null。
 */
function extractContent(data: unknown): string | null {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return null;
	}
	if (!isRecord(data.choices[0]) || !isRecord(data.choices[0].message)) {
		return null;
	}
	return extractMessageText(data.choices[0].message.content);
}

/** 提取消息文本：字符串原样返回；数组取全部 text / input_text 片段拼接。 */
function extractMessageText(content: unknown): string | null {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		const parts = content
			.filter(
				(part): part is Record<string, unknown> =>
					isRecord(part) && (part.type === 'text' || part.type === 'input_text')
			)
			.map((part) => (typeof part.text === 'string' ? part.text : ''))
			.join('');
		return parts === '' ? null : parts;
	}
	return null;
}

/** choices[0].message 是否为合法对象（结构完整，正文可为空）。 */
function hasMessageRecord(data: unknown): boolean {
	return (
		isRecord(data) &&
		Array.isArray(data.choices) &&
		data.choices.length > 0 &&
		isRecord(data.choices[0]) &&
		isRecord(data.choices[0].message)
	);
}

/** content 字段存在但类型非法（非 string / 数组 / null），属于畸形响应。 */
function hasInvalidContentType(data: unknown): boolean {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
		return false;
	}
	const message = isRecord(data.choices[0]) ? data.choices[0].message : undefined;
	if (!isRecord(message)) {
		return false;
	}
	const content = message.content;
	return (
		content !== null &&
		content !== undefined &&
		typeof content !== 'string' &&
		!Array.isArray(content)
	);
}

/** 生成可诊断的响应摘要（截断，避免报错刷屏）。 */
function summarizeResponse(data: unknown): string {
	let text = '';
	try {
		text = typeof data === 'string' ? data : JSON.stringify(data);
	} catch {
		text = String(data);
	}
	return text.slice(0, 200);
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
		// 兼容两种形态：JSON 字符串（标准）与已解析对象（部分代理直接返回对象）。
		const argumentsRaw =
			typeof fn.arguments === 'string'
				? fn.arguments
				: isRecord(fn.arguments)
					? JSON.stringify(fn.arguments)
					: '';
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
	// DeepSeek 原生 API 在 usage 顶层返回 prompt_cache_hit_tokens /
	// prompt_cache_miss_tokens，而非 OpenAI 标准的
	// prompt_tokens_details.cached_tokens；两者都读，避免缓存显示恒为 0、
	// 费用按未缓存价误算。
	const openAiCached = toNonNegativeInt(isRecord(details) ? details.cached_tokens : undefined);
	const deepseekCached = toNonNegativeInt(usage.prompt_cache_hit_tokens);
	return {
		promptTokens: promptTokens ?? 0,
		completionTokens: completionTokens ?? 0,
		cachedTokens: openAiCached ?? deepseekCached ?? 0
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
