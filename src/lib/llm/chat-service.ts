import type { ChatMessageView } from '../core/types';
import { buildContext, type ContextBundle, type ContextPipelineInput } from '../context/pipeline';
import { excludeFromContext } from '../context/history';
import {
	buildCompactedHistory,
	buildSummaryRequest,
	fallbackSummary,
	findBoundaryIndex,
	messagesAfterBoundary,
	shouldCompact,
	DEFAULT_KEEP_RECENT,
	type CompactionState
} from './compaction';
import { estimateMessagesTokens, sumUsage } from './model-info';
import {
	executeStateTool,
	type ExecutedToolCall,
	type StateToolContext,
	type StateToolDefinition
} from './state-tools';
import { formatWorldTimeLabel, sanitizeAssistantText } from './message-time';
import type { ChatMessage, LlmClient, LlmConfig, TokenUsage } from './types';

/** 开发者模式下展示的请求参数：用于排查 max_tokens / stream 等是否真正生效。 */
export interface DebugRequestInfo {
	model: string;
	maxTokens: number;
	stream: boolean;
	/** 是否启用了状态工具（agent 循环）。 */
	toolsEnabled: boolean;
}

/** 开发者模式下展示的最近一次请求：完整系统消息 + 实际发送的消息数组 + 请求参数。 */
export interface DebugPromptView {
	systemMessage: string;
	messages: ChatMessage[];
	request?: DebugRequestInfo;
}

/** 开发者输入预览结果：完整提示词，或提示性说明（斜杠命令/空输入）。 */
export type PromptPreviewResult =
	{ kind: 'prompt'; debug: DebugPromptView; note?: string } | { kind: 'notice'; text: string };

/** agent 循环中一轮工具调用的反馈（供持久化展示）。 */
export interface RoundToolFeedback {
	name: string;
	output: string;
}

/** agent 循环中的一轮：叙事文本（可空）+ 该轮执行的工具反馈。 */
export interface ReplyRound {
	content: string | null;
	thinking?: string;
	tools: RoundToolFeedback[];
}

/** 自动上下文压缩参数（生成回复时按需触发）。 */
export interface CompactionOptions {
	/** 模型上下文窗口；null 表示未知（此时不自动压缩）。 */
	contextWindow: number | null;
	/** 触发阈值：估计用量（含输出预算）占上下文窗口的比例。 */
	threshold: number;
	/** 摘要之外原样保留的最近消息条数。 */
	keepRecent: number;
	/** 上次请求产生的压缩状态；跨请求延续摘要边界。 */
	state: CompactionState | null;
}

/** agent 循环的可选参数。 */
export interface GenerateReplyOptions {
	/** 要暴露给模型的状态工具；为空则退化为纯文本对话。 */
	tools?: readonly StateToolDefinition[];
	/** 工具执行上下文（由角色会话提供）。 */
	toolContext?: StateToolContext;
	/** 单轮对话内最多允许的工具调用轮数，防止死循环。 */
	maxToolTurns?: number;
	/** 自动上下文压缩配置；缺省 = 不压缩、完整发送历史。 */
	compaction?: CompactionOptions;
	/** 流式输出回调：真实端点按块回调增量文本，供 UI 边生成边显示。 */
	onDelta?: (delta: string) => void;
}

/** 默认最大工具轮数：超过后停止并以提示文本收尾。 */
const DEFAULT_MAX_TOOL_TURNS = 4;

/**
 * 对话服务：把「状态 + 历史 + 世界信息」组装为上下文，再调用 LLM。
 * 上下文压缩遵循 opencode / Chatbox 的现代做法——阈值触发 + LLM 生成延续摘要，
 * 最近消息原样保留；本地会话与快照始终完整，压缩只影响发送给模型的内容。
 */
export class ChatService {
	constructor(private readonly client: LlmClient) {}

	/** 生成助手回复。返回回复文本与上下文包（供 UI 调试/测试）。 */
	async generateReply(
		input: ContextPipelineInput,
		config: LlmConfig,
		options: GenerateReplyOptions = {},
		signal?: AbortSignal
	): Promise<{
		reply: string;
		bundle: ContextBundle;
		executedTools: ExecutedToolCall[];
		debug: DebugPromptView;
		usage: TokenUsage | undefined;
		compaction: CompactionState | null;
		thinking: string | undefined;
		/** 端点的 finish_reason（stop / length 等）；正文为空时为「输出预算耗尽」排查提供依据。 */
		finishReason: string | undefined;
		/** 工具调用轮次（按顺序；每轮含叙事文本与工具反馈，最终回复在 reply）。 */
		rounds: ReplyRound[];
	}> {
		let usage: TokenUsage | undefined;
		let compaction: CompactionState | null = options.compaction?.state ?? null;

		// 1) 按当前压缩状态组装「本次发送的历史」；无状态 = 完整历史。
		let sendHistory = this.buildSendHistory(input.conversation, compaction);

		// 2) 用探测上下文估算用量，判断是否触发自动压缩。
		const compactCfg = options.compaction;
		if (compactCfg !== undefined && compactCfg.contextWindow !== null) {
			const bundle = buildContext({
				...input,
				conversation: sendHistory,
				historyOptions: { maxMessages: Math.max(1, sendHistory.length) }
			});
			const estimated = estimateMessagesTokens([
				{ role: 'system', content: bundle.systemMessage },
				...bundle.messages
			]);
			if (
				shouldCompact(estimated, config.maxTokens, compactCfg.contextWindow, compactCfg.threshold)
			) {
				const result = await this.compactConversation(
					input.conversation,
					config,
					{ state: compaction, keepRecent: compactCfg.keepRecent },
					signal
				);
				compaction = result.state;
				usage = mergeUsage(usage, result.usage);
				sendHistory = this.buildSendHistory(input.conversation, compaction);
			}
		}

		// 3) 用最终发送历史组装上下文包（系统消息 + 历史）。
		let bundle = buildContext({
			...input,
			conversation: sendHistory,
			historyOptions: { maxMessages: Math.max(1, sendHistory.length) }
		});
		let messages: ChatMessage[] = [
			{ role: 'system', content: bundle.systemMessage },
			...bundle.messages
		];
		let debug: DebugPromptView = buildDebugView(bundle.systemMessage, messages, config, options);
		const executedTools: ExecutedToolCall[] = [];
		const rounds: ReplyRound[] = [];

		if (options.tools !== undefined && options.tools.length > 0 && options.toolContext) {
			if (this.client.chatWithTools) {
				const maxTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;
				for (let turn = 0; turn < maxTurns; turn += 1) {
					debug = buildDebugView(messages[0]!.content, messages, config, options);
					const result = await this.client.chatWithTools(
						messages,
						options.tools,
						config,
						signal,
						options.onDelta
					);
					usage = mergeUsage(usage, result.usage);
					if (result.toolCalls.length === 0) {
						return {
							reply: sanitizeAssistantText(result.content ?? ''),
							bundle,
							executedTools,
							debug,
							usage,
							compaction,
							thinking: result.thinking,
							finishReason: result.finishReason,
							rounds
						};
					}
					const toolMessages: ChatMessage[] = [];
					const roundTools: RoundToolFeedback[] = [];
					const feedbackLines: string[] = [];
					for (const call of result.toolCalls) {
						const outcome = await executeStateTool(options.tools, call, options.toolContext);
						executedTools.push(outcome);
						roundTools.push({ name: call.name, output: outcome.output });
						feedbackLines.push(
							`- ${call.name}(${formatToolArguments(call.arguments)}) → ${outcome.output}`
						);
						toolMessages.push({
							role: 'tool',
							content: outcome.output,
							toolCallId: call.id,
							name: call.name
						});
					}
					rounds.push({
						content: sanitizeAssistantText(result.content ?? '') || null,
						thinking: result.thinking,
						tools: roundTools
					});
					messages = [
						...messages,
						{
							role: 'assistant',
							content: result.content ?? '',
							toolCalls: result.toolCalls,
							// DeepSeek 思考模式要求工具轮次的 reasoning_content 原样回传，
							// 否则续答时模型可能只思考、不输出正文（或端点直接 400）。
							reasoning: result.thinking
						},
						...toolMessages
					];
					// 状态工具已产生新快照，重新生成状态摘要，让模型感知最新状态。
					bundle = buildContext({
						...input,
						state: options.toolContext.getState(),
						conversation: sendHistory,
						toolFeedback: `【工具执行反馈】以下工具已成功调用并立即生效，当前状态已同步更新：\n${feedbackLines.join('\n')}`,
						historyOptions: { maxMessages: Math.max(1, sendHistory.length) }
					});
					messages = [{ role: 'system', content: bundle.systemMessage }, ...messages.slice(1)];
				}
				return {
					reply: '（AI 已连续执行多次状态变更，先暂停。请发送新消息继续。）',
					bundle,
					executedTools,
					debug,
					usage,
					compaction,
					thinking: undefined,
					finishReason: undefined,
					rounds
				};
			}
		}

		const result = await this.client.chat(messages, config, signal, options.onDelta);
		return {
			reply: sanitizeAssistantText(result.content ?? ''),
			bundle,
			executedTools,
			debug,
			usage: mergeUsage(usage, result.usage),
			compaction,
			thinking: result.thinking,
			finishReason: result.finishReason,
			rounds
		};
	}

	/**
	 * 手动压缩：把边界后的早期消息总结为延续摘要（无论是否达到阈值）。
	 * 返回新的压缩状态供页面保存；无新增可压缩消息时返回原状态。
	 */
	async compactConversation(
		conversation: ReadonlyArray<ChatMessageView>,
		config: LlmConfig,
		options: { state?: CompactionState | null; keepRecent?: number } = {},
		signal?: AbortSignal
	): Promise<{ state: CompactionState | null; usage: TokenUsage | undefined }> {
		const keep = Math.max(1, Math.floor(options.keepRecent ?? DEFAULT_KEEP_RECENT));
		const state = options.state ?? null;
		const boundaryIndex = state === null ? -1 : findBoundaryIndex(conversation, state.boundaryId);
		const base = boundaryIndex === -1 ? [...conversation] : conversation.slice(boundaryIndex);
		const toCompact = base.slice(0, Math.max(0, base.length - keep));
		if (toCompact.length === 0) {
			return { state, usage: undefined };
		}
		const request = buildSummaryRequest(state, toCompact, boundaryIndex !== -1);
		const summaryResult = await this.runSummary(request, config, toCompact, signal);
		const keptStart = base[base.length - keep];
		const nextState: CompactionState = {
			summary: summaryResult.summary,
			boundaryId: keptStart?.id ?? state?.boundaryId ?? ''
		};
		return { state: nextState, usage: summaryResult.usage };
	}

	/** 按压缩状态组装发送历史：摘要系统消息 + 边界后消息。 */
	private buildSendHistory(
		conversation: ReadonlyArray<ChatMessageView>,
		state: CompactionState | null
	): ChatMessageView[] {
		const contextMessages = excludeFromContext(conversation);
		if (state === null) {
			return contextMessages;
		}
		return buildCompactedHistory(
			state.summary,
			messagesAfterBoundary(contextMessages, state.boundaryId)
		);
	}

	/** 执行摘要请求；失败（非取消）时回退到确定性兜底摘要，保证对话不中断。 */
	private async runSummary(
		request: ChatMessage[],
		config: LlmConfig,
		fallbackMessages: ReadonlyArray<ChatMessageView>,
		signal?: AbortSignal
	): Promise<{ summary: string; usage: TokenUsage | undefined }> {
		try {
			if (this.client.summarize) {
				const result = await this.client.summarize(request, config, signal);
				return { summary: sanitizeAssistantText(result.summary.trim()), usage: result.usage };
			}
			const result = await this.client.chat(request, config, signal);
			return {
				summary: sanitizeAssistantText((result.content ?? '').trim()),
				usage: result.usage
			};
		} catch (err) {
			if (signal?.aborted) {
				throw err;
			}
			return { summary: fallbackSummary(fallbackMessages), usage: undefined };
		}
	}
}

/** 把最近一次请求序列化为纯文本（供调试复制）。 */
export function serializeDebugPrompt(view: DebugPromptView): string {
	const parts: string[] = [`[system] ${view.systemMessage}`];
	for (const message of view.messages) {
		// 世界时间标注贴在角色标签同一行（如 [user]（周一 09:00）），正文另起一段，
		// 与发送给模型的结构化角色分隔一致，便于阅读且不与正文混淆。
		const label = message.worldTime !== undefined ? formatWorldTimeLabel(message.worldTime) : '';
		parts.push(`[${message.role}]${label} ${message.content}`);
		if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
			parts.push(`[tool_calls] ${JSON.stringify(message.toolCalls, null, 2)}`);
		}
	}
	return parts.join('\n\n');
}

/** 组装开发者视图：系统消息 + 消息数组 + 本次实际请求参数。 */
function buildDebugView(
	systemMessage: string,
	messages: ChatMessage[],
	config: LlmConfig,
	options: GenerateReplyOptions
): DebugPromptView {
	return {
		systemMessage,
		messages,
		request: {
			model: config.model,
			maxTokens: config.maxTokens,
			stream: config.stream === true,
			toolsEnabled: (options.tools?.length ?? 0) > 0
		}
	};
}

/** 把工具参数格式化为紧凑文本，如「slot=上衣, item=白色衬衫」。 */
function formatToolArguments(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
		.join(', ');
}

/** 合并累计用量：任一为空时原样透传。 */
function mergeUsage(
	accumulated: TokenUsage | undefined,
	next: TokenUsage | undefined
): TokenUsage | undefined {
	if (next === undefined) {
		return accumulated;
	}
	if (accumulated === undefined) {
		return next;
	}
	return sumUsage(accumulated, next);
}
