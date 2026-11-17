import { addMinutes, formatWorldTime } from '../core/state';
import type {
	CharacterState,
	ClothingItem,
	ClothingKind,
	OutfitSlot,
	OutfitState,
	StatePatch
} from '../core/types';
import { isWardrobeItemHidden, type EditionRules } from '../platform/edition';
import type { StateToolSchema, ToolCall } from './types';

/** 工具执行时访问的角色状态上下文（由 CharacterManager 会话提供）。 */
export interface StateToolContext {
	getState(): CharacterState;
	/** 应用状态补丁并生成快照。 */
	update(patch: StatePatch, metadata: { desc: string }): Promise<unknown>;
	/** 推进世界时间并生成快照。 */
	advanceTime(minutes: number): Promise<unknown>;
}

/** 一次已执行工具调用的记录（供上层反馈与测试断言）。 */
export interface ExecutedToolCall {
	id: string;
	name: string;
	/** 返回给模型的结果文本；失败时以「工具执行失败：」开头。 */
	output: string;
}

/** 工具执行失败时回馈模型的前缀。 */
export const TOOL_ERROR_PREFIX = '工具执行失败：';
/** 模型调用了未注册工具时的回馈前缀。 */
export const TOOL_UNKNOWN_PREFIX = '未知工具：';

/** 工具输出是否为失败结果（气泡错误样式与反馈链路共用同一判定）。 */
export function isToolErrorOutput(output: string): boolean {
	return output.startsWith(TOOL_ERROR_PREFIX) || output.startsWith(TOOL_UNKNOWN_PREFIX);
}

/** 状态工具定义：JSON Schema + 宿主侧执行函数。 */
export interface StateToolDefinition extends StateToolSchema {
	execute(args: Record<string, unknown>, ctx: StateToolContext): Promise<string>;
}

/** 穿着槽位白名单，防止衣物错配到不合适的部位。 */
const OUTFIT_SLOTS: readonly OutfitSlot[] = [
	'headwear',
	'top',
	'underwear',
	'underpants',
	'bottom',
	'socks',
	'shoes'
] as const;

const SLOT_LABELS: Record<OutfitSlot, string> = {
	headwear: '帽子/头饰',
	top: '上衣',
	underwear: '内衣',
	underpants: '内裤',
	bottom: '下装',
	socks: '袜子',
	shoes: '鞋子'
};

/** 工具文案里的短槽位名（与旧版描述保持一致）。 */
const SLOT_SHORT_LABELS: Record<OutfitSlot, string> = {
	headwear: '帽子',
	top: '上衣',
	underwear: '内衣',
	underpants: '内裤',
	bottom: '下装',
	socks: '袜子',
	shoes: '鞋'
};

/** 配饰是列表槽位（可同时佩戴多件），单独处理。 */
const ACCESSORY_SLOT = 'accessory' as const;

/** 中文槽位别名 -> 标准槽位键（模型经常直接传中文）；配饰别名归入列表槽位。 */
const SLOT_ALIASES: Record<string, OutfitSlot | typeof ACCESSORY_SLOT> = {
	帽子: 'headwear',
	头饰: 'headwear',
	'帽子/头饰': 'headwear',
	上衣: 'top',
	上装: 'top',
	内衣: 'underwear',
	内裤: 'underpants',
	下装: 'bottom',
	裙子: 'bottom',
	袜子: 'socks',
	鞋: 'shoes',
	鞋子: 'shoes',
	配饰: 'accessory',
	饰品: 'accessory',
	装饰: 'accessory'
};

/** 视为「脱掉」的 item 值（模型常用文本表达代替 null）。 */
const REMOVE_TOKENS = new Set(['无', '脱', 'null', 'none']);

/** 切换当前地点：locationId 优先匹配地点库，否则用 name 创建（可附 category/description）。 */
export const gotoLocationTool: StateToolDefinition = {
	name: 'goto_location',
	description:
		'切换角色的当前地点（剧情中移动/换场景时必须调用）。name 为地点名称，必填；' +
		'若同时提供 locationId 则优先按地点库 id 精确匹配。地点库外的名称会新建地点，可附 category（大类）与 description。',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: '地点名称（必填），如「教室」「便利店」' },
			locationId: { type: 'string', description: '地点库中的 id；提供时优先按 id 匹配（可选）' },
			category: { type: 'string', description: '地点大类，如「学校」（可选）' },
			description: { type: 'string', description: '地点描述（可选）' }
		},
		required: ['name']
	},
	async execute(args, ctx) {
		const place = ctx.getState().places;
		const locationId = typeof args.locationId === 'string' ? args.locationId.trim() : '';
		const byId = locationId === '' ? undefined : place.find((item) => item.id === locationId);
		if (byId) {
			await ctx.update(
				{
					location: {
						id: byId.id,
						category: byId.category,
						name: byId.name,
						description: byId.description
					}
				},
				{ desc: `AI 切换地点：${byId.category} > ${byId.name}` }
			);
			return `已切换地点到「${byId.category} > ${byId.name}」`;
		}
		const name = typeof args.name === 'string' ? args.name.trim() : '';
		if (name === '') {
			throw new Error('goto_location 需要 locationId 或 name');
		}
		const byName = place.find((item) => item.name === name);
		if (byName) {
			await ctx.update(
				{
					location: {
						id: byName.id,
						category: byName.category,
						name: byName.name,
						description: byName.description
					}
				},
				{ desc: `AI 切换地点：${byName.category} > ${byName.name}` }
			);
			return `已切换地点到「${byName.category} > ${byName.name}」`;
		}
		// 兼容「分类 > 名称」整串输入：拆开后按 分类+名称 精确匹配地点库。
		const labelMatch = place.find((item) => `${item.category} > ${item.name}` === name);
		if (labelMatch) {
			await ctx.update(
				{
					location: {
						id: labelMatch.id,
						category: labelMatch.category,
						name: labelMatch.name,
						description: labelMatch.description
					}
				},
				{ desc: `AI 切换地点：${labelMatch.category} > ${labelMatch.name}` }
			);
			return `已切换地点到「${labelMatch.category} > ${labelMatch.name}」`;
		}
		const category = typeof args.category === 'string' ? args.category.trim() : '';
		const description = typeof args.description === 'string' ? args.description.trim() : '';
		const label = `${category === '' ? '未分类' : category} > ${name}`;
		await ctx.update(
			{
				location: { id: name, category, name, description }
			},
			{ desc: `AI 切换地点：${label}` }
		);
		return `已切换地点到「${label}」`;
	}
};

/** 推进世界时间：minutes 可为负数（回拨）。 */
export const advanceTimeTool: StateToolDefinition = {
	name: 'advance_time',
	description:
		'推进世界时间。剧情时间发生流逝（赶路、跳过一段时间、进入下一时段等）时必须调用，' +
		'不要只在正文里描述时间变化。minutes 为推进的分钟数，如 30 表示半小时后、1440 表示一天后；可为负数表示回拨。',
	parameters: {
		type: 'object',
		properties: {
			minutes: { type: 'number', description: '推进的分钟数，如 30；负数为回拨' }
		},
		required: ['minutes']
	},
	async execute(args, ctx) {
		const minutes = args.minutes;
		if (typeof minutes !== 'number' || !Number.isFinite(minutes)) {
			throw new Error('advance_time 需要有效的 minutes 数字');
		}
		const next = addMinutes(ctx.getState().schedule.time, minutes);
		await ctx.advanceTime(minutes);
		return `时间推进到 ${formatWorldTime(next)}`;
	}
};

/**
 * 更换穿着：slot 指定槽位（接受中文别名，如「上衣」），item 为衣柜中的衣物名称、
 * null、或「无/脱」表示脱掉。衣物名称按衣柜精确匹配，其次唯一子串匹配，避免脑补。
 * 传入 rules 时按版本收敛可写槽位与可接受条目（Web 版不接受私密槽位/条目）。
 */
export function buildSetOutfitTool(rules?: EditionRules): StateToolDefinition {
	/** 未传规则 = 保持原有全量行为；Web 版由调用方传入规则。 */
	const allowedSlots: readonly OutfitSlot[] =
		rules === undefined ? OUTFIT_SLOTS : rules.outfitSlots.map((slot) => slot.key);
	const englishSlots = `${allowedSlots.join('/')}/accessory`;
	const chineseSlots = `${allowedSlots.map((slot) => SLOT_SHORT_LABELS[slot]).join('/')}/配饰`;
	const itemAllowed = (entry: ClothingItem): boolean =>
		rules === undefined || !isWardrobeItemHidden(entry, rules);

	return {
		name: 'set_outfit',
		description:
			'更换角色穿着或脱掉衣物。item 必填：衣柜中的衣物名称（用衣柜里的精确名称，如「白色衬衫」），' +
			'脱掉该部位衣物时传「无」。slot 为穿着槽位，可省略——省略时按衣柜中该衣物自动识别槽位；' +
			`可选值：${englishSlots}，也接受中文（${chineseSlots}）。` +
			'配饰是多件列表槽位：slot=配饰 + item=名称 添加一件；action=remove 移除指定一件；action=clear 或 item=无 清空全部配饰。',
		parameters: {
			type: 'object',
			properties: {
				item: {
					type: 'string',
					description: '衣柜中的衣物名称（精确名称）；脱掉衣物/清空配饰时传「无」'
				},
				slot: {
					type: 'string',
					description: `穿着槽位（可选，省略时按衣物自动识别）：${englishSlots} 或中文`
				},
				action: {
					type: 'string',
					description:
						'仅 slot=配饰 时使用：add=添加一件（默认）、remove=移除指定一件、clear=清空全部',
					enum: ['add', 'remove', 'clear']
				}
			},
			required: ['item']
		},
		async execute(args, ctx) {
			const rawSlot = typeof args.slot === 'string' ? args.slot.trim().toLowerCase() : '';
			const aliasSlot = SLOT_ALIASES[rawSlot];
			let slot: OutfitSlot | typeof ACCESSORY_SLOT | undefined =
				rawSlot === ACCESSORY_SLOT || aliasSlot === ACCESSORY_SLOT
					? ACCESSORY_SLOT
					: aliasSlot !== undefined && allowedSlots.includes(aliasSlot)
						? aliasSlot
						: allowedSlots.includes(rawSlot as OutfitSlot)
							? (rawSlot as OutfitSlot)
							: undefined;
			const item = args.item;
			if (item !== null && typeof item !== 'string') {
				throw new Error('set_outfit 的 item 必须是衣物名称或 null');
			}
			const rawValue = item === null ? '' : item.trim();
			const value = rawValue === '' || REMOVE_TOKENS.has(rawValue.toLowerCase()) ? null : rawValue;
			// 槽位缺失/非法时，按衣柜中该衣物的 kind 自动推断（模型常漏传 slot）。
			if (slot === undefined && value !== null) {
				const wardrobe = ctx.getState().outfit.wardrobe.filter(itemAllowed);
				const exact = wardrobe.find((entry) => entry.name === value);
				const fuzzy = wardrobe.filter((entry) =>
					entry.name.toLowerCase().includes(value.toLowerCase())
				);
				const entry = exact ?? (fuzzy.length === 1 ? fuzzy[0] : undefined);
				if (entry?.kind === 'accessory') {
					slot = ACCESSORY_SLOT;
				} else if (
					entry?.kind !== undefined &&
					entry.kind !== 'any' &&
					allowedSlots.includes(entry.kind as OutfitSlot)
				) {
					slot = entry.kind as OutfitSlot;
				}
			}
			if (slot === undefined) {
				throw new Error(`未知槽位：${String(args.slot ?? '')}，可用：${chineseSlots}`);
			}
			// 配饰是多件列表槽位：增删/清空独立处理。
			if (slot === ACCESSORY_SLOT) {
				const current = ctx.getState().outfit.accessories;
				const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : 'add';
				if (value === null || action === 'clear') {
					if (current.length > 0) {
						await ctx.update(
							{ outfit: { accessories: [] } },
							{ desc: 'AI 更换穿着：配饰 → 无' }
						);
					}
					return '已清空配饰';
				}
				const wardrobe = ctx.getState().outfit.wardrobe.filter(itemAllowed);
				const exact = wardrobe.find((entry) => entry.name === value);
				const lower = value.toLowerCase();
				const fuzzy = wardrobe.filter((entry) => entry.name.toLowerCase().includes(lower));
				const entry = exact ?? (fuzzy.length === 1 ? fuzzy[0] : undefined);
				if (entry === undefined || !matchesSlotKind(entry.kind, ACCESSORY_SLOT)) {
					throw new Error(
						`衣柜中没有可用的配饰「${value}」${fuzzy.length > 1 ? '（名称有歧义）' : ''}，可选配饰：${
							wardrobe
								.filter((item) => matchesSlotKind(item.kind, ACCESSORY_SLOT))
								.map((item) => item.name)
								.join('、') || '（暂无）'
						}`
					);
				}
				const name = entry.name;
				if (action === 'remove') {
					if (!current.includes(name)) {
						return `当前配饰中没有「${name}」`;
					}
					await ctx.update(
						{ outfit: { accessories: current.filter((item) => item !== name) } },
						{ desc: `AI 更换穿着：移除配饰 → ${name}` }
					);
					return `已移除配饰「${name}」`;
				}
				if (current.includes(name)) {
					return `已佩戴配饰「${name}」`;
				}
				await ctx.update(
					{ outfit: { accessories: [...current, name] } },
					{ desc: `AI 更换穿着：配饰 → ${name}` }
				);
				return `已添加配饰「${name}」`;
			}
			const slotKey = slot;
			if (value !== null) {
				const wardrobe = ctx.getState().outfit.wardrobe.filter(itemAllowed);
				const exact = wardrobe.find((entry) => entry.name === value);
				if (exact) {
					await ctx.update(
						{ outfit: { [slotKey]: exact.name } as Partial<OutfitState> },
						{ desc: `AI 更换穿着：${SLOT_LABELS[slotKey]} → ${exact.name}` }
					);
					return `已把${SLOT_LABELS[slotKey]}更换为「${exact.name}」`;
				}
				const lower = value.toLowerCase();
				const fuzzy = wardrobe.filter((entry) => entry.name.toLowerCase().includes(lower));
				if (fuzzy.length === 1) {
					await ctx.update(
						{ outfit: { [slotKey]: fuzzy[0]!.name } as Partial<OutfitState> },
						{ desc: `AI 更换穿着：${SLOT_LABELS[slotKey]} → ${fuzzy[0]!.name}` }
					);
					return `已把${SLOT_LABELS[slotKey]}更换为「${fuzzy[0]!.name}」`;
				}
				throw new Error(
					`衣柜中没有「${value}」${fuzzy.length > 1 ? '（名称有歧义）' : ''}，可选的${SLOT_LABELS[slotKey]}：${
						wardrobe
							.filter((entry) => matchesSlotKind(entry.kind, slotKey))
							.map((entry) => entry.name)
							.join('、') || '（暂无）'
					}`
				);
			}
			await ctx.update(
				{ outfit: { [slotKey]: value } as Partial<OutfitState> },
				{ desc: `AI 更换穿着：${SLOT_LABELS[slotKey]} → ${value ?? '无'}` }
			);
			return `已把${SLOT_LABELS[slotKey]}更换为「${value ?? '无'}」`;
		}
	};
}

/** 默认工具实例：保持全量槽位行为（桌面版 / 既有测试）。 */
export const setOutfitTool: StateToolDefinition = buildSetOutfitTool();

/** 衣物 kind 是否适用于该槽位（any/未标注视为通用）；配饰是列表槽位。 */
function matchesSlotKind(
	kind: ClothingKind | undefined,
	slot: OutfitSlot | typeof ACCESSORY_SLOT
): boolean {
	return kind === undefined || kind === 'any' || kind === slot;
}

/** 设置角色属性（如心情、金钱、好感度），数字/布尔字符串会自动转换。 */
export const setAttributeTool: StateToolDefinition = {
	name: 'set_attribute',
	description:
		'设置或更新角色属性表中的一项（属性名参考状态中的属性表，如 mood/money/affection）。' +
		'剧情导致属性变化（花钱、心情变化、好感度增减等）时调用。',
	parameters: {
		type: 'object',
		properties: {
			key: { type: 'string', description: '属性名，如 mood / money' },
			value: {
				type: 'string',
				description: '属性值，按字符串传（数字与布尔会自动转换），如 "100"、"开心"'
			}
		},
		required: ['key', 'value']
	},
	async execute(args, ctx) {
		const key = typeof args.key === 'string' ? args.key.trim() : '';
		if (key === '') {
			throw new Error('set_attribute 需要非空 key');
		}
		const value = coerceAttributeValue(args.value);
		if (value === undefined) {
			throw new Error('set_attribute 的 value 必须是 number/string/boolean');
		}
		await ctx.update(
			{ attributes: { [key]: value } },
			{ desc: `AI 设置属性：${key} = ${String(value)}` }
		);
		return `已设置属性 ${key} = ${String(value)}`;
	}
};

/** 按版本构建状态工具：Web 版收敛换装槽位与可接受条目。 */
export function buildStateTools(rules?: EditionRules): readonly StateToolDefinition[] {
	return [gotoLocationTool, advanceTimeTool, buildSetOutfitTool(rules), setAttributeTool];
}

/** 全部状态工具（默认全量行为；注册顺序即 schema 下发顺序）。 */
export const STATE_TOOLS: readonly StateToolDefinition[] = buildStateTools();

/**
 * 执行一次工具调用：未知工具或执行抛错时返回错误文本而不是向上抛，
 * 让模型能在下一轮看到失败原因并自行修正。
 */
export async function executeStateTool(
	definitions: readonly StateToolDefinition[],
	call: ToolCall,
	ctx: StateToolContext
): Promise<ExecutedToolCall> {
	const definition = definitions.find((item) => item.name === call.name);
	if (definition === undefined) {
		return { id: call.id, name: call.name, output: `${TOOL_UNKNOWN_PREFIX}${call.name}` };
	}
	try {
		const output = await definition.execute(call.arguments, ctx);
		return { id: call.id, name: call.name, output };
	} catch (err) {
		return {
			id: call.id,
			name: call.name,
			output: `${TOOL_ERROR_PREFIX}${err instanceof Error ? err.message : '未知错误'}`
		};
	}
}

/** 把可能来自纯文本 JSON 的属性值转换为合法 AttributeValue；非法返回 undefined。 */
function coerceAttributeValue(value: unknown): number | string | boolean | undefined {
	if (typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === 'true') {
			return true;
		}
		if (trimmed === 'false') {
			return false;
		}
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			return Number(trimmed);
		}
		return trimmed;
	}
	return undefined;
}
