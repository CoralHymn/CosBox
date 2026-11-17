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

/** 全部穿着槽位（默认顺序与状态面板一致）。 */
const DEFAULT_OUTFIT_SLOTS: readonly OutfitSlot[] = [
	'headwear',
	'top',
	'underwear',
	'underpants',
	'bottom',
	'socks',
	'shoes'
];

const OUTFIT_SLOT_LABELS: Record<OutfitSlot, string> = {
	headwear: '帽子',
	top: '上衣',
	underwear: '内衣',
	underpants: '内裤',
	bottom: '下装',
	socks: '袜子',
	shoes: '鞋'
};

/**
 * 状态摘要的可选合规参数：按版本传入，默认行为与旧版完全一致。
 * 纯函数：不读取全局状态，只使用调用方显式传入的槽位与衣柜过滤。
 */
export interface StateSummaryOptions {
	/** 摘要中展示的穿着槽位；缺省为全部 7 个槽位。 */
	slots?: readonly OutfitSlot[];
	/** 衣柜条目过滤（展示与细节回填共用）；缺省展示全部。 */
	wardrobeFilter?: (item: ClothingItem) => boolean;
}

/**
 * 把穿着结构渲染成自然语言（按穿戴顺序）：
 * 如「帽子：未穿；上衣：白色衬衫；内衣：白色棉质内衣；…；配饰：蝴蝶结发带」。
 * 可通过 options.slots 限定展示槽位（Web 版过滤私密槽位）。
 */
export function formatOutfit(outfit: OutfitState, options: StateSummaryOptions = {}): string {
	const slots = options.slots ?? DEFAULT_OUTFIT_SLOTS;
	const parts = slots.map((slot) => {
		const value = outfit[slot];
		return `${OUTFIT_SLOT_LABELS[slot]}：${value !== null && value.trim() !== '' ? value : '未穿'}`;
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
export function formatWardrobe(
	wardrobe: ClothingItem[],
	filter?: (item: ClothingItem) => boolean
): string {
	const visible = filter === undefined ? wardrobe : wardrobe.filter(filter);
	if (visible.length === 0) {
		return '（衣柜为空）';
	}
	return visible
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

/**
 * 渲染当前穿着各件的衣柜描述（与【衣柜】条目一致），如
 * 「白色衬衫：白色棉质衬衫，领口带细蕾丝；深蓝百褶裙：过膝深蓝百褶裙」。
 * 已穿但衣柜中无同名条目、或条目无描述时不参与；全部无描述时返回空串。
 * options 可限定槽位与衣柜过滤（Web 版过滤私密槽位）。
 */
export function formatOutfitDetails(
	outfit: OutfitState,
	options: StateSummaryOptions = {}
): string {
	const slots = options.slots ?? DEFAULT_OUTFIT_SLOTS;
	const wornNames: string[] = [];
	for (const slot of slots) {
		const value = outfit[slot];
		if (value !== null && value.trim() !== '') {
			wornNames.push(value.trim());
		}
	}
	for (const accessory of outfit.accessories) {
		if (accessory.trim() !== '') {
			wornNames.push(accessory.trim());
		}
	}
	const parts: string[] = [];
	for (const name of [...new Set(wornNames)]) {
		const item = findWardrobeItem(outfit.wardrobe, name);
		if (item === undefined) {
			continue;
		}
		if (options.wardrobeFilter !== undefined && !options.wardrobeFilter(item)) {
			continue;
		}
		const description = item.description.trim();
		if (description !== '') {
			parts.push(`${name}：${description}`);
		}
	}
	return parts.join('；');
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
 * options 由调用方按版本传入；缺省保持全量输出。
 */
export function summarizeState(
	state: CharacterState,
	options: StateSummaryOptions = {}
): string {
	const outfitDetails = formatOutfitDetails(state.outfit, options);
	const lines = [
		'【当前状态】',
		`时间：${formatWorldTime(state.schedule.time)}（${describeCurrentActivity(state.schedule)}）`,
		`地点：${
			state.location.category
				? `${state.location.category} > ${state.location.name}`
				: state.location.name
		}（${state.location.description}）`,
		`穿着：${formatOutfit(state.outfit, options)}`,
		...(outfitDetails !== '' ? [`穿着细节：${outfitDetails}`] : []),
		`属性：${formatAttributes(state.attributes)}`,
		`今日日程：${summarizeSchedule(state.schedule)}`,
		`【已知地点】${formatPlaces(state.places)}`,
		`【衣柜】${formatWardrobe(state.outfit.wardrobe, options.wardrobeFilter)}`
	];
	return lines.join('\n');
}
