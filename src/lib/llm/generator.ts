import { CLOTHING_KINDS } from '../core/state';
import { LlmError } from '../core/errors';
import type { ClothingItem, ConfigPatch, LocationDef, ScheduleEntry } from '../core/types';
import { newId } from '../utils/id';
import type { ChatMessage, LlmClient, LlmConfig, StateToolSchema } from './types';

/** AI 生成的目标类型。 */
export type GeneratorKind = 'locations' | 'wardrobe' | 'schedule';
/** 世界观预设。 */
export type WorldviewPreset = 'modern' | 'ancient' | 'fantasy';

/** 生成条目：地点 / 衣物 / 日程（生成阶段 id 可缺省，导入时补全）。 */
export type GeneratedItem = LocationDef | ClothingItem | ScheduleEntry;

/** 一次生成请求。 */
export interface GenerationRequest {
	kind: GeneratorKind;
	worldview: WorldviewPreset;
	/** 仅衣柜生成：性别约束（默认 女/男，可自定义）。 */
	gender?: string;
	/** 用户对生成内容的要求。 */
	requirements: string;
}

/** 生成结果：条目 + 审查问题 + 模型原文。 */
export interface GenerationResult {
	kind: GeneratorKind;
	items: GeneratedItem[];
	/** 审查工具给出的问题；为空 = 全部通过。 */
	issues: string[];
	raw: string;
}

/** 生成任务的中文标签。 */
export const KIND_LABELS: Record<GeneratorKind, string> = {
	locations: '地点库',
	wardrobe: '衣柜',
	schedule: '日程表'
};

/** 世界观预设：规则描述 + 禁词（确保古代/奇幻不会出现现代建筑）。 */
export const WORLDVIEW_PRESETS: Record<
	WorldviewPreset,
	{ label: string; rules: string; bannedKeywords: string[] }
> = {
	modern: {
		label: '现代',
		rules:
			'现代都市学园设定：允许日常现代设施（教室、食堂、图书馆、便利店、地铁站、医院、商场等），科技水平与当代一致。',
		bannedKeywords: []
	},
	ancient: {
		label: '古代',
		rules:
			'古代学宫设定：只允许古代建筑与设施（书院、私塾、药铺、茶馆、马厩、城墙、集市、庙宇、练武场等），禁止任何现代科技或现代建筑。',
		bannedKeywords: [
			'机场',
			'汽车',
			'高铁',
			'飞机',
			'手机',
			'电脑',
			'互联网',
			'电灯',
			'商场',
			'地铁',
			'便利店',
			'医院',
			'电梯'
		]
	},
	fantasy: {
		label: '奇幻',
		rules:
			'奇幻魔法世界设定：允许魔法与奇幻设施（魔法学院、炼金室、图书馆、冒险者公会、龙穴、精灵森林、地下城等），禁止现代科技。',
		bannedKeywords: ['手机', '电脑', '互联网', '汽车', '机场', '高铁', '飞机', '地铁', '电灯']
	}
};

/** 地点大类中不该出现的「场所类型」关键词：应作为具体地点并入区域大类。 */
const LOCATION_TYPE_KEYWORDS = [
	'奶茶店',
	'服饰店',
	'服装店',
	'咖啡厅',
	'咖啡馆',
	'超市',
	'便利店',
	'药店',
	'药房',
	'餐厅',
	'饭店',
	'面包店',
	'书店',
	'健身房',
	'银行',
	'发廊',
	'理发店',
	'网吧',
	'加油站',
	'地铁站',
	'医院',
	'诊所'
];

/** 输出格式示例（按类型）。 */
const SCHEMA_EXAMPLES: Record<GeneratorKind, unknown> = {
	locations: [
		{
			category: '商业街',
			name: '中央商店街',
			description: '贯穿城区的主干商业街，两侧林立着潮流服饰店与奶茶店'
		}
	],
	wardrobe: [
		{
			category: '常服',
			kind: 'top',
			name: '白色衬衫',
			description: '白色棉质衬衫，领口带细蕾丝'
		}
	],
	schedule: [
		{
			day: 0,
			title: '晨会',
			start: '08:00',
			end: '09:00',
			locationId: 'classroom'
		}
	]
};

/** 生成任务的专属系统提示词：任务 + 世界观约束 + 格式 + 审查要求。 */
export function buildGenerationSystemPrompt(request: GenerationRequest): string {
	const worldview = WORLDVIEW_PRESETS[request.worldview];
	const kindLine =
		request.kind === 'locations'
			? '生成一份地点库列表：每个地点包含 category（大类，必须是**区域/地段**，如「学校」「商业街」「市中心」「郊外」「住宅区」，而不是场所类型）、name（该区域内的具体地点名称，如「中央商店街」「阳光生活超市」）、description（一句话描述，用于 AI 认知）。\n同一大类可以包含多个不同性质的场所（如奶茶店、服饰店、咖啡店都属于「商业街」），不要为每个小店铺单独建大类；电影院、博物馆等公共设施应归入「市中心」等区域，沙滩、温泉馆等归入「郊外」。'
			: request.kind === 'wardrobe'
				? `生成一份衣柜（衣物预设）列表：每个衣物包含 category（大类）、kind（类型：${CLOTHING_KINDS.join('/')}）、name（名称）、description（穿上后的描述）。角色性别：${request.gender ?? '不限'}，衣物需符合该性别设定。`
				: '生成一份周期性日程表：每个条目包含 day（0=周一 … 6=周日）、title（活动名）、start（开始时间 "HH:MM"）、end（结束时间 "HH:MM"）、可选 locationId（关联地点 id）。';
	return [
		`【生成任务：${KIND_LABELS[request.kind]}】`,
		kindLine,
		`【世界观：${worldview.label}】${worldview.rules}`,
		`【用户要求】${request.requirements}`,
		'【输出格式】只输出一个 JSON 数组，不要任何解释或 Markdown 代码块，格式如下：',
		JSON.stringify(SCHEMA_EXAMPLES[request.kind], null, 2),
		'【审查要求】生成完成后必须调用 review_generation 工具提交这份列表进行审查；',
		'根据返回的问题修正后再次提交，直到审查通过；审查通过后只输出最终的 JSON 数组。'
	].join('\n');
}

/** 条目唯一键（用于去重与勾选）。 */
export function itemKeyFor(kind: GeneratorKind, item: GeneratedItem): string {
	if (kind === 'locations') {
		return (item as LocationDef).name;
	}
	if (kind === 'wardrobe') {
		return (item as ClothingItem).name;
	}
	return (item as ScheduleEntry).title;
}

/** 把条目数组合并进现有配置（按名称去重，导入时补全 id）。 */
export function buildImportPatch(
	kind: GeneratorKind,
	items: ReadonlyArray<GeneratedItem>,
	existing: ReadonlyArray<GeneratedItem>
): ConfigPatch {
	const names = new Set(existing.map((item) => itemKeyFor(kind, item)));
	const fresh = items
		.filter((item) => !names.has(itemKeyFor(kind, item)))
		.map((item) => withId(kind, item));
	if (kind === 'locations') {
		return { places: [...(existing as LocationDef[]), ...(fresh as LocationDef[])] };
	}
	if (kind === 'wardrobe') {
		return { wardrobe: [...(existing as ClothingItem[]), ...(fresh as ClothingItem[])] };
	}
	return { scheduleEntries: [...(existing as ScheduleEntry[]), ...(fresh as ScheduleEntry[])] };
}

/** 解析模型输出的 JSON 数组；非法条目收集问题并跳过。 */
export function parseGeneratedItems(
	kind: GeneratorKind,
	raw: string
): { items: GeneratedItem[]; issues: string[] } {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { items: [], issues: ['输出不是合法的 JSON'] };
	}
	if (!Array.isArray(data)) {
		return { items: [], issues: ['输出不是 JSON 数组'] };
	}
	const items: GeneratedItem[] = [];
	const issues: string[] = [];
	data.forEach((entry, index) => {
		const normalized = normalizeEntry(kind, entry, index + 1);
		if (normalized.item !== null) {
			items.push(normalized.item);
		}
		issues.push(...normalized.issues);
	});
	return { items, issues };
}

/** 审查生成条目：结构完整性 + 世界观禁词 + 重名。 */
export function reviewGeneratedItems(
	kind: GeneratorKind,
	items: ReadonlyArray<GeneratedItem>,
	worldview: WorldviewPreset
): string[] {
	const issues: string[] = [];
	const banned = WORLDVIEW_PRESETS[worldview].bannedKeywords;
	const seen = new Set<string>();
	items.forEach((item, index) => {
		const normalized = normalizeEntry(kind, item, index + 1);
		issues.push(...normalized.issues);
		if (normalized.item === null) {
			return;
		}
		const key = itemKeyFor(kind, normalized.item);
		if (seen.has(key)) {
			issues.push(`第 ${index + 1} 项名称重复：${key}`);
		}
		seen.add(key);
		if (kind === 'locations') {
			const category = (normalized.item as LocationDef).category;
			const typeKeyword = LOCATION_TYPE_KEYWORDS.find((keyword) => category.includes(keyword));
			if (typeKeyword !== undefined) {
				issues.push(
					`第 ${index + 1} 项的大类「${category}」像是场所类型（${typeKeyword}），请合并进更大的区域大类（如：商业街、市中心、郊外）并把该场所作为具体地点名称`
				);
			}
		}
		const haystack = JSON.stringify(normalized.item);
		for (const keyword of banned) {
			if (haystack.includes(keyword)) {
				issues.push(
					`第 ${index + 1} 项包含现代元素「${keyword}」，与「${WORLDVIEW_PRESETS[worldview].label}」世界观冲突`
				);
				break;
			}
		}
	});
	return issues;
}

/** 审查工具定义（与 chatWithTools 的 schema 兼容）。 */
export interface GenerationReviewTool {
	name: string;
	description: string;
	/** 宽松的 JSON Schema（items 为数组，StateToolSchema 的严格子集不覆盖该类型）。 */
	parameters: {
		type: 'object';
		properties: Record<string, { type: string; description: string }>;
		required: readonly string[];
	};
	execute(args: Record<string, unknown>): {
		items: GeneratedItem[];
		issues: string[];
		output: string;
	};
}

/** 生成审查工具（名称固定为 review_generation，模型按系统提示调用）。 */
export function buildReviewTool(
	kind: GeneratorKind,
	worldview: WorldviewPreset
): GenerationReviewTool {
	return {
		name: 'review_generation',
		description:
			'审查刚生成的内容列表：检查字段是否完整、格式是否正确、是否与世界观约束冲突、是否有遗漏或重复。返回需要修正的问题；无问题表示审查通过。',
		parameters: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					description: `要审查的${KIND_LABELS[kind]}条目列表`
				}
			},
			required: ['items']
		},
		execute(args) {
			const raw = args.items;
			if (!Array.isArray(raw)) {
				return { items: [], issues: ['items 必须是数组'], output: '审查失败：items 必须是数组。' };
			}
			const items: GeneratedItem[] = [];
			raw.forEach((entry, index) => {
				const normalized = normalizeEntry(kind, entry, index + 1);
				if (normalized.item !== null) {
					items.push(normalized.item);
				}
			});
			const issues = reviewGeneratedItems(kind, items, worldview);
			const output =
				issues.length === 0
					? `审查通过：${items.length} 项，格式与世界观约束均符合。`
					: `审查发现 ${issues.length} 个问题：\n${issues.map((issue) => `- ${issue}`).join('\n')}`;
			return { items, issues, output };
		}
	};
}

/** 生成服务：系统提示 + 审查工具循环，返回审查后的条目列表。 */
export class GeneratorService {
	constructor(private readonly client: LlmClient) {}

	async generate(
		request: GenerationRequest,
		config: LlmConfig,
		signal?: AbortSignal
	): Promise<GenerationResult> {
		if (!this.client.chatWithTools) {
			throw new LlmError('当前模型服务不支持工具调用，无法使用 AI 生成');
		}
		const tool = buildReviewTool(request.kind, request.worldview);
		let messages: ChatMessage[] = [
			{ role: 'system', content: buildGenerationSystemPrompt(request) },
			{ role: 'user', content: request.requirements }
		];
		let lastItems: GeneratedItem[] = [];
		let lastIssues: string[] = [];
		let lastRaw = '';
		const maxTurns = 6;
		for (let turn = 0; turn < maxTurns; turn += 1) {
			// 审查工具的 items 参数是数组，超出 StateToolSchema 的严格属性类型，此处按兼容 schema 透传。
			const result = await this.client.chatWithTools(
				messages,
				[tool as unknown as StateToolSchema],
				config,
				signal
			);
			if (result.toolCalls.length > 0) {
				const toolMessages: ChatMessage[] = [];
				for (const call of result.toolCalls) {
					if (call.name === tool.name) {
						const reviewed = tool.execute(call.arguments);
						lastItems = reviewed.items;
						lastIssues = reviewed.issues;
						toolMessages.push({
							role: 'tool',
							content: reviewed.output,
							toolCallId: call.id,
							name: call.name
						});
					} else {
						toolMessages.push({
							role: 'tool',
							content: `未知工具：${call.name}`,
							toolCallId: call.id,
							name: call.name
						});
					}
				}
				messages = [
					...messages,
					{ role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls },
					...toolMessages
				];
				continue;
			}
			lastRaw = result.content ?? '';
			const parsed = parseGeneratedItems(request.kind, lastRaw);
			const issues = reviewGeneratedItems(request.kind, parsed.items, request.worldview);
			if (parsed.items.length > 0) {
				return { kind: request.kind, items: parsed.items, issues, raw: lastRaw };
			}
			messages = [
				...messages,
				{
					role: 'user',
					content: `输出解析失败：${parsed.issues.join('；')}。请只输出符合要求的 JSON 数组，不要任何解释。`
				}
			];
		}
		return {
			kind: request.kind,
			items: lastItems,
			issues: lastIssues.length > 0 ? lastIssues : ['生成未在限定轮数内完成，请重试'],
			raw: lastRaw
		};
	}
}

/** 归一化单个条目：结构校验 + 时间转换 + id 补全。 */
function normalizeEntry(
	kind: GeneratorKind,
	entry: unknown,
	index: number
): { item: GeneratedItem | null; issues: string[] } {
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
		return { item: null, issues: [`第 ${index} 项不是对象`] };
	}
	const record = entry as Record<string, unknown>;
	if (kind === 'locations') {
		const name = typeof record.name === 'string' ? record.name.trim() : '';
		if (name === '') {
			return { item: null, issues: [`第 ${index} 项缺少地点名称`] };
		}
		return {
			item: {
				id: typeof record.id === 'string' && record.id !== '' ? record.id : newId(),
				category: typeof record.category === 'string' ? record.category.trim() : '',
				name,
				description: typeof record.description === 'string' ? record.description.trim() : ''
			},
			issues: []
		};
	}
	if (kind === 'wardrobe') {
		const name = typeof record.name === 'string' ? record.name.trim() : '';
		const rawKind =
			typeof record.kind === 'string' ? (record.kind.trim() as ClothingItem['kind']) : undefined;
		const kindValid = rawKind !== undefined && CLOTHING_KINDS.includes(rawKind);
		if (name === '') {
			return { item: null, issues: [`第 ${index} 项缺少衣物名称`] };
		}
		if (!kindValid) {
			return {
				item: null,
				issues: [
					`第 ${index} 项 kind 非法（${String(record.kind)}），应为：${CLOTHING_KINDS.join('/')}`
				]
			};
		}
		return {
			item: {
				id: typeof record.id === 'string' && record.id !== '' ? record.id : newId(),
				category: typeof record.category === 'string' ? record.category.trim() : '',
				kind: rawKind,
				name,
				description: typeof record.description === 'string' ? record.description.trim() : ''
			},
			issues: []
		};
	}
	const title = typeof record.title === 'string' ? record.title.trim() : '';
	const issues: string[] = [];
	if (title === '') {
		issues.push(`第 ${index} 项缺少活动标题`);
	}
	const day = typeof record.day === 'number' ? Math.floor(record.day) : Number.NaN;
	if (!Number.isInteger(day) || day < 0 || day > 6) {
		issues.push(`第 ${index} 项 day 非法（应为 0-6）`);
	}
	const start = parseMinutesValue(record.start);
	const end = parseMinutesValue(record.end);
	if (start === null || end === null) {
		issues.push(`第 ${index} 项时间格式非法（应为 "HH:MM" 或分钟数）`);
	} else if (start >= end || end > 1440) {
		issues.push(`第 ${index} 项时间段非法（start 必须早于 end，且不超过 24:00）`);
	}
	if (issues.length > 0) {
		return { item: null, issues };
	}
	return {
		item: {
			id: typeof record.id === 'string' && record.id !== '' ? record.id : newId(),
			day,
			start: start!,
			end: end!,
			title,
			...(typeof record.locationId === 'string' && record.locationId !== ''
				? { locationId: record.locationId }
				: {})
		},
		issues: []
	};
}

/** 解析 "HH:MM" 或分钟数；非法返回 null。 */
function parseMinutesValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.floor(value);
	}
	if (typeof value !== 'string') {
		return null;
	}
	const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (match === null) {
		return null;
	}
	const hour = Number.parseInt(match[1]!, 10);
	const minute = Number.parseInt(match[2]!, 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		return null;
	}
	return hour * 60 + minute;
}

/** 为缺失 id 的条目补全 id。 */
function withId(kind: GeneratorKind, item: GeneratedItem): GeneratedItem {
	const copy = { ...item } as Record<string, unknown>;
	if (typeof copy.id !== 'string' || copy.id === '') {
		copy.id = newId();
	}
	return copy as unknown as GeneratedItem;
}
