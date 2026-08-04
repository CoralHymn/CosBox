import { buildContext, type ContextBundle, type ContextPipelineInput } from '../context/pipeline';
import type { ChatMessage, LlmClient, LlmConfig } from './types';

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
		signal?: AbortSignal
	): Promise<{ reply: string; bundle: ContextBundle }> {
		const bundle = buildContext(input);
		const messages: ChatMessage[] = [
			{ role: 'system', content: bundle.systemMessage },
			...bundle.messages
		];
		const reply = await this.client.chat(messages, config, signal);
		return { reply, bundle };
	}
}
