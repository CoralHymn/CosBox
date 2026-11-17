/**
 * 版本显示规则（Web / 桌面）。
 *
 * Web 版 = 浏览器直接打开；桌面版 = Tauri WebView。判定在运行时完成，
 * 不使用构建期常量，因此 dev / preview 与 Tauri 共用同一套代码。
 *
 * 所有「哪些槽位可见、哪些文案可用、系统提示是否过滤敏感穿着」的决策
 * 都集中在这里，组件与上下文管道只消费规则，不再散落 if。
 */

import type { StateSummaryOptions } from '../context/state-summary';
import { CLOTHING_KINDS } from '../core/state';
import type { ClothingItem, ClothingKind, OutfitSlot } from '../core/types';
import { isTauri } from './updater';

/** 运行版本：浏览器打开的 Web 版，或 Tauri 桌面/移动壳。 */
export type Edition = 'web' | 'desktop';

/** 一个可显示的穿着槽位。 */
export interface EditionOutfitSlot {
	key: OutfitSlot;
	label: string;
}

/** 版本显示规则表。 */
export interface EditionRules {
	edition: Edition;
	/** 可显示的穿着槽位（顺序与状态面板一致）。 */
	outfitSlots: readonly EditionOutfitSlot[];
	/** 是否展示私密穿着槽位（内衣 / 内裤）。 */
	showSensitiveSlots: boolean;
	/** 可选的衣物类型（衣柜下拉与 AI 生成共用）。 */
	clothingKinds: readonly ClothingKind[];
	/** 提示词页「叙事规则」的标签（两版一致，且不再使用旧称谓）。 */
	promptRuleLabel: string;
	/** 系统提示词说明文案。 */
	promptRuleHint: string;
	/** 全年龄提示；桌面版为空串（不展示）。 */
	contentNotice: string;
	/** 需要从界面与系统提示中隐藏的词（Web 版非空）。 */
	hiddenKeywords: readonly string[];
}

const ALL_SLOTS: readonly EditionOutfitSlot[] = [
	{ key: 'headwear', label: '帽子' },
	{ key: 'top', label: '上衣' },
	{ key: 'underwear', label: '内衣' },
	{ key: 'underpants', label: '内裤' },
	{ key: 'bottom', label: '下装' },
	{ key: 'socks', label: '袜子' },
	{ key: 'shoes', label: '鞋' }
];

const PUBLIC_SLOTS: readonly EditionOutfitSlot[] = ALL_SLOTS.filter(
	(slot) => slot.key !== 'underwear' && slot.key !== 'underpants'
);

const PUBLIC_CLOTHING_KINDS: readonly ClothingKind[] = CLOTHING_KINDS.filter(
	(kind) => kind !== 'underwear' && kind !== 'underpants'
);

/** 两版共用的「叙事规则」标签：公开仓库与全年龄展示均不再出现旧称谓。 */
const PROMPT_RULE_LABEL = '叙事规则';

/** 规则表：Web 版收敛为全年龄可展示范围，桌面版保留完整能力。 */
export const EDITION_RULES: Record<Edition, EditionRules> = {
	web: {
		edition: 'web',
		outfitSlots: PUBLIC_SLOTS,
		showSensitiveSlots: false,
		clothingKinds: PUBLIC_CLOTHING_KINDS,
		promptRuleLabel: PROMPT_RULE_LABEL,
		promptRuleHint:
			'这里写下希望 AI 遵守的叙事规则，例如回复长短、互动边界与表达风格。留空时使用内置默认模板（角色身份 + 当前状态约束）。',
		contentNotice: '全年龄提示：本作内容以校园日常与成长叙事为主，不含成人向描写。',
		hiddenKeywords: ['内衣', '内裤']
	},
	desktop: {
		edition: 'desktop',
		outfitSlots: ALL_SLOTS,
		showSensitiveSlots: true,
		clothingKinds: CLOTHING_KINDS,
		promptRuleLabel: PROMPT_RULE_LABEL,
		promptRuleHint:
			'这里放系统提示词与叙事规则：可以描述话术边界、场景限制、互动尺度与文风要求。留空时使用内置默认模板（角色身份 + 当前状态约束）。',
		contentNotice: '',
		hiddenKeywords: []
	}
};

/** 当前运行版本：Tauri 内为桌面版，浏览器内为 Web 版。 */
export function getEdition(): Edition {
	return isTauri() ? 'desktop' : 'web';
}

/** 取当前（或指定）版本的规则表。 */
export function getEditionRules(edition: Edition = getEdition()): EditionRules {
	return EDITION_RULES[edition];
}

/** 槽位是否在当前版本可用。 */
export function isOutfitSlotVisible(slot: OutfitSlot, rules: EditionRules): boolean {
	return rules.outfitSlots.some((item) => item.key === slot);
}

/** 衣物类型是否在当前版本可用（未标注与 any 视为通用）。 */
export function isClothingKindAllowed(
	kind: ClothingKind | undefined,
	rules: EditionRules
): boolean {
	if (kind === undefined || kind === 'any') {
		return true;
	}
	return rules.clothingKinds.includes(kind);
}

/** 文本是否包含当前版本需要隐藏的词。 */
export function containsHiddenKeyword(text: string, rules: EditionRules): boolean {
	return rules.hiddenKeywords.some((keyword) => text.includes(keyword));
}

/**
 * 衣柜条目是否应从当前版本隐藏：
 * 类型不在允许范围，或分类 / 名称 / 描述命中隐藏词。
 * 仅影响展示与生成，不修改底层数据。
 */
export function isWardrobeItemHidden(
	item: Pick<ClothingItem, 'kind' | 'category' | 'name' | 'description'>,
	rules: EditionRules
): boolean {
	if (!isClothingKindAllowed(item.kind, rules)) {
		return true;
	}
	return [item.category, item.name, item.description].some((text) =>
		containsHiddenKeyword(text, rules)
	);
}

/** 生成状态摘要选项：Web 版过滤私密槽位与相关衣柜条目，桌面版保持默认全量。 */
export function stateSummaryOptionsFor(rules: EditionRules): StateSummaryOptions {
	return {
		slots: rules.outfitSlots.map((slot) => slot.key),
		wardrobeFilter: (item) => !isWardrobeItemHidden(item, rules)
	};
}