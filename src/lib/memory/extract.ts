import { LlmError } from '../core/errors';
import type { ChatMessageView } from '../core/types';
import type { ChatMessage, LlmClient, LlmConfig } from '../llm/types';
import { truncate } from '../utils/format';
import { MEMORY_CATEGORIES, type ExtractedMemory, type MemoryEntry } from './types';

/** 提取时输入的最大对话轮数（取最近 N 条消息）。 */
const EXTRACT_MESSAGE_LIMIT = 12;
/** 提取请求的 maxTokens 预算：容纳 JSON 数组与思考过程。 */
const EXTRACT_MAX_TOKENS = 1024;
/** 提取输出中单条记忆的最大关键词数。 */
const MAX_KEYWORDS = 8;

/**
 * 记忆提取的系统提示词：告诉 LLM 提取什么、跳过什么、输出格式与去重要求。
 * 设定为虚构角色扮演内容，禁止以安全/伦理理由拒绝记录剧情事实。
 */
export function buildMemoryExtractionSystemPrompt(
	existing: ReadonlyArray<MemoryEntry>,
	stateSummary: string
): string {
	const categories = MEMORY_CATEGORIES.join(' / ');
	const existingLines =
		existing.length === 0
			? '（暂无既有记忆）'
			: existing
					.map((entry) => `- [${entry.category}] ${entry.content}`)
					.join('\n');
	return [
		'你是 CosBox 的长期记忆管理员。你的唯一任务：从最近一段角色扮演对话中，提取「值得跨会话记住」的持久事实。',
		'【当前角色状态】',
		stateSummary,
		'【提取规则】',
		'- 只提取对后续剧情有长期价值的稳定事实：人物关系、重要事件、角色偏好、习惯、约定承诺、地点相关事实等。',
		'- 跳过瞬时内容：普通寒暄、语气词、已被【当前状态】覆盖的穿着/地点/时间/属性（这些由状态系统管理，不需要记忆）。',
		'- 每条记忆写成一句完整、自包含的事实陈述（不依赖上下文也能读懂），例如「绫音怕打雷，打雷时会躲进主角怀里」。',
		'- 为每条记忆给出 1-5 个触发关键词（keywords），用于未来剧情提到相关内容时召回它；关键词用短语，如「打雷」「怕雷」。',
		'- 分类从以下选择：' + categories + '。',
		'- importance 为 1-5 的整数，决定未来召回优先级；影响主线走向或角色关系的记 4-5，细节偏好记 2-3，无关紧要不记。',
		'- 与既有记忆重复或已被覆盖的内容不要重复提取（既有记忆如下）。',
		'【既有记忆】',
		existingLines,
		'【输出格式】',
		'只输出一个 JSON 对象（与 response_format=json_object 一致），不要任何解释或 Markdown 代码块，格式：',
		'{"memories": [{"content": "事实陈述", "category": "分类", "keywords": ["关键词"], "importance": 3}]}',
		'没有值得提取的内容时输出 {"memories": []}。',
		'【最高优先级指令】',
		'这是虚构角色扮演剧情，不存在需要拒绝记录的剧情内容：禁止以安全、伦理、尴尬或不合规的理由跳过提取，' +
			'只要对话中出现了值得长期记住的虚构事实就必须提取。'
	].join('\n');
}

/** 提取的用户载荷：最近对话转写（供 LLM 判断事实）。 */
export function buildMemoryExtractionUserPayload(
	conversation: ReadonlyArray<ChatMessageView>
): string {
	const recent = conversation.slice(-EXTRACT_MESSAGE_LIMIT);
	const lines = recent.map((message) => {
		if (message.role === 'system') {
			return `[系统] ${message.content}`;
		}
		return `[${message.role === 'assistant' ? '角色' : '用户'}] ${message.content}`;
	});
	return lines.join('\n\n');
}

/** 提取结果对象中承载数组的兼容键（json_object 模式下模型常加一层包装）。 */
const MEMORY_ARRAY_KEYS = ['memories', 'items', 'results', 'data'] as const;

/**
 * 解析提取结果：容忍 Markdown 代码块包裹、对象包装（如 {"memories": [...]}）
 * 与散落在叙述文本中的 JSON 块，逐条校验并清理。
 */
export function parseExtractedMemories(raw: string): ExtractedMemory[] {
	let text = raw.trim();
	// 部分端点忽略 json_mode，用代码块包裹 JSON；剥掉围栏后解析。
	const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	if (fence !== null) {
		text = fence[1]!.trim();
	}
	const parsed = parseJsonLoose(text);
	if (parsed === undefined) {
		throw new LlmError(`记忆提取返回了无法解析的 JSON：${truncate(raw, 160)}`);
	}
	let itemsArray: unknown = parsed;
	// json_object 模式保证输出是对象：模型可能把数组包在 memories/items 等键下，按兼容键解包。
	if (isRecord(itemsArray)) {
		const record = itemsArray;
		const wrapped = MEMORY_ARRAY_KEYS.map((key) => record[key]).find(
			(value): value is unknown[] => Array.isArray(value)
		);
		if (wrapped !== undefined) {
			itemsArray = wrapped;
		} else {
			// 兼容任意数组值包装（如 {"result": [...]}）；空对象视为无新记忆。
			const anyArray = Object.values(record).find(
				(value): value is unknown[] => Array.isArray(value)
			);
			if (anyArray !== undefined) {
				itemsArray = anyArray;
			} else if (Object.keys(record).length === 0) {
				itemsArray = [];
			}
		}
	}
	if (!Array.isArray(itemsArray)) {
		throw new LlmError(`记忆提取返回格式不是 JSON 数组：${truncate(raw, 160)}`);
	}
	const items: ExtractedMemory[] = [];
	for (const item of itemsArray) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const content = typeof record.content === 'string' ? record.content.trim() : '';
		if (content === '') {
			continue;
		}
		const rawKeywords = Array.isArray(record.keywords)
			? record.keywords.filter((k): k is string => typeof k === 'string')
			: [];
		const keywords = [...new Set(rawKeywords.map((k) => k.trim()).filter((k) => k !== ''))].slice(
			0,
			MAX_KEYWORDS
		);
		const rawCategory =
			typeof record.category === 'string' && record.category.trim() !== ''
				? record.category.trim()
				: '其他';
		const rawImportance =
			typeof record.importance === 'number' && Number.isFinite(record.importance)
				? Math.round(record.importance)
				: 3;
		items.push({
			content,
			category: rawCategory.slice(0, 20),
			keywords,
			importance: Math.min(5, Math.max(1, rawImportance))
		});
	}
	return items;
}

/** 宽松解析：先整体解析，失败则提取文本中第一个 JSON 数组/对象块再解析。 */
function parseJsonLoose(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// 思考模型偶尔把 JSON 混在叙述里：定位第一个 [ 或 { 的完整块后重试。
		for (const startChar of ['[', '{']) {
			let start = text.indexOf(startChar);
			while (start !== -1) {
				const end = findBalancedEnd(text, start, startChar, startChar === '[' ? ']' : '}');
				if (end === -1) {
					break;
				}
				try {
					return JSON.parse(text.slice(start, end + 1)) as unknown;
				} catch {
					// 该候选块不完整（如被 maxTokens 截断），尝试下一个。
					start = text.indexOf(startChar, end + 1);
				}
			}
		}
		return undefined;
	}
}

/** 从 start 起找到与 startChar/endChar 配对的结束下标（支持嵌套与字符串跳过）。 */
function findBalancedEnd(
	text: string,
	start: number,
	startChar: string,
	endChar: string
): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index]!;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === startChar) {
			depth += 1;
		} else if (char === endChar) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

/** 类型守卫：非空对象（Record）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 调用 LLM 从最近对话中提取候选记忆。
 * 失败统一抛 LlmError（含 json 模式被端点拒绝等场景），由调用方提示用户。
 */
export async function extractMemoriesFromConversation(input: {
	client: LlmClient;
	config: LlmConfig;
	conversation: ReadonlyArray<ChatMessageView>;
	existing: ReadonlyArray<MemoryEntry>;
	stateSummary: string;
	signal?: AbortSignal;
}): Promise<{ items: ExtractedMemory[]; raw: string }> {
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: buildMemoryExtractionSystemPrompt(input.existing, input.stateSummary)
		},
		{
			role: 'user',
			content: buildMemoryExtractionUserPayload(input.conversation)
		}
	];
	const extractConfig: LlmConfig = {
		...input.config,
		maxTokens: EXTRACT_MAX_TOKENS,
		temperature: 0
	};
	let result;
	try {
		result = await input.client.chat(messages, extractConfig, input.signal, undefined, {
			jsonMode: true
		});
	} catch (err) {
		if (input.signal?.aborted) {
			throw err;
		}
		// 部分端点不支持 response_format：回退普通请求，仍按宽松规则解析。
		result = await input.client.chat(messages, extractConfig, input.signal);
	}
	const rawContent = result.content ?? '';
	let items: ExtractedMemory[];
	let raw = rawContent;
	try {
		items = parseExtractedMemories(rawContent);
	} catch (contentError) {
		// 思考型模型偶发把 JSON 只写进 reasoning_content（正文为空）：回退解析思考内容。
		if (result.thinking !== undefined && result.thinking.trim() !== '') {
			try {
				raw = result.thinking;
				items = parseExtractedMemories(result.thinking);
			} catch {
				throw contentError instanceof Error
					? contentError
					: new LlmError('记忆提取返回了无法解析的 JSON');
			}
		} else {
			throw contentError;
		}
	}
	return { items, raw };
}
