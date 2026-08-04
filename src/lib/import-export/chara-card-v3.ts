import { ImportError } from '../core/errors';
import type { CharacterAttributes, ChatMessageView, WorldInfoEntry } from '../core/types';
import { newId } from '../utils/id';

/** SillyTavern V3 角色卡规范版本。 */
export const CHARA_CARD_SPEC = 'chara_card_v3';

/** V3 角色卡根结构。 */
export interface CharaCardV3 {
	spec: string;
	spec_version: string;
	data: CharaCardV3Data;
}

/** V3 角色卡 data 字段（只声明本任务用到的子集）。 */
export interface CharaCardV3Data {
	name: string;
	description?: string;
	personality?: string;
	scenario?: string;
	first_mes?: string;
	mes_example?: string;
	creator_notes?: string;
	system_prompt?: string;
	post_history_instructions?: string;
	alternate_greetings?: string[];
	character_book?: CharaCardV3Book;
	tags?: string[];
	creator?: string;
	character_version?: string;
	extensions?: Record<string, unknown>;
}

/** V3 角色卡世界书结构。 */
export interface CharaCardV3Book {
	name?: string;
	description?: string;
	entries: CharaCardV3BookEntry[];
}

/** V3 角色卡世界书条目。 */
export interface CharaCardV3BookEntry {
	keys: string[];
	content: string;
	comment?: string;
	constant?: boolean;
	selective?: boolean;
	insertion_order?: number;
	enabled?: boolean;
}

/** 导入映射结果：状态补丁 + 世界信息 + 问候语 + 系统提示。 */
export interface ImportedCharacter {
	statePatch: { attributes: CharacterAttributes };
	worldInfo: WorldInfoEntry[];
	greeting: string | null;
	systemPrompt: string | null;
}

/** 导出角色卡所需的输入。 */
export interface ExportCharacterInput {
	name: string;
	systemPrompt: string | null;
	worldInfo: WorldInfoEntry[];
	conversation: ChatMessageView[];
	creator?: string;
	characterVersion?: string;
	tags?: string[];
}

function createEntry(
	keys: string[],
	content: string,
	comment: string,
	priority: number,
	enabled = true
): WorldInfoEntry {
	return { id: newId(), keys, content, comment, priority, enabled };
}

/** 解析并校验 V3 角色卡 JSON 文本，非法输入抛 ImportError。 */
export function parseCharaCard(jsonText: string): CharaCardV3 {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		throw new ImportError(
			`角色卡 JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}`
		);
	}
	if (parsed === null || typeof parsed !== 'object') {
		throw new ImportError('角色卡必须是 JSON 对象');
	}
	const card = parsed as Partial<CharaCardV3>;
	if (card.spec !== CHARA_CARD_SPEC) {
		throw new ImportError(`仅支持 spec=chara_card_v3 的角色卡，收到：${String(card.spec)}`);
	}
	if (card.data === null || typeof card.data !== 'object' || typeof card.data.name !== 'string') {
		throw new ImportError('角色卡缺少 data.name 字段');
	}
	return card as CharaCardV3;
}

/**
 * 把 V3 角色卡映射为 CosBox 可导入的数据。
 * 映射规则见 DECISIONS.md；核心思路：文本型设定进入世界信息，name 进入属性。
 */
export function mapCardToCosBox(card: CharaCardV3): ImportedCharacter {
	const { data } = card;
	const attributes: CharacterAttributes = { name: data.name };
	if (data.tags && data.tags.length > 0) {
		attributes.tags = data.tags.join(',');
	}
	if (data.creator) {
		attributes.creator = data.creator;
	}
	if (data.character_version) {
		attributes.character_version = data.character_version;
	}

	const worldInfo: WorldInfoEntry[] = [];
	if (data.description?.trim()) {
		worldInfo.push(createEntry([data.name], data.description, '角色背景', 100));
	}
	if (data.personality?.trim()) {
		worldInfo.push(createEntry([data.name, '性格'], data.personality, '性格', 90));
	}
	if (data.scenario?.trim()) {
		worldInfo.push(createEntry(['场景', data.name], data.scenario, '场景设定', 80));
	}
	for (const entry of data.character_book?.entries ?? []) {
		worldInfo.push({
			id: newId(),
			keys: [...entry.keys],
			content: entry.content,
			comment: entry.comment,
			priority: entry.insertion_order ?? 50,
			enabled: entry.enabled ?? !entry.constant
		});
	}

	const greeting = data.first_mes ?? data.alternate_greetings?.[0] ?? null;
	return {
		statePatch: { attributes },
		worldInfo,
		greeting: greeting?.trim() || null,
		systemPrompt: data.system_prompt?.trim() || null
	};
}

/**
 * 把 CosBox 当前内容序列化为 V3 角色卡。
 * 世界信息通过 comment 标签反向映射回 description/personality/scenario。
 */
export function buildCharaCardV3(input: ExportCharacterInput): CharaCardV3 {
	const byComment = new Map<string, string>();
	const bookEntries: CharaCardV3BookEntry[] = [];
	for (const entry of input.worldInfo) {
		const comment = entry.comment ?? '';
		if (comment === '角色背景' || comment === '性格' || comment === '场景设定') {
			byComment.set(comment, entry.content);
			continue;
		}
		bookEntries.push({
			keys: [...entry.keys],
			content: entry.content,
			comment: comment || undefined,
			enabled: entry.enabled,
			insertion_order: entry.priority
		});
	}

	const data: CharaCardV3Data = {
		name: input.name,
		description: byComment.get('角色背景'),
		personality: byComment.get('性格'),
		scenario: byComment.get('场景设定'),
		system_prompt: input.systemPrompt ?? undefined,
		tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
		creator: input.creator,
		character_version: input.characterVersion,
		first_mes: firstAssistantMessage(input.conversation),
		character_book: bookEntries.length > 0 ? { entries: bookEntries } : undefined
	};

	return { spec: CHARA_CARD_SPEC, spec_version: '3.0', data };
}

/** 取第一条 assistant 消息作为 first_mes（问候语）。 */
function firstAssistantMessage(conversation: ChatMessageView[]): string | undefined {
	const first = conversation.find((message) => message.role === 'assistant');
	return first?.content;
}

/** 序列化为格式化 JSON 文本。 */
export function serializeCharaCard(card: CharaCardV3): string {
	return JSON.stringify(card, null, 2);
}
