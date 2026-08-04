import { buildContext, type ContextBundle, type ContextPipelineInput } from '../context/pipeline';
import {
	executeStateTool,
	type ExecutedToolCall,
	type StateToolContext,
	type StateToolDefinition
} from './state-tools';
import { sumUsage } from './model-info';
import type { ChatMessage, LlmClient, LlmConfig, TokenUsage } from './types';

/** 开发者模式下展示的最近一次请求：完整系统消息 + 实际发送的消息数组。 */
export interface DebugPromptView {
	systemMessage: string;
	messages: ChatMessage[];
}

/** agent 循环的可选参数。 */
export interface GenerateReplyOptions {
	/** 要暴露给模型的状态工具；为空则退化为纯文本对话。 */
	tools?: readonly StateToolDefinition[];
	/** 工具执行上下文（由角色会话提供）。 */
	toolContext?: StateToolContext;
	/** 单轮对话内最多允许的工具调用轮数，防止死循环。 */
	maxToolTurns?: number;
}

/** 默认最大工具轮数：超过后停止并以提示文本收尾。 */
const DEFAULT_MAX_TOOL_TURNS = 4;

/**
 * 对话服务：把「状态 + 历史 + 世界信息」组装为上下文，再调用 LLM。
 * 这是 P2「Context Pipeline 接 LLM」的装配点。
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
	}> {
		let bundle = buildContext(input);
		let messages: ChatMessage[] = [
			{ role: 'system', content: bundle.systemMessage },
			...bundle.messages
		];
		let debug: DebugPromptView = { systemMessage: bundle.systemMessage, messages };
		const executedTools: ExecutedToolCall[] = [];
		let usage: TokenUsage | undefined;

		if (options.tools !== undefined && options.tools.length > 0 && options.toolContext) {
			if (this.client.chatWithTools) {
				const maxTurns = options.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS;
				for (let turn = 0; turn < maxTurns; turn += 1) {
					debug = { systemMessage: messages[0]!.content, messages };
					const result = await this.client.chatWithTools(messages, options.tools, config, signal);
					usage = mergeUsage(usage, result.usage);
					if (result.toolCalls.length === 0) {
						return { reply: result.content ?? '', bundle, executedTools, debug, usage };
					}
					const toolMessages: ChatMessage[] = [];
					for (const call of result.toolCalls) {
						const outcome = await executeStateTool(options.tools, call, options.toolContext);
						executedTools.push(outcome);
						toolMessages.push({
							role: 'tool',
							content: outcome.output,
							toolCallId: call.id,
							name: call.name
						});
					}
					messages = [
						...messages,
						{ role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls },
						...toolMessages
					];
					// 状态工具已产生新快照，重新生成状态摘要，让模型感知最新状态。
					bundle = buildContext({ ...input, state: options.toolContext.getState() });
					messages = [{ role: 'system', content: bundle.systemMessage }, ...messages.slice(1)];
				}
				return {
					reply: '（AI 已连续执行多次状态变更，先暂停。请发送新消息继续。）',
					bundle,
					executedTools,
					debug,
					usage
				};
			}
		}

		const result = await this.client.chat(messages, config, signal);
		return {
			reply: result.content ?? '',
			bundle,
			executedTools,
			debug,
			usage: mergeUsage(usage, result.usage)
		};
	}
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
