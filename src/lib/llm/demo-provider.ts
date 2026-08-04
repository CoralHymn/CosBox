import { truncate } from '../utils/format';
import type { ChatMessage, LlmClient, LlmConfig } from './types';

/**
 * 内置离线演示 LLM：无需网络即可体验完整链路。
 * 回应由系统消息中的状态摘要推导，保证确定性（e2e 可断言）。
 */
export class DemoLlmClient implements LlmClient {
	/** 模拟 250ms 延迟后返回演示回应；支持 AbortSignal 取消。 */
	async chat(messages: ChatMessage[], _config: LlmConfig, signal?: AbortSignal): Promise<string> {
		await delay(250, signal);
		return buildDemoReply(messages);
	}
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		if (signal) {
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});
}

/** 从系统消息中提取以 label 开头的行内容。 */
export function extractLine(systemMessage: string, label: string): string | null {
	for (const line of systemMessage.split('\n')) {
		if (line.startsWith(label)) {
			return line.slice(label.length).trim() || null;
		}
	}
	return null;
}

/**
 * 生成确定性演示回应。
 * 依据最后一条用户消息的关键词与系统消息中的状态摘要，返回不同话术。
 */
export function buildDemoReply(messages: ChatMessage[]): string {
	const system = messages.find((message) => message.role === 'system')?.content ?? '';
	const lastUser = [...messages].reverse().find((message) => message.role === 'user');
	const text = lastUser?.content ?? '';

	if (/时间|几点|什么时候|几点了/.test(text)) {
		const time = extractLine(system, '时间：') ?? '现在';
		return `（演示模式回应）现在${time}。你要来找我吗？`;
	}
	if (/哪里|在哪|位置|地点/.test(text)) {
		const location = extractLine(system, '地点：') ?? '老地方';
		return `（演示模式回应）我正在${location}，过来找我吧。`;
	}
	if (/穿|衣服|服装|打扮/.test(text)) {
		const outfit = extractLine(system, '穿着：') ?? '平时那套';
		return `（演示模式回应）我今天穿着${outfit}。好看吗？`;
	}
	return `（演示模式回应）嗯，我在听。你说「${truncate(text, 24)}」——接着说吧。`;
}
