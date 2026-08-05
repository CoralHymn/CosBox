import { StateValidationError } from './errors';
import { clonePlain } from './clone';
import type {
	CharacterAttributes,
	CharacterState,
	ClothingItem,
	ClothingKind,
	ConfigOverrides,
	LocationDef,
	LocationState,
	OutfitState,
	ScheduleEntry,
	ScheduleState,
	StatePatch,
	WorldTime
} from './types';

/** 一周七天的中文名，下标即 day 值。 */
export const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** 状态顶层允许的键，防止 typo 静默写入。 */
const STATE_TOP_KEYS = ['outfit', 'location', 'places', 'schedule', 'attributes'] as const;

/** 穿着槽位键，用于校验。 */
const OUTFIT_SLOT_KEYS = [
	'headwear',
	'top',
	'underwear',
	'underpants',
	'bottom',
	'socks',
	'shoes'
] as const;

/** 地点字段键，用于校验。 */
const LOCATION_KEYS = ['id', 'category', 'name', 'description'] as const;

/** 合法衣物类型列表（含 any）。 */
export const CLOTHING_KINDS: readonly ClothingKind[] = [
	'headwear',
	'top',
	'underwear',
	'underpants',
	'bottom',
	'socks',
	'shoes',
	'accessory',
	'any'
];

/** 判断值是否为合法衣物类型。 */
export function isValidClothingKind(value: unknown): value is ClothingKind {
	return typeof value === 'string' && (CLOTHING_KINDS as readonly string[]).includes(value);
}

/** 日程条目字段键，用于校验。 */
const SCHEDULE_ENTRY_KEYS = ['id', 'day', 'start', 'end', 'title', 'locationId'] as const;

/**
 * 生成初始角色状态（演示角色「绫音」）。
 * 每次调用返回全新对象，保证调用方之间互不共享引用。
 */
export function createInitialState(): CharacterState {
	return {
		outfit: {
			headwear: null,
			top: '白色衬衫',
			underwear: '白色棉质内衣',
			underpants: '白色棉质内裤',
			bottom: '深蓝百褶裙',
			socks: '白色过膝袜',
			shoes: '黑色皮鞋',
			accessories: ['蝴蝶结发带'],
			wardrobe: createInitialWardrobe()
		},
		location: {
			id: 'school-gate',
			category: '学校',
			name: '学院正门',
			description: '樱花道尽头的校门，晨间常有学生出入'
		},
		places: createInitialPlaces(),
		schedule: {
			time: { day: 0, hour: 8, minute: 0 },
			entries: createInitialScheduleEntries()
		},
		attributes: {
			name: '绫音',
			age: 17,
			class: '2年B班',
			affection: 30,
			trust: 20,
			mood: '平静',
			money: 500
		}
	};
}

/** 生成初始衣柜：当前穿着对应的衣物 + 几件备选（含穿后描述）。 */
export function createInitialWardrobe(): ClothingItem[] {
	return [
		{
			id: 'cloth-01',
			category: '常服',
			kind: 'top',
			name: '白色衬衫',
			description: '白色棉质衬衫，领口带细蕾丝，袖口挽起两折'
		},
		{
			id: 'cloth-02',
			category: '常服',
			kind: 'bottom',
			name: '深蓝百褶裙',
			description: '深蓝色及膝百褶裙，走动时裙摆轻轻摆动'
		},
		{
			id: 'cloth-03',
			category: '常服',
			kind: 'shoes',
			name: '黑色皮鞋',
			description: '黑色低跟皮鞋，鞋面擦得发亮'
		},
		{
			id: 'cloth-04',
			category: '常服',
			kind: 'accessory',
			name: '蝴蝶结发带',
			description: '红色蝴蝶结发带，别在右侧发间'
		},
		{
			id: 'cloth-05',
			category: '常服',
			kind: 'socks',
			name: '白色过膝袜',
			description: '白色过膝袜，袜口带一圈蕾丝边'
		},
		{
			id: 'cloth-06',
			category: '常服',
			kind: 'underwear',
			name: '白色棉质内衣',
			description: '白色纯棉内衣，无花纹，剪裁合体'
		},
		{
			id: 'cloth-07',
			category: '常服',
			kind: 'underpants',
			name: '白色棉质内裤',
			description: '白色纯棉内裤，松紧腰'
		},
		{
			id: 'cloth-08',
			category: '运动服',
			kind: 'top',
			name: '黑色卫衣',
			description: '宽松黑色连帽卫衣，胸前有白色字母印花'
		},
		{
			id: 'cloth-09',
			category: '运动服',
			kind: 'shoes',
			name: '白色运动鞋',
			description: '白色运动鞋，鞋带系成蝴蝶结，鞋边干净'
		},
		{
			id: 'cloth-10',
			category: '常服',
			kind: 'headwear',
			name: '贝雷帽',
			description: '藏青色贝雷帽，斜戴在头顶右侧'
		}
	];
}

/** 生成初始地点库：与日程 locationId 相互独立的一等数据。 */
export function createInitialPlaces(): LocationDef[] {
	return [
		{
			id: 'school-gate',
			category: '学校',
			name: '学院正门',
			description: '樱花道尽头的校门，晨间常有学生出入'
		},
		{
			id: 'classroom',
			category: '学校',
			name: '教室 2-B',
			description: '二楼尽头的教室，窗外能看到操场'
		},
		{
			id: 'cafeteria',
			category: '学校',
			name: '食堂',
			description: '午间最热闹的地方，招牌是咖喱饭'
		},
		{
			id: 'library',
			category: '学校',
			name: '图书馆',
			description: '安静的阅读空间，三楼据说有禁书区'
		},
		{ id: 'pool', category: '学校', name: '游泳馆', description: '标准泳池，更衣室在入口左侧' },
		{
			id: 'rooftop',
			category: '学校',
			name: '天台',
			description: '教学楼顶，午后阳光正好，可以望见整座学园'
		}
	];
}

/** 生成初始日程表：周一的一堂早课与午休。 */
export function createInitialScheduleEntries(): ScheduleEntry[] {
	return [
		{ id: 'sch-01', day: 0, start: 480, end: 540, title: '晨会', locationId: 'classroom' },
		{ id: 'sch-02', day: 0, start: 540, end: 600, title: '国文课', locationId: 'classroom' },
		{ id: 'sch-03', day: 0, start: 720, end: 780, title: '午休', locationId: 'cafeteria' }
	];
}

/**
 * 把状态补丁应用到当前状态，返回新对象。
 * - 顶层与各子结构均为浅合并，accessories / entries / attributes 为整体替换。
 * - 未知顶层键抛错，防止拼写错误被静默吞掉。
 * - 合并结果会先通过 validateCharacterState 校验，非法补丁不会返回。
 */
export function applyStateDelta(state: CharacterState, patch: StatePatch): CharacterState {
	for (const key of Object.keys(patch)) {
		if (!STATE_TOP_KEYS.includes(key as (typeof STATE_TOP_KEYS)[number])) {
			throw new StateValidationError(`未知状态字段：${key}`);
		}
	}

	const merged: CharacterState = { ...state };
	if (patch.outfit !== undefined) {
		merged.outfit = { ...state.outfit, ...clonePlain(patch.outfit) };
	}
	if (patch.location !== undefined) {
		merged.location = { ...state.location, ...clonePlain(patch.location) };
	}
	if (patch.places !== undefined) {
		merged.places = clonePlain(patch.places);
	}
	if (patch.schedule !== undefined) {
		merged.schedule = { ...state.schedule, ...clonePlain(patch.schedule) };
	}
	if (patch.attributes !== undefined) {
		merged.attributes = mergeAttributes(state.attributes, patch.attributes);
	}

	validateCharacterState(merged);
	return merged;
}

/**
 * 把世界配置覆盖叠加到重建后的状态上（整体替换三个配置段）。
 * 配置（地点库/衣柜/日程条目）不进入版本历史，因此重建后需要从这里恢复；
 * 校验失败会抛 StateValidationError，原状态不变。
 */
export function applyConfigOverrides(
	state: CharacterState,
	overrides: ConfigOverrides
): CharacterState {
	const patch: StatePatch = {};
	if (overrides.places !== undefined) {
		patch.places = overrides.places;
	}
	if (overrides.wardrobe !== undefined) {
		patch.outfit = { wardrobe: overrides.wardrobe };
	}
	if (overrides.scheduleEntries !== undefined) {
		patch.schedule = { entries: overrides.scheduleEntries };
	}
	return applyStateDelta(state, patch);
}

/** 合并属性表：显式 undefined 的键视为「不修改」。 */
function mergeAttributes(
	base: CharacterAttributes,
	patch: Partial<CharacterAttributes>
): CharacterAttributes {
	const result: CharacterAttributes = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * 校验角色状态完整性，失败抛出 StateValidationError。
 * 覆盖：穿着槽位类型、地点字段、世界时间范围、日程条目合法性、属性值类型。
 */
export function validateCharacterState(state: CharacterState): void {
	if (state === null || typeof state !== 'object' || Array.isArray(state)) {
		throw new StateValidationError('角色状态必须是对象');
	}
	validateOutfit(state.outfit);
	validateLocation(state.location);
	validatePlaces(state.places);
	validateSchedule(state.schedule);
	validateAttributes(state.attributes);
}

function validateOutfit(outfit: OutfitState): void {
	if (outfit === null || typeof outfit !== 'object' || Array.isArray(outfit)) {
		throw new StateValidationError('穿着状态必须是对象');
	}
	for (const slot of OUTFIT_SLOT_KEYS) {
		const value = outfit[slot];
		if (value !== null && typeof value !== 'string') {
			throw new StateValidationError(`穿着槽位 ${slot} 必须是字符串或 null`);
		}
	}
	if (
		!Array.isArray(outfit.accessories) ||
		!outfit.accessories.every((a) => typeof a === 'string')
	) {
		throw new StateValidationError('配饰必须是字符串数组');
	}
	if (!Array.isArray(outfit.wardrobe)) {
		throw new StateValidationError('衣柜必须是数组');
	}
	const wardrobeIds = new Set<string>();
	for (const item of outfit.wardrobe) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) {
			throw new StateValidationError('衣柜条目必须是对象');
		}
		if (typeof item.id !== 'string' || item.id.trim() === '') {
			throw new StateValidationError('衣柜条目 id 必须是非空字符串');
		}
		if (typeof item.name !== 'string' || item.name.trim() === '') {
			throw new StateValidationError('衣柜条目名称必须是非空字符串');
		}
		if (item.kind !== undefined && !isValidClothingKind(item.kind)) {
			throw new StateValidationError('衣柜条目类型非法');
		}
		if (typeof item.category !== 'string') {
			throw new StateValidationError('衣柜条目分类必须是字符串');
		}
		if (typeof item.description !== 'string') {
			throw new StateValidationError('衣柜条目描述必须是字符串');
		}
		if (wardrobeIds.has(item.id)) {
			throw new StateValidationError(`衣柜条目 id 重复：${item.id}`);
		}
		wardrobeIds.add(item.id);
	}
}

function validateLocation(location: LocationState): void {
	if (location === null || typeof location !== 'object' || Array.isArray(location)) {
		throw new StateValidationError('地点状态必须是对象');
	}
	for (const key of LOCATION_KEYS) {
		const value = location[key];
		if (typeof value !== 'string') {
			throw new StateValidationError(`地点字段 ${key} 必须是字符串`);
		}
		if ((key === 'id' || key === 'name') && value.trim() === '') {
			throw new StateValidationError(`地点字段 ${key} 不能为空`);
		}
	}
}

function validatePlaces(places: LocationDef[]): void {
	if (!Array.isArray(places)) {
		throw new StateValidationError('地点库必须是数组');
	}
	const ids = new Set<string>();
	for (const place of places) {
		if (place === null || typeof place !== 'object' || Array.isArray(place)) {
			throw new StateValidationError('地点条目必须是对象');
		}
		if (typeof place.id !== 'string' || place.id.trim() === '') {
			throw new StateValidationError('地点条目 id 必须是非空字符串');
		}
		if (typeof place.name !== 'string' || place.name.trim() === '') {
			throw new StateValidationError('地点条目名称必须是非空字符串');
		}
		if (typeof place.category !== 'string') {
			throw new StateValidationError('地点条目分类必须是字符串');
		}
		if (typeof place.description !== 'string') {
			throw new StateValidationError('地点条目描述必须是字符串');
		}
		if (ids.has(place.id)) {
			throw new StateValidationError(`地点 id 重复：${place.id}`);
		}
		ids.add(place.id);
	}
}

function validateSchedule(schedule: ScheduleState): void {
	if (schedule === null || typeof schedule !== 'object' || Array.isArray(schedule)) {
		throw new StateValidationError('日程状态必须是对象');
	}
	if (!isValidWorldTime(schedule.time)) {
		throw new StateValidationError('世界时间非法：day 需 0-6、hour 需 0-23、minute 需 0-59');
	}
	if (!Array.isArray(schedule.entries)) {
		throw new StateValidationError('日程条目必须是数组');
	}
	for (const entry of schedule.entries) {
		validateScheduleEntry(entry);
	}
}

function validateScheduleEntry(entry: ScheduleEntry): void {
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
		throw new StateValidationError('日程条目必须是对象');
	}
	for (const key of SCHEDULE_ENTRY_KEYS) {
		if (key === 'locationId' && entry.locationId === undefined) {
			continue;
		}
		if (!(key in entry)) {
			throw new StateValidationError(`日程条目缺少字段 ${key}`);
		}
	}
	if (typeof entry.id !== 'string' || entry.id.trim() === '') {
		throw new StateValidationError('日程条目 id 必须是非空字符串');
	}
	if (typeof entry.title !== 'string' || entry.title.trim() === '') {
		throw new StateValidationError('日程条目标题必须是非空字符串');
	}
	if (!Number.isInteger(entry.day) || entry.day < 0 || entry.day > 6) {
		throw new StateValidationError('日程条目 day 必须是 0-6 的整数');
	}
	if (
		!Number.isInteger(entry.start) ||
		!Number.isInteger(entry.end) ||
		entry.start < 0 ||
		entry.end > 1440 ||
		entry.start >= entry.end
	) {
		throw new StateValidationError('日程条目时间段非法（0 <= start < end <= 1440）');
	}
	if (entry.locationId !== undefined && typeof entry.locationId !== 'string') {
		throw new StateValidationError('日程条目 locationId 必须是字符串');
	}
}

function validateAttributes(attributes: CharacterAttributes): void {
	if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
		throw new StateValidationError('属性表必须是对象');
	}
	for (const [key, value] of Object.entries(attributes)) {
		if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
			throw new StateValidationError(`属性 ${key} 的值必须是 number/string/boolean`);
		}
	}
}

/** 世界时间是否合法：day 0-6、hour 0-23、minute 0-59，且均为整数。 */
export function isValidWorldTime(time: WorldTime): boolean {
	return (
		time !== null &&
		typeof time === 'object' &&
		Number.isInteger(time.day) &&
		time.day >= 0 &&
		time.day <= 6 &&
		Number.isInteger(time.hour) &&
		time.hour >= 0 &&
		time.hour <= 23 &&
		Number.isInteger(time.minute) &&
		time.minute >= 0 &&
		time.minute <= 59
	);
}

/** 把非法输入收敛到合法范围（用于导入容错），逐字段取整并夹取。 */
export function normalizeWorldTime(time: WorldTime): WorldTime {
	return {
		day: clampInt(time.day, 0, 6),
		hour: clampInt(time.hour, 0, 23),
		minute: clampInt(time.minute, 0, 59)
	};
}

function clampInt(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * 时间推进：以 7×24h 为周期循环，支持负数回拨。
 * 例：周一 23:50 +20 分钟 => 周二 00:10。
 */
export function addMinutes(time: WorldTime, minutes: number): WorldTime {
	if (!Number.isFinite(minutes)) {
		throw new StateValidationError('推进分钟数必须是有限数字');
	}
	const totalMinutesPerWeek = 7 * 24 * 60;
	const current = time.day * 1440 + time.hour * 60 + time.minute;
	const rounded = Math.floor(minutes);
	let next =
		(((current + rounded) % totalMinutesPerWeek) + totalMinutesPerWeek) % totalMinutesPerWeek;
	const day = Math.floor(next / 1440) % 7;
	next = next % 1440;
	return { day, hour: Math.floor(next / 60), minute: next % 60 };
}

/** 当日 00:00 起的分钟数。 */
export function minutesSinceMidnight(time: WorldTime): number {
	return time.hour * 60 + time.minute;
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

/** 格式化世界时间，如「周一 08:00」。 */
export function formatWorldTime(time: WorldTime): string {
	return `${DAY_NAMES[time.day]} ${pad2(time.hour)}:${pad2(time.minute)}`;
}

/** 按时间自动排序日程条目：day → start → end → title。 */
export function sortScheduleEntries(entries: ReadonlyArray<ScheduleEntry>): ScheduleEntry[] {
	return [...entries].sort(
		(a, b) => a.day - b.day || a.start - b.start || a.end - b.end || a.title.localeCompare(b.title)
	);
}

/** 分钟数 -> 「HH:MM」，如 540 => '09:00'。 */
export function formatMinutesOfDay(minutes: number): string {
	const safe = Math.min(1439, Math.max(0, Math.floor(minutes)));
	return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

/**
 * 当前正在进行的日程条目；无命中返回 null。
 * 重叠时取开始最早的一条。
 */
export function currentScheduleEntry(
	schedule: ScheduleState,
	at: WorldTime = schedule.time
): ScheduleEntry | null {
	const minutes = minutesSinceMidnight(at);
	const candidates = schedule.entries
		.filter((e) => e.day === at.day && e.start <= minutes && minutes < e.end)
		.sort((a, b) => a.start - b.start);
	return candidates[0] ?? null;
}

/** 描述当前活动，如「正在「晨会」」或「自由活动」。 */
export function describeCurrentActivity(schedule: ScheduleState): string {
	const entry = currentScheduleEntry(schedule);
	return entry ? `正在「${entry.title}」` : '自由活动';
}
