import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../core/state';
import type { ContextPipelineInput } from '../context/pipeline';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import { ChatService } from './chat-service';
import type { ChatMessage, LlmClient, LlmConfig } from './types';

const config: LlmConfig = {
	provider: 'demo',
	providerId: 'custom',
	baseUrl: '',
	apiKey: '',
	model: 'demo',
	temperature: 1,
	maxTokens: 100,
	webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG }
};

describe('ChatService', () => {
	it('组装系统消息并调用客户端，返回回复与上下文包', async () => {
		const client: LlmClient = {
			chat: vi.fn(async (messages: ChatMessage[], passed: LlmConfig) => {
				expect(passed).toBe(config);
				expect(messages[0]!.role).toBe('system');
				expect(messages[0]!.content).toContain('时间：周一 08:00');
				expect(messages[1]!.content).toBe('早上好');
				return '你好呀';
			})
		};
		const service = new ChatService(client);
		const input: ContextPipelineInput = {
			state: createInitialState(),
			conversation: [{ id: '1', role: 'user', content: '早上好', timestamp: 1 }],
			worldInfo: []
		};
		const { reply, bundle } = await service.generateReply(input, config);
		expect(reply).toBe('你好呀');
		expect(bundle.stateSummary).toContain('学院正门');
	});

	it('客户端抛错时原样上抛', async () => {
		const client: LlmClient = {
			chat: vi.fn(async () => Promise.reject(new Error('模型挂了')))
		};
		const service = new ChatService(client);
		await expect(
			service.generateReply(
				{ state: createInitialState(), conversation: [], worldInfo: [] },
				config
			)
		).rejects.toThrow('模型挂了');
	});
});
