import { addMinutes, formatWorldTime, minutesSinceMidnight } from '../core/state';
import type { ChatMessageView, WorldTime } from '../core/types';
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
import { runStateConfirmation, runStateJudge, type JudgeDebugView } from './state-judge';
import { formatWorldTimeLabel, sanitizeAssistantText } from './message-time';
import { extractTextToolCalls } from './text-tools';
import type { ChatMessage, LlmChatResult, LlmClient, LlmConfig, TokenUsage } from './types';

/** 开发者模式下展示的请求参数：用于排查 max_tokens / stream 等是否真正生效。 */
export interface DebugRequestInfo {
	model: string;
	maxTokens: number;
	stream: boolean;
	/** 是否启用了状态工具（agent 循环）。 */
	toolsEnabled: boolean;
}

/** 最近一次端点响应的摘要（空正文诊断用）。 */
export interface DebugLastResponse {
	finishReason?: string;
	hasContent: boolean;
	hasToolCalls: boolean;
	thinkingChars: number;
}

/** 开发者模式下展示的最近一次请求：完整系统消息 + 实际发送的消息数组 + 请求参数。 */
export interface DebugPromptView {
	systemMessage: string;
	messages: ChatMessage[];
	request?: DebugRequestInfo;
	lastResponse?: DebugLastResponse;
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
	/** LLM 状态确认：主回复未调用工具时，由独立 LLM 判断是否需要调用并补执行。 */
	enableStateJudge?: boolean;
}

/** 默认最大工具轮数：超过后停止并以提示文本收尾。 */
const DEFAULT_MAX_TOOL_TURNS = 4;
/** 思考型模型偶发「只思考不输出正文」时的重试提示：正文必填，必要时先调用工具。 */
const THINKING_ONLY_NUDGE =
	'【系统提示】你上一轮只输出了思考过程，没有输出正文。请直接输出正文回复，' +
	'正文必不可少；如果剧情需要调用状态工具，请先正常调用工具，再输出正文。';
/** 正文描述了时间流逝/推进但未调用 advance_time 时的补调提示。 */
const TIME_CLAIM_NUDGE =
	'【系统提示】你的回复描述了时间流逝或推进到具体时刻，但没有调用 advance_time 同步世界时间。' +
	'请先调用 advance_time（minutes 为具体分钟数），然后再输出正文。';

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
		/** LLM 状态判断的调试视图（未启用或未触发时为 null）。 */
		judgeDebug: JudgeDebugView | null;
		/** 工具调用轮次（按顺序；每轮含叙事文本与工具反馈，最终回复在 reply）。 */
		rounds: ReplyRound[];
	}> {
		let usage: TokenUsage | undefined;
		let compaction: CompactionState | null = options.compaction?.state ?? null;
		let judgeDebug: JudgeDebugView | null = null;

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
					let result = await this.client.chatWithTools(
						messages,
						options.tools,
						config,
						signal,
						options.onDelta
					);
					usage = mergeUsage(usage, result.usage);
					// 记录本轮模型最先说出的叙事文本与思考：补调重试可能覆盖 result，
					// 角色原本的消息不能因此丢失（否则会出现「工具调用前的话被吞掉」）。
					const roundNarrative =
						result.content !== null && result.content.trim() !== '' ? result.content : '';
					const roundThinking = result.thinking;
					// 结构化 tool_calls 缺失时，尝试从正文/思考中解析文本形式的工具调用
					// （DeepSeek 等思考模型有时把调用写进 reasoning 而不发 tool_calls）。
					if (result.toolCalls.length === 0) {
						const textCalls = extractTextToolCalls(
							`${result.thinking ?? ''}\n${result.content ?? ''}`
						);
						if (textCalls.length > 0) {
							result = { ...result, toolCalls: textCalls };
						}
					}
					// 思考里明确提到工具名却没发出 tool_calls（DeepSeek V4 常见漏调用）：
					// 追加「补发调用」提示重试一次，避免「正文都写了、工具却没调用」。
					if (result.toolCalls.length === 0) {
						const planned = detectPlannedTool(result.thinking);
						if (planned !== null) {
							const retried = await this.retryPlannedTool(
								messages,
								planned,
								config,
								options,
								signal
							);
							usage = mergeUsage(usage, retried?.usage);
							if (retried !== null) {
								result = retried;
							}
						}
					}
					// 正文直接描述时间流逝/推进（「已经傍晚了」「过了两个小时」）却没调用
					// advance_time：先提示补调，再尝试 tool_choice=required 强制补调。
					// 已执行过工具后不再触发，避免把「推进后的状态描述」再次误判为漏调用。
					if (
						result.toolCalls.length === 0 &&
						executedTools.length === 0 &&
						detectTimeClaim(result.content ?? '')
					) {
						const retried = await this.retryTimeClaim(messages, config, options, signal);
						usage = mergeUsage(usage, retried?.usage);
						if (retried !== null) {
							result = retried;
						}
					}
					// 思考型模型偶发「只思考、不输出正文」（finish_reason=stop）：
					// 追加正文必填提示重试一次，重试成功则采用重试结果（可能继续走工具轮）。
					if (isThinkingOnlyReply(result)) {
						const retried = await this.retryThinkingOnly(messages, config, options, signal);
						usage = mergeUsage(usage, retried?.usage);
						if (retried !== null) {
							result = retried;
						} else {
							// 带工具的重试仍失败：去掉工具声明、改非流式再试，
							// 规避 DeepSeek V4 思考模式在工具声明下的「只思考不产出」问题。
							const plain = await this.retryPlainText(messages, config, signal);
							usage = mergeUsage(usage, plain?.usage);
							if (plain !== null) {
								result = plain;
							}
						}
					}
					// 终极兜底：补调全部失败且端点始终不发 tool_calls 时，从模型文本中
					// 解析出可确定的时间推进值（「过了两小时」「推进到傍晚」等），
					// 由宿主直接执行 advance_time，并回写工具反馈让模型感知状态已同步。
					if (
						result.toolCalls.length === 0 &&
						executedTools.length === 0 &&
						options.toolContext !== undefined
					) {
						const claimSource = `${result.thinking ?? ''}\n${result.content ?? ''}`;
						if (
							detectTimeClaim(claimSource) ||
							/\badvance_time\b|推进时间|时间推进/.test(claimSource)
						) {
							// 时段推断（傍晚→18:00 等）只在有明确推进意图时启用，
							// 避免「随口提到傍晚」被误判成必须拨时间。
							const hasAdvanceIntent =
								/\badvance_time\b|推进时间|时间推进|推进到|需要推进|该推进/.test(claimSource);
							const minutes = resolveTimeAdvance(
								claimSource,
								options.toolContext.getState().schedule.time,
								hasAdvanceIntent
							);
							if (minutes !== null) {
								const now = options.toolContext.getState().schedule.time;
								await options.toolContext.advanceTime(minutes);
								const next = addMinutes(now, minutes);
								const output = `时间推进到 ${formatWorldTime(next)}`;
								executedTools.push({ id: 'host_infer', name: 'advance_time', output });
								rounds.push({
									content: null,
									tools: [{ name: 'advance_time', output }]
								});
							}
						}
					}
					if (result.toolCalls.length === 0) {
						if (options.enableStateJudge === true && executedTools.length === 0) {
							const judge = await this.maybeRunStateJudge(
								input,
								config,
								options,
								signal,
								result,
								executedTools.length > 0
							);
							executedTools.push(...judge.executed);
							rounds.push(...judge.rounds);
							judgeDebug = judge.debug;
						}
						debug = { ...debug, lastResponse: buildLastResponse(result) };
						return {
							reply: sanitizeAssistantText(result.content ?? ''),
							bundle,
							executedTools,
							debug,
							usage,
							compaction,
							thinking: result.thinking,
							finishReason: result.finishReason,
							judgeDebug,
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
						content:
							sanitizeAssistantText(
								roundNarrative !== '' ? roundNarrative : (result.content ?? '')
							) || null,
						thinking: roundThinking ?? result.thinking,
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
					judgeDebug: null,
					rounds
				};
			}
		}

		let result = await this.client.chat(messages, config, signal, options.onDelta);
		// 纯文本路径同样兜底一次「只思考不输出正文」。
		if (isThinkingOnlyReply(result)) {
			const retried = await this.retryThinkingOnly(messages, config, options, signal);
			usage = mergeUsage(usage, retried?.usage);
			if (retried !== null) {
				result = retried;
			} else {
				const plain = await this.retryPlainText(messages, config, signal);
				usage = mergeUsage(usage, plain?.usage);
				if (plain !== null) {
					result = plain;
				}
			}
		}
		debug = { ...debug, lastResponse: buildLastResponse(result) };
		if (options.enableStateJudge === true && executedTools.length === 0) {
			const judge = await this.maybeRunStateJudge(
				input,
				config,
				options,
				signal,
				result,
				executedTools.length > 0
			);
			executedTools.push(...judge.executed);
			rounds.push(...judge.rounds);
			judgeDebug = judge.debug;
		}
		return {
			reply: sanitizeAssistantText(result.content ?? ''),
			bundle,
			executedTools,
			debug,
			usage: mergeUsage(usage, result.usage),
			compaction,
			thinking: result.thinking,
			finishReason: result.finishReason,
			judgeDebug,
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

	/**
	 * 思考型模型只输出思考、无正文时重试一次：追加「正文必填」系统提示后重新请求。
	 * 重试仍为思考型空回复（或请求失败）时返回 null，由调用方保留原结果。
	 */
	private async retryThinkingOnly(
		messages: ReadonlyArray<ChatMessage>,
		config: LlmConfig,
		options: GenerateReplyOptions,
		signal?: AbortSignal
	): Promise<LlmChatResult | null> {
		const retryMessages: ChatMessage[] = [
			...messages,
			{ role: 'system', content: THINKING_ONLY_NUDGE }
		];
		try {
			const result =
				options.tools !== undefined &&
				options.tools.length > 0 &&
				options.toolContext !== undefined &&
				this.client.chatWithTools !== undefined
					? await this.client.chatWithTools(
							retryMessages,
							options.tools,
							config,
							signal,
							options.onDelta
						)
					: await this.client.chat(retryMessages, config, signal, options.onDelta);
			return result.toolCalls.length > 0 ||
				(result.content !== null && result.content.trim() !== '')
				? result
				: null;
		} catch {
			return null;
		}
	}

	/**
	 * 思考型空回复的最后一档兜底：去掉工具声明并以非流式重新请求，
	 * 让模型只输出正文（DeepSeek V4 思考模式在工具声明下偶发「思考完就收工」）。
	 */
	private async retryPlainText(
		messages: ReadonlyArray<ChatMessage>,
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmChatResult | null> {
		const retryMessages: ChatMessage[] = [
			...messages,
			{ role: 'system', content: THINKING_ONLY_NUDGE }
		];
		try {
			const result = await this.client.chat(retryMessages, { ...config, stream: false }, signal);
			return result.content !== null && result.content.trim() !== '' ? result : null;
		} catch {
			return null;
		}
	}

	/**
	 * 思考里提到工具名却漏发 tool_calls 时，追加「补发调用」提示重试一次
	 * （对齐 opencode 等 agent 的「调用失败会重新调用」行为）。
	 * 重试产出工具调用或正文即采用，否则返回 null 由调用方兜底。
	 */
	private async retryPlannedTool(
		messages: ReadonlyArray<ChatMessage>,
		tool: string,
		config: LlmConfig,
		options: GenerateReplyOptions,
		signal?: AbortSignal
	): Promise<LlmChatResult | null> {
		const retryMessages: ChatMessage[] = [
			...messages,
			{
				role: 'system',
				content:
					`【系统提示】你上一轮思考中提到了要调用 ${tool}，但回复里没有对应的 tool_calls。` +
					`如果你确实需要调用，请立即发出 ${tool} 的 tool_calls（带完整参数）；` +
					'如果不需要调用，请直接输出正文。'
			}
		];
		const attempt = async (
			forceToolCall: boolean,
			stream: boolean
		): Promise<LlmChatResult | null> => {
			if (
				this.client.chatWithTools === undefined ||
				options.tools === undefined ||
				options.tools.length === 0 ||
				options.toolContext === undefined
			) {
				return null;
			}
			try {
				return await this.client.chatWithTools(
					retryMessages,
					options.tools,
					{ ...config, stream },
					signal,
					options.onDelta,
					{ forceToolCall }
				);
			} catch {
				return null;
			}
		};
		// 第一档：提示 + 常规流式；第二档：tool_choice=required + 非流式
		// （部分代理只在流式转发时丢失 tool_calls，非流式可绕开）。
		// 只采纳真正发出 tool_calls 的结果，避免「只说不做」的正文被当作成功。
		const first = await attempt(false, config.stream === true);
		if (first && first.toolCalls.length > 0) {
			return first;
		}
		const forced = await attempt(true, false);
		return forced && forced.toolCalls.length > 0 ? forced : null;
	}

	/**
	 * 正文描述了时间流逝但未调用 advance_time 时的补调重试：
	 * 第一档追加「必须调用 advance_time」提示；仍不调用则第二档用
	 * tool_choice=required 强制模型至少发一个工具调用（端点不支持时自动回退）。
	 * 只有重试真正发出 tool_calls 才采用，避免采纳“只说不做”的正文。
	 */
	private async retryTimeClaim(
		messages: ReadonlyArray<ChatMessage>,
		config: LlmConfig,
		options: GenerateReplyOptions,
		signal?: AbortSignal
	): Promise<LlmChatResult | null> {
		const retryMessages: ChatMessage[] = [
			...messages,
			{ role: 'system', content: TIME_CLAIM_NUDGE }
		];
		const attempt = async (
			forceToolCall: boolean,
			stream: boolean
		): Promise<LlmChatResult | null> => {
			if (
				this.client.chatWithTools === undefined ||
				options.tools === undefined ||
				options.tools.length === 0 ||
				options.toolContext === undefined
			) {
				return null;
			}
			try {
				return await this.client.chatWithTools(
					retryMessages,
					options.tools,
					{ ...config, stream },
					signal,
					options.onDelta,
					{ forceToolCall }
				);
			} catch {
				return null;
			}
		};
		const first = await attempt(false, config.stream === true);
		if (first && first.toolCalls.length > 0) {
			return first;
		}
		const forced = await attempt(true, false);
		return forced && forced.toolCalls.length > 0 ? forced : null;
	}

	/**
	 * LLM 状态确认：主回复未调用工具时，由独立 LLM 判断剧情是否需要更新状态；
	 * 需要则运行确认工具循环补执行，并把工具反馈作为轮次返回（由上层持久化）。
	 */
	private async maybeRunStateJudge(
		input: ContextPipelineInput,
		config: LlmConfig,
		options: GenerateReplyOptions,
		signal?: AbortSignal,
		currentResult?: LlmChatResult,
		nativeToolsExecuted = false
	): Promise<{
		executed: ExecutedToolCall[];
		rounds: ReplyRound[];
		debug: JudgeDebugView | null;
	}> {
		if (
			options.enableStateJudge !== true ||
			// 原生 AI 在本请求中已执行过工具（哪怕只是第一段调用了工具）：
			// 后续任何输出都绝不再让 LLM 判断介入，避免二次执行/吞句。
			nativeToolsExecuted ||
			options.toolContext === undefined ||
			options.tools === undefined ||
			options.tools.length === 0 ||
			this.client.chatWithTools === undefined
		) {
			return { executed: [], rounds: [], debug: null };
		}
		const conversation = input.conversation;
		const lastUser = [...conversation].reverse().find((message) => message.role === 'user');
		// 判断/确认必须基于「本次刚生成的回复」，而不是会话里上一条历史回复
		// （否则会出现【角色最近回复】是上一轮内容、导致误判/重复执行）。
		const currentAssistant: ChatMessageView | undefined =
			currentResult === undefined
				? undefined
				: {
						id: 'current-reply',
						role: 'assistant',
						content: currentResult.content ?? '',
						timestamp: Date.now(),
						...(currentResult.thinking !== undefined && currentResult.thinking.trim() !== ''
							? { thinking: currentResult.thinking }
							: {})
					};
		const judge = await runStateJudge({
			state: input.state,
			lastUser,
			lastAssistant: currentAssistant,
			client: this.client,
			config,
			signal
		});
		if (!judge.needsTool) {
			return { executed: [], rounds: [], debug: judge.debug };
		}
		const confirmation = await runStateConfirmation({
			state: input.state,
			lastUser,
			lastAssistant: currentAssistant,
			client: this.client,
			config,
			tools: options.tools,
			toolContext: options.toolContext,
			signal
		});
		const debug: JudgeDebugView = {
			...judge.debug,
			confirmation: {
				messages: confirmation.messages,
				toolCalls: confirmation.toolCalls,
				executed: confirmation.executed
			}
		};
		const rounds: ReplyRound[] =
			confirmation.executed.length > 0
				? [
						{
							content: null,
							tools: confirmation.executed.map((tool) => ({
								name: tool.name,
								output: tool.output
							}))
						}
					]
				: [];
		return { executed: confirmation.executed, rounds, debug };
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

/** 判断是否为「只输出思考、没有正文与工具调用」的空回复。 */
function isThinkingOnlyReply(result: LlmChatResult): boolean {
	return (
		result.toolCalls.length === 0 &&
		(result.content === null || result.content.trim() === '') &&
		result.thinking !== undefined &&
		result.thinking.trim() !== ''
	);
}

/** 从思考中识别「明确提到要调用」的工具名；未提到返回 null。 */
function detectPlannedTool(thinking: string | undefined): string | null {
	if (thinking === undefined || thinking.trim() === '') {
		return null;
	}
	for (const name of ['advance_time', 'goto_location', 'set_outfit', 'set_attribute']) {
		if (new RegExp(`\\b${name}\\b`).test(thinking)) {
			return name;
		}
	}
	return null;
}

/**
 * 从 assistant 正文中识别「描述了时间流逝/推进到具体时刻」的措辞
 * （与 advance_time 强相关）；只匹配具体时间/时长声明，避免把
 * 「时间过得真快」这类闲聊误判为必须推进时间。
 */
function detectTimeClaim(content: string): boolean {
	return TIME_CLAIM_PATTERNS.some((pattern) => pattern.test(content));
}

/** 阿拉伯数字或中文数字（两/半 等）。 */
const CN_NUM = '(?:\\d+|[一二两三四五六七八九十半]+)';

const TIME_CLAIM_PATTERNS: readonly RegExp[] = [
	/过了一段时间|过了一会儿|过了(?:很久|好久|许久|一阵子)/,
	/已经(?:是)?(?:下午|傍晚|晚上|入夜|深夜|凌晨|中午|黄昏|天黑)/,
	/天(?:色)?(?:已经|已)?(?:黑|暗)(?:下来)?了?/,
	new RegExp(`(?:过了|已经过去|过去)${CN_NUM}\\s*个?(?:分钟|小时|钟头)`),
	new RegExp(`${CN_NUM}\\s*个?(?:分钟|小时|钟头)(?:后|过去|前)`),
	/时间(?:已经)?(?:推进|流逝|过去)(?:了|到)/,
	/时间(?:来到|到了)/,
	/已经(?:是)?\s*\d{1,2}\s*点/,
	/已经\s*\d{1,2}[:：]\d{2}/
];

/** 中文数字 -> 数值（用于时长推断）。 */
const CN_DIGITS: Record<string, number> = {
	一: 1,
	二: 2,
	两: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
	十: 10,
	半: 0.5
};

/** 时段 -> 目标小时（用于「推进到傍晚/深夜」的推断）。 */
const TIME_OF_DAY_TARGET: Record<string, number> = {
	傍晚: 18,
	黄昏: 18,
	天黑: 18,
	天暗: 18,
	晚上: 19,
	入夜: 19,
	深夜: 23,
	中午: 12
};

/**
 * 从模型文本中解析可确定的 advance_time 分钟数（宿主侧推断，最后兜底用）：
 * 1) 明确时长（过了两小时 / 半小时 / 90 分钟）；
 * 2) 明确目标时刻（推进到 18:00）；
 * 3) 明确时段目标（推进到傍晚 / 深夜）——仅当 allowTodFallback 为真
 *    （调用方已确认存在明确推进意图）时启用，降低误判风险。
 * 只返回向前推进且可确定的值；无法确定返回 null（不猜测）。
 */
export function resolveTimeAdvance(
	text: string,
	now: WorldTime,
	allowTodFallback = false
): number | null {
	const duration = text.match(
		/(?:过了|已经过去|过去|推进)?\s*(?:(\d+(?:\.\d+)?)|([一二两三四五六七八九十半]+))\s*个?(分钟|小时|钟头)/
	);
	if (duration) {
		const raw = duration[1] !== undefined ? Number(duration[1]) : cnToNumber(duration[2] ?? '');
		if (Number.isFinite(raw) && raw > 0) {
			const unit = duration[3];
			return unit === '分钟' ? Math.round(raw) : Math.round(raw * 60);
		}
	}
	// 遍历所有目标时刻匹配，取第一个「正向推进」的目标：
	// 「推进到17:10」这类陈述当前时间的表述 delta=0 会被跳过，
	// 避免挡住后面的真正目标（「比如18:30」）。
	const clockPattern = /(?:推进到|来到|时间(?:到|来到)|比如|约|大概)\s*(\d{1,2})[:：](\d{2})/g;
	for (const match of text.matchAll(clockPattern)) {
		const target = Number(match[1]) * 60 + Number(match[2]);
		const delta = target - minutesSinceMidnight(now);
		if (delta > 0) {
			return delta;
		}
	}
	if (!allowTodFallback) {
		return null;
	}
	const nowMinutes = minutesSinceMidnight(now);
	for (const [keyword, hour] of Object.entries(TIME_OF_DAY_TARGET)) {
		if (text.includes(keyword)) {
			const delta = hour * 60 - nowMinutes;
			return delta > 0 ? delta : null;
		}
	}
	return null;
}

/** 中文数字串转数值（仅支持个位、十、半的简单组合）。 */
function cnToNumber(value: string): number {
	if (value === '半') {
		return 0.5;
	}
	let total = 0;
	for (const char of value) {
		const digit = CN_DIGITS[char];
		if (digit === undefined) {
			return NaN;
		}
		total += digit;
	}
	return total;
}

/** 生成最近一次响应的诊断摘要（空正文排查用）。 */
function buildLastResponse(result: LlmChatResult): DebugLastResponse {
	return {
		finishReason: result.finishReason,
		hasContent: result.content !== null && result.content.trim() !== '',
		hasToolCalls: result.toolCalls.length > 0,
		thinkingChars: result.thinking?.trim().length ?? 0
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
