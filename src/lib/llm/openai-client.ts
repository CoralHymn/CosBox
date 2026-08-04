import { LlmError } from '../core/errors';
import type { ChatMessage, LlmClient, LlmConfig } from './types';

/**
 * OpenAI-compatible Chat Completions 客户端。
 * 通过原生 fetch 调用任意兼容端点（LiteLLM Proxy、vLLM、Ollama 等均可）。
 */
export class OpenAiCompatibleClient implements LlmClient {
	/** 发送对话并返回 assistant 文本。失败统一抛 LlmError。 */
	async chat(messages: ChatMessage[], config: LlmConfig, signal?: AbortSignal): Promise<string> {
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
				body: JSON.stringify({
					model: config.model,
					messages,
					temperature: config.temperature,
					max_tokens: config.maxTokens
				}),
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
		if (content === null) {
			throw new LlmError('模型响应缺少 choices[0].message.content');
		}
		return content;
	}
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

/** 类型守卫：非空对象（Record）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
