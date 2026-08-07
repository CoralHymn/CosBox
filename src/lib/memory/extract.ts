import { LlmError } from '../core/errors';
import type { ChatMessageView } from '../core/types';
import type { ChatMessage, LlmClient, LlmConfig } from '../llm/types';
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
		'只输出一个 JSON 数组，不要任何解释或 Markdown 代码块，格式：',
		'[{"content": "事实陈述", "category": "分类", "keywords": ["关键词"], "importance": 3}]',
		'没有值得提取的内容时输出 []。',
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

/** 解析提取结果：容忍 Markdown 代码块包裹，逐条校验并清理。 */
export function parseExtractedMemories(raw: string): ExtractedMemory[] {
	let text = raw.trim();
	// 部分端点忽略 json_mode，用代码块包裹 JSON；剥掉围栏后解析。
	const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	if (fence !== null) {
		text = fence[1]!.trim();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new LlmError('记忆提取返回了无法解析的 JSON');
	}
	if (!Array.isArray(parsed)) {
		throw new LlmError('记忆提取返回格式不是 JSON 数组');
	}
	const items: ExtractedMemory[] = [];
	for (const item of parsed) {
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
	const result = await input.client.chat(messages, {
		...input.config,
		maxTokens: EXTRACT_MAX_TOKENS,
		temperature: 0
	}, input.signal, undefined, { jsonMode: true });
	const raw = result.content ?? '';
	return { items: parseExtractedMemories(raw), raw };
}
