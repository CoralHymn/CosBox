import { truncate } from '../utils/format';
import type {
	ChatMessage,
	LlmChatResult,
	LlmClient,
	LlmConfig,
	StateToolSchema,
	ToolCall
} from './types';

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

	/**
	 * 演示工具模式：根据用户输入关键词返回确定性的工具调用，
	 * 收到工具结果后返回一句确定性的收尾文本。工具必须在传入列表中，否则忽略。
	 */
	async chatWithTools(
		messages: ChatMessage[],
		tools: readonly StateToolSchema[],
		_config: LlmConfig,
		signal?: AbortSignal
	): Promise<LlmChatResult> {
		await delay(250, signal);
		return buildDemoToolResult(messages, tools);
	}
}

/** 生成演示工具模式的结果：先看工具结果，再看用户输入的触发词。 */
export function buildDemoToolResult(
	messages: ChatMessage[],
	tools: readonly StateToolSchema[]
): LlmChatResult {
	const last = messages[messages.length - 1];
	if (last?.role === 'tool') {
		return { content: buildDemoToolReply(last.content), toolCalls: [] };
	}
	const text = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
	const toolCalls = pickDemoToolCall(text, tools);
	if (toolCalls.length > 0) {
		return { content: null, toolCalls };
	}
	return { content: buildDemoReply(messages), toolCalls: [] };
}

/** 根据用户文本选择确定性的演示工具调用（仅当该工具在列表中）。 */
function pickDemoToolCall(text: string, tools: readonly StateToolSchema[]): ToolCall[] {
	if (/去食堂|食堂/.test(text) && tools.some((tool) => tool.name === 'goto_location')) {
		return [{ id: 'call_demo_goto', name: 'goto_location', arguments: { name: '食堂' } }];
	}
	if (/运动服|换装/.test(text) && tools.some((tool) => tool.name === 'set_outfit')) {
		return [
			{ id: 'call_demo_outfit', name: 'set_outfit', arguments: { slot: 'top', item: '黑色卫衣' } }
		];
	}
	if (/半小时后|时间推进/.test(text) && tools.some((tool) => tool.name === 'advance_time')) {
		return [{ id: 'call_demo_time', name: 'advance_time', arguments: { minutes: 30 } }];
	}
	return [];
}

/** 根据工具结果生成确定性的演示收尾文本。 */
function buildDemoToolReply(output: string): string {
	if (output.includes('已切换地点')) {
		return '（演示模式回应）好，那我们过去吧。';
	}
	if (output.includes('时间推进')) {
		return '（演示模式回应）时间过得真快。';
	}
	if (output.includes('更换为')) {
		return '（演示模式回应）嗯，这套很适合现在。';
	}
	return '（演示模式回应）好的，我知道了。';
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

	if (system.includes('【网络搜索结果】')) {
		const title = extractSearchTitle(system);
		return `（演示模式回应）我查了一下网上的资料：${title ?? '相关内容'}。要我展开讲讲吗？`;
	}
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

/** 从系统消息中提取第一条网络搜索结果的标题。 */
export function extractSearchTitle(systemMessage: string): string | null {
	const lines = systemMessage.split('\n');
	const markerIndex = lines.findIndex((line) => line === '【网络搜索结果】');
	if (markerIndex === -1) {
		return null;
	}
	for (let i = markerIndex + 1; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (line.startsWith('- ')) {
			const title = line.slice(2).split('：')[0]!.trim();
			return title === '' ? null : title;
		}
	}
	return null;
}
