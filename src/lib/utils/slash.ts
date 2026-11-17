import type {
	CharacterState,
	ClothingItem,
	OutfitSlot,
	StatePatch
} from '../core/types';
import { isWardrobeItemHidden, type EditionRules } from '../platform/edition';

/** 一条换装指令：可显式指定槽位，或由衣物类型自动推断。 */
export interface WearAssignment {
	/** 显式槽位（/wear 上衣=xxx）；未指定时按衣物 kind 推断。 */
	slot?: OutfitSlot;
	/** 衣物名称，或 null 表示脱掉。 */
	item: string | null;
	/** 原始 token，用于错误提示。 */
	raw: string;
}

/** 解析后的斜杠命令（非斜杠输入返回 null）。 */
export type SlashCommand =
	| { kind: 'goto'; query: string }
	| { kind: 'wear'; assignments: WearAssignment[] }
	| { kind: 'time'; minutes: number }
	| { kind: 'checkpoint'; desc: string }
	| { kind: 'help' }
	| { kind: 'unknown'; name: string };

/** 斜杠命令的执行结果：状态补丁 / 时间推进 / 反馈文本。 */
export interface SlashResult {
	patch?: StatePatch;
	minutes?: number;
	checkpointDesc?: string;
	helpText?: string;
	/** 用户可见的反馈文本。 */
	message: string;
	/** 出错时填充，此时不产生任何变更。 */
	error?: string;
}

/** 中文槽位别名 -> OutfitSlot。 */
const SLOT_ALIASES: Record<string, OutfitSlot> = {
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
	鞋子: 'shoes'
};

const SLOT_LABELS: Record<OutfitSlot, string> = {
	headwear: '帽子/头饰',
	top: '上衣',
	underwear: '内衣',
	underpants: '内裤',
	bottom: '下装',
	socks: '袜子',
	shoes: '鞋子'
};

const OUTFIT_SLOTS: readonly OutfitSlot[] = [
	'headwear',
	'top',
	'underwear',
	'underpants',
	'bottom',
	'socks',
	'shoes'
] as const;

/** 解析输入：以 / 开头视为斜杠命令，否则返回 null。 */
export function parseSlashCommand(text: string): SlashCommand | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/')) {
		return null;
	}
	const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
	const name = (rawName ?? '').toLowerCase();
	const args = rest.join(' ').trim();
	switch (name) {
		case 'goto':
			return { kind: 'goto', query: args };
		case 'wear':
			return { kind: 'wear', assignments: parseWearAssignments(rest) };
		case 'time':
			return { kind: 'time', minutes: parseMinutes(args) };
		case 'checkpoint':
			return { kind: 'checkpoint', desc: args };
		case 'help':
			return { kind: 'help' };
		default:
			return { kind: 'unknown', name: rawName ?? name };
	}
}

/** 解析 /wear 的每个 token：支持「槽位=衣物」与裸衣物名两种形态。 */
function parseWearAssignments(tokens: string[]): WearAssignment[] {
	return tokens
		.filter((token) => token.trim() !== '')
		.map((token) => {
			const eq = token.indexOf('=');
			if (eq <= 0) {
				return { item: parseWearValue(token), raw: token };
			}
			const slotAlias = token.slice(0, eq).trim().toLowerCase();
			const item = parseWearValue(token.slice(eq + 1).trim());
			const slot = SLOT_ALIASES[slotAlias] ?? SLOT_ALIASES[slotAlias.replace(/[（）()]/g, '')];
			return slot === undefined ? { item, raw: token } : { slot, item, raw: token };
		});
}

/** 「null / 无 / 脱」表示脱掉该槽位。 */
function parseWearValue(value: string): string | null {
	if (value === 'null' || value === '无' || value === '脱') {
		return null;
	}
	return value;
}

/** 解析 /time 参数：允许 +30 / -15 / 30分钟 等写法。 */
function parseMinutes(args: string): number {
	const match = args.match(/^([+-]?\d+)/);
	if (match === null) {
		return Number.NaN;
	}
	return Number.parseInt(match[1]!, 10);
}

/**
 * 把斜杠命令应用到当前状态，返回待执行的变更与反馈。
 * 纯函数：不直接修改状态，由调用方通过 CharacterManager 落地（自动生成快照）。
 */
export function applySlashCommand(
	state: CharacterState,
	command: SlashCommand,
	rules?: EditionRules
): SlashResult {
	switch (command.kind) {
		case 'goto':
			return applyGoto(state, command.query);
		case 'wear':
			return applyWear(state, command.assignments, rules);
		case 'time': {
			if (!Number.isFinite(command.minutes)) {
				return { message: '', error: '/time 需要分钟数，例如 /time +30 或 /time -15' };
			}
			return {
				minutes: command.minutes,
				message: `时间${command.minutes >= 0 ? '推进' : '回拨'} ${command.minutes} 分钟`
			};
		}
		case 'checkpoint':
			return { checkpointDesc: command.desc, message: '已保存检查点' };
		case 'help':
			return { helpText: helpText(), message: '' };
		case 'unknown':
			return { message: '', error: `未知命令 /${command.name}，输入 /help 查看可用命令` };
	}
}

/** /goto：按名称、分类>名称、或唯一分类匹配地点库。 */
function applyGoto(state: CharacterState, query: string): SlashResult {
	const target = query.trim();
	if (target === '') {
		return { message: '', error: '/goto 需要地点名称，例如 /goto 食堂' };
	}
	const place = findPlace(state, target);
	if (place === undefined) {
		return {
			message: '',
			error: `未找到地点「${target}」，可在「地点」页添加到地点库，或用 分类>名称 指定`
		};
	}
	const label = place.category === '' ? place.name : `${place.category} > ${place.name}`;
	return {
		patch: {
			location: {
				id: place.id,
				category: place.category,
				name: place.name,
				description: place.description
			}
		},
		message: `切换地点：${label}`
	};
}

/** 在地点库中匹配：名称 > 分类>名称 > 唯一分类。 */
function findPlace(
	state: CharacterState,
	query: string
): CharacterState['places'][number] | undefined {
	const byName = state.places.find((place) => place.name === query);
	if (byName) {
		return byName;
	}
	const byLabel = state.places.find((place) => `${place.category} > ${place.name}` === query);
	if (byLabel) {
		return byLabel;
	}
	const byCategory = state.places.filter((place) => place.category === query);
	if (byCategory.length === 1) {
		return byCategory[0];
	}
	return undefined;
}

/** /wear：解析每条换装指令并合并为一个状态补丁。 */
function applyWear(
	state: CharacterState,
	assignments: WearAssignment[],
	rules?: EditionRules
): SlashResult {
	if (assignments.length === 0) {
		return {
			message: '',
			error: '/wear 需要衣物，例如 /wear 上衣=黑色卫衣 或 /wear 黑色卫衣'
		};
	}
	const outfitPatch: Partial<CharacterState['outfit']> = {};
	const changes: string[] = [];
	for (const assignment of assignments) {
		const resolved = resolveWear(state.outfit.wardrobe, assignment, rules);
		if (resolved.error) {
			return { message: '', error: resolved.error };
		}
		outfitPatch[resolved.slot] = resolved.item;
		changes.push(`${SLOT_LABELS[resolved.slot]} → ${resolved.item ?? '无'}`);
	}
	return {
		patch: { outfit: outfitPatch },
		message: `更换穿着：${changes.join('；')}`
	};
}

/** 当前版本可用的槽位（未传规则 = 保持原有全量）。 */
function availableOutfitSlots(rules?: EditionRules): readonly OutfitSlot[] {
	return rules === undefined ? OUTFIT_SLOTS : rules.outfitSlots.map((slot) => slot.key);
}

/** 当前版本可用的槽位中文列表（用于错误提示）。 */
function availableSlotLabels(rules?: EditionRules): string {
	return availableOutfitSlots(rules)
		.map((slot) => SLOT_LABELS[slot])
		.join('/');
}

/** 解析单条换装指令，校验槽位与衣物类型，防止衣物错配到不合适的部位。 */
function resolveWear(
	wardrobe: ClothingItem[],
	assignment: WearAssignment,
	rules?: EditionRules
): { slot: OutfitSlot; item: string | null; error?: string } {
	const allowedSlots = availableOutfitSlots(rules);
	const itemVisible = (entry: ClothingItem): boolean =>
		rules === undefined || !isWardrobeItemHidden(entry, rules);
	if (assignment.slot === undefined && assignment.raw.includes('=')) {
		const alias = assignment.raw.slice(0, assignment.raw.indexOf('=')).trim();
		return {
			slot: 'top',
			item: null,
			error: `未知槽位「${alias}」，可用：${availableSlotLabels(rules)}`
		};
	}
	if (assignment.slot !== undefined && !allowedSlots.includes(assignment.slot)) {
		const alias = assignment.raw.slice(0, assignment.raw.indexOf('=')).trim();
		return {
			slot: 'top',
			item: null,
			error: `未知槽位「${alias}」，可用：${availableSlotLabels(rules)}`
		};
	}
	if (assignment.item === null) {
		if (assignment.slot === undefined) {
			return { slot: 'top', item: null, error: '脱掉衣物需要指定槽位，例如 /wear 上衣=无' };
		}
		return { slot: assignment.slot, item: null };
	}
	const item = wardrobe.find((entry) => entry.name === assignment.item && itemVisible(entry));
	if (item === undefined) {
		return {
			slot: 'top',
			item: null,
			error: `衣柜中没有「${assignment.item}」，可在「衣柜」页添加`
		};
	}
	if (assignment.slot === undefined) {
		const inferred = inferSlot(item);
		if (inferred === undefined || !allowedSlots.includes(inferred)) {
			return {
				slot: 'top',
				item: null,
				error: `无法确定「${item.name}」的槽位，请用 /wear 槽位=衣物 指定`
			};
		}
		return { slot: inferred, item: item.name };
	}
	const kindSlot = inferSlot(item);
	if (
		kindSlot !== undefined &&
		kindSlot !== assignment.slot &&
		allowedSlots.includes(kindSlot)
	) {
		return {
			slot: assignment.slot,
			item: null,
			error: `「${item.name}」是${SLOT_LABELS[kindSlot]}，不能穿在${SLOT_LABELS[assignment.slot]}槽位`
		};
	}
	return { slot: assignment.slot, item: item.name };
}

/** 根据衣物 kind 推断槽位；accessory/any/未标注 无法推断。 */
function inferSlot(item: ClothingItem): OutfitSlot | undefined {
	if (item.kind !== undefined && OUTFIT_SLOTS.includes(item.kind as OutfitSlot)) {
		return item.kind as OutfitSlot;
	}
	return undefined;
}

/** /help 的完整命令说明。 */
function helpText(): string {
	return [
		'可用 RP 快捷命令：',
		'/goto 地点 — 切换当前地点（如 /goto 食堂，或 分类>名称）',
		'/wear 槽位=衣物 — 更换穿着（如 /wear 上衣=黑色卫衣，或用 /wear 黑色卫衣 自动识别槽位）',
		'/wear 槽位=无 — 脱掉该槽位衣物',
		'/time +30 — 推进/回拨世界时间（分钟）',
		'/checkpoint 描述 — 保存一个手动检查点',
		'/help — 显示本帮助'
	].join('\n');
}
