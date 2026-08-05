import {
	describeCurrentActivity,
	formatMinutesOfDay,
	formatWorldTime,
	sortScheduleEntries
} from '../core/state';
import type {
	CharacterState,
	ClothingItem,
	ClothingKind,
	LocationDef,
	OutfitState,
	OutfitSlot,
	ScheduleState
} from '../core/types';

/**
 * 把穿着结构渲染成自然语言（按穿戴顺序）：
 * 如「帽子：未穿；上衣：白色衬衫；内衣：白色棉质内衣；…；配饰：蝴蝶结发带」。
 */
export function formatOutfit(outfit: OutfitState): string {
	const slots: ReadonlyArray<[OutfitSlot, string]> = [
		['headwear', '帽子'],
		['top', '上衣'],
		['underwear', '内衣'],
		['underpants', '内裤'],
		['bottom', '下装'],
		['socks', '袜子'],
		['shoes', '鞋']
	];
	const parts = slots.map(([slot, label]) => {
		const value = outfit[slot];
		return `${label}：${value !== null && value.trim() !== '' ? value : '未穿'}`;
	});
	const accessories = outfit.accessories.filter((item) => item.trim() !== '').join('、');
	parts.push(`配饰：${accessories === '' ? '未穿' : accessories}`);
	return parts.join('；');
}

/**
 * 把属性表渲染成一行摘要，如「name:绫音，age:17，affection:30」。
 */
export function formatAttributes(attributes: Record<string, number | string | boolean>): string {
	const parts = Object.entries(attributes).map(([key, value]) => `${key}:${String(value)}`);
	return parts.length > 0 ? parts.join('，') : '（无属性）';
}

/** 渲染已知地点库（带大类），如「学校 > 食堂（午间最热闹…）；学校 > 游泳馆（标准泳池…）」。 */
export function formatPlaces(places: LocationDef[]): string {
	if (places.length === 0) {
		return '（暂无已知地点）';
	}
	return places
		.map(
			(place) =>
				`${place.category ? `${place.category} > ${place.name}` : place.name}（${place.description}）`
		)
		.join('；');
}

/** 渲染衣柜（带大类），如「常服 > 白色衬衫：白色棉质衬衫…；运动服 > 黑色卫衣：宽松…」。 */
export function formatWardrobe(wardrobe: ClothingItem[]): string {
	if (wardrobe.length === 0) {
		return '（衣柜为空）';
	}
	return wardrobe
		.map(
			(item) =>
				`${item.category ? `${item.category} > ${item.name}` : item.name}：${item.description}`
		)
		.join('；');
}

/** 按衣物名查找衣柜条目（当前穿着槽位与衣柜同名匹配）。 */
export function findWardrobeItem(wardrobe: ClothingItem[], name: string): ClothingItem | undefined {
	return wardrobe.find((item) => item.name === name);
}

/** 按槽位类型过滤衣柜候选：kind 匹配该槽位、或 any / 未标注（兼容老数据）。 */
export function wardrobeItemsForSlot(wardrobe: ClothingItem[], slot: ClothingKind): ClothingItem[] {
	return wardrobe.filter(
		(item) => item.kind === slot || item.kind === undefined || item.kind === 'any'
	);
}

/**
 * 渲染今日日程：按时段排序的条目列表，如「周一 08:00-09:00 晨会」。
 */
export function summarizeSchedule(schedule: ScheduleState): string {
	const sorted = sortScheduleEntries(schedule.entries);
	if (sorted.length === 0) {
		return '今日无安排';
	}
	return sorted
		.map((entry) => {
			const dayName = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][entry.day] ?? '?';
			return `${dayName} ${formatMinutesOfDay(entry.start)}-${formatMinutesOfDay(entry.end)} ${entry.title}`;
		})
		.join('；');
}

/**
 * 生成结构化状态摘要，注入 LLM 系统提示。
 * 覆盖：时间、当前活动、地点、穿着、属性、日程。
 */
export function summarizeState(state: CharacterState): string {
	const lines = [
		'【当前状态】',
		`时间：${formatWorldTime(state.schedule.time)}（${describeCurrentActivity(state.schedule)}）`,
		`地点：${
			state.location.category
				? `${state.location.category} > ${state.location.name}`
				: state.location.name
		}（${state.location.description}）`,
		`穿着：${formatOutfit(state.outfit)}`,
		`属性：${formatAttributes(state.attributes)}`,
		`今日日程：${summarizeSchedule(state.schedule)}`,
		`【已知地点】${formatPlaces(state.places)}`,
		`【衣柜】${formatWardrobe(state.outfit.wardrobe)}`
	];
	return lines.join('\n');
}
