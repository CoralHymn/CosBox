import type { ClothingItem, LocationDef, OutfitSlot } from '../core/types';

/** 一条自动补全建议。 */
export interface AutocompleteSuggestion {
	/** 悬浮窗主文案。 */
	label: string;
	/** 次要说明（地点描述 / 槽位标识等）。 */
	detail?: string;
	/** 选中后替换当前正在输入片段（最后一个 token）的文本。 */
	insert: string;
	/** 选中后是否保持补全悬浮窗打开（中间步骤：命令 → 槽位 → 衣物）。 */
	keepOpen?: boolean;
}

/** 穿着槽位候选（与 /wear 命令的别名一致）。 */
const SLOT_OPTIONS: readonly { label: string; slot: OutfitSlot }[] = [
	{ label: '帽子', slot: 'headwear' },
	{ label: '上衣', slot: 'top' },
	{ label: '内衣', slot: 'underwear' },
	{ label: '内裤', slot: 'underpants' },
	{ label: '下装', slot: 'bottom' },
	{ label: '袜子', slot: 'socks' },
	{ label: '鞋', slot: 'shoes' }
] as const;

/** 命令候选。 */
const COMMAND_SUGGESTIONS: readonly AutocompleteSuggestion[] = [
	{ label: '/goto 地点', detail: '切换当前地点', insert: '/goto ', keepOpen: true },
	{ label: '/wear 槽位=衣物', detail: '更换穿着（可多件）', insert: '/wear ', keepOpen: true },
	{ label: '/time 分钟', detail: '推进 / 回拨时间', insert: '/time ', keepOpen: true },
	{ label: '/checkpoint 描述', detail: '保存一个检查点', insert: '/checkpoint ', keepOpen: true },
	{ label: '/help', detail: '显示命令帮助', insert: '/help' }
] as const;

/** 时间快捷值。 */
const TIME_SUGGESTIONS: readonly AutocompleteSuggestion[] = [
	{ label: '+30 分钟', detail: '推进半小时', insert: '+30' },
	{ label: '+60 分钟', detail: '推进一小时', insert: '+60' },
	{ label: '+120 分钟', detail: '推进两小时', insert: '+120' },
	{ label: '-15 分钟', detail: '回拨一刻钟', insert: '-15' }
] as const;

/**
 * 根据输入框当前文本生成自动补全建议（数据来自地点库与衣柜）。
 * 纯函数：`/` 补命令；`/goto ` 补地点；`/wear ` 补槽位；`/wear 槽位=` 补衣物；`/time ` 补快捷时长。
 */
export function buildAutocompleteSuggestions(
	text: string,
	places: readonly LocationDef[],
	wardrobe: readonly ClothingItem[]
): AutocompleteSuggestion[] {
	if (!text.startsWith('/')) {
		return [];
	}
	const segments = text.split(' ');
	const command = segments[0] ?? '';
	if (segments.length === 1) {
		return COMMAND_SUGGESTIONS.filter(
			(suggestion) => suggestion.insert.startsWith(command) && suggestion.insert !== command
		);
	}
	const last = segments[segments.length - 1] ?? '';
	switch (command) {
		case '/goto':
			return placeSuggestions(places, last);
		case '/wear':
			return wearSuggestions(wardrobe, last);
		case '/time':
			return TIME_SUGGESTIONS.filter((suggestion) => suggestion.insert.startsWith(last));
		default:
			return [];
	}
}

/** /goto 的候选：地点库全部条目，按输入过滤。 */
function placeSuggestions(
	places: readonly LocationDef[],
	last: string
): AutocompleteSuggestion[] {
	const query = last.trim();
	return places
		.map((place) => ({
			label: place.category === '' ? place.name : `${place.category} > ${place.name}`,
			detail: place.description,
			insert: place.category === '' ? place.name : `${place.category} > ${place.name}`
		}))
		.filter((suggestion) => suggestion.label.includes(query))
		.slice(0, 8);
}

/** /wear 的候选：未出现 = 时补槽位；出现 槽位= 后按类型补衣柜衣物，并附「无（脱掉）」。 */
function wearSuggestions(wardrobe: readonly ClothingItem[], last: string): AutocompleteSuggestion[] {
	const eq = last.indexOf('=');
	if (eq === -1) {
		const query = last.trim();
		return SLOT_OPTIONS.map((option) => ({
			label: `${option.label}=`,
			detail: option.slot,
			insert: `${option.label}=`,
			keepOpen: true
		})).filter((suggestion) => suggestion.label.startsWith(query));
	}
	const slotLabel = last.slice(0, eq).trim();
	const slot = SLOT_OPTIONS.find((option) => option.label === slotLabel)?.slot;
	if (slot === undefined) {
		return [];
	}
	const itemQuery = last.slice(eq + 1).trim();
	const items = wardrobe
		.filter((item) => item.kind === slot || item.kind === undefined || item.kind === 'any')
		.map((item) => ({
			label: item.name,
			detail: item.category === '' ? undefined : `${item.category} > ${item.name}`,
			insert: `${slotLabel}=${item.name}`
		}))
		.filter((suggestion) => suggestion.label.includes(itemQuery))
		.slice(0, 8);
	return [{ label: '无（脱掉）', detail: '清空该槽位', insert: `${slotLabel}=无` }, ...items];
}
