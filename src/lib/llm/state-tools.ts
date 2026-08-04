import { addMinutes, formatWorldTime } from '../core/state';
import type { CharacterState, OutfitSlot, OutfitState, StatePatch } from '../core/types';
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

/** 状态工具定义：JSON Schema + 宿主侧执行函数。 */
export interface StateToolDefinition extends StateToolSchema {
	execute(args: Record<string, unknown>, ctx: StateToolContext): Promise<string>;
}

/** 穿着槽位白名单，防止 AI 把内裤套头上。 */
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

/** 切换当前地点：locationId 优先匹配地点库，否则用 name 创建（可附 category/description）。 */
export const gotoLocationTool: StateToolDefinition = {
	name: 'goto_location',
	description:
		'切换角色的当前地点。locationId 优先匹配地点库中的条目；否则使用 name 前往（可附 category 与 description）。',
	parameters: {
		type: 'object',
		properties: {
			locationId: { type: 'string', description: '地点库中的 id（可选）' },
			name: { type: 'string', description: '地点名称（必填其一）' },
			category: { type: 'string', description: '地点大类，如「学校」（可选）' },
			description: { type: 'string', description: '地点描述（可选）' }
		},
		required: []
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
	description: '推进世界时间。minutes 为要推进的分钟数，可为负数表示回拨。',
	parameters: {
		type: 'object',
		properties: {
			minutes: { type: 'number', description: '推进的分钟数' }
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
 * 更换穿着：slot 指定槽位，item 为衣柜中的衣物名称或 null（脱掉）。
 * 衣物名称必须匹配衣柜预设，避免 AI 脑补不存在的衣服。
 */
export const setOutfitTool: StateToolDefinition = {
	name: 'set_outfit',
	description:
		'更换角色穿着。slot 为槽位（headwear/top/underwear/underpants/bottom/socks/shoes），item 必须是衣柜中已存在的衣物名称，或用 null 表示脱掉。',
	parameters: {
		type: 'object',
		properties: {
			slot: {
				type: 'string',
				description: '穿着槽位',
				enum: OUTFIT_SLOTS
			},
			item: { type: 'string', description: '衣柜中的衣物名称或 null' }
		},
		required: ['slot', 'item']
	},
	async execute(args, ctx) {
		const slot = args.slot;
		if (typeof slot !== 'string' || !OUTFIT_SLOTS.includes(slot as OutfitSlot)) {
			throw new Error(`未知槽位：${String(slot)}`);
		}
		const item = args.item;
		if (item !== null && typeof item !== 'string') {
			throw new Error('set_outfit 的 item 必须是衣物名称或 null');
		}
		const slotKey = slot as OutfitSlot;
		const value = item === null ? null : item.trim();
		if (value !== null) {
			const wardrobe = ctx.getState().outfit.wardrobe;
			const found = wardrobe.some((entry) => entry.name === value);
			if (!found) {
				throw new Error(`衣柜中没有「${value}」，请从衣柜中选择`);
			}
		}
		await ctx.update(
			{ outfit: { [slotKey]: value } as Partial<OutfitState> },
			{ desc: `AI 更换穿着：${SLOT_LABELS[slotKey]} → ${value ?? '无'}` }
		);
		return `已把${SLOT_LABELS[slotKey]}更换为「${value ?? '无'}」`;
	}
};

/** 设置角色属性（如心情、金钱、好感度），数字/布尔字符串会自动转换。 */
export const setAttributeTool: StateToolDefinition = {
	name: 'set_attribute',
	description: '设置或更新角色属性表中的一项（如 mood/money/affection）。',
	parameters: {
		type: 'object',
		properties: {
			key: { type: 'string', description: '属性名' },
			value: { type: 'string', description: '属性值，数字与布尔会自动转换' }
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

/** 全部状态工具（注册顺序即 schema 下发顺序）。 */
export const STATE_TOOLS: readonly StateToolDefinition[] = [
	gotoLocationTool,
	advanceTimeTool,
	setOutfitTool,
	setAttributeTool
];

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
		return { id: call.id, name: call.name, output: `未知工具：${call.name}` };
	}
	try {
		const output = await definition.execute(call.arguments, ctx);
		return { id: call.id, name: call.name, output };
	} catch (err) {
		return {
			id: call.id,
			name: call.name,
			output: `工具执行失败：${err instanceof Error ? err.message : '未知错误'}`
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
