import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauriMock } = vi.hoisted(() => ({ isTauriMock: vi.fn<() => boolean>() }));

vi.mock('./updater', () => ({ isTauri: isTauriMock }));

import { buildContext } from '../context/pipeline';
import { summarizeState } from '../context/state-summary';
import { createInitialState } from '../core/state';
import { buildGenerationSystemPrompt, parseGeneratedItems } from '../llm/generator';
import { buildSetOutfitTool, STATE_TOOLS } from '../llm/state-tools';
import {
	EDITION_RULES,
	getEdition,
	getEditionRules,
	isClothingKindAllowed,
	isOutfitSlotVisible,
	isWardrobeItemHidden,
	stateSummaryOptionsFor
} from './edition';

describe('getEdition', () => {
	beforeEach(() => {
		isTauriMock.mockReset();
	});

	it('浏览器环境为 web，Tauri 环境为 desktop', () => {
		isTauriMock.mockReturnValue(false);
		expect(getEdition()).toBe('web');
		isTauriMock.mockReturnValue(true);
		expect(getEdition()).toBe('desktop');
	});
});

describe('EDITION_RULES', () => {
	it('Web 版隐藏私密槽位，桌面版保留全部且顺序与状态面板一致', () => {
		expect(EDITION_RULES.web.outfitSlots.map((slot) => slot.key)).toEqual([
			'headwear',
			'top',
			'bottom',
			'socks',
			'shoes'
		]);
		expect(EDITION_RULES.desktop.outfitSlots.map((slot) => slot.key)).toEqual([
			'headwear',
			'top',
			'underwear',
			'underpants',
			'bottom',
			'socks',
			'shoes'
		]);
		expect(EDITION_RULES.web.showSensitiveSlots).toBe(false);
		expect(EDITION_RULES.desktop.showSensitiveSlots).toBe(true);
	});

	it('两版都使用「叙事规则」且不再出现旧称谓', () => {
		const legacyLabel = ['破', '甲', '词'].join('');
		for (const rules of Object.values(EDITION_RULES)) {
			expect(rules.promptRuleLabel).toBe('叙事规则');
			expect(rules.promptRuleHint).not.toContain(legacyLabel);
		}
	});

	it('内容提示仅 Web 版展示', () => {
		expect(EDITION_RULES.web.contentNotice).not.toBe('');
		expect(EDITION_RULES.desktop.contentNotice).toBe('');
	});

	it('Web 版衣物类型不含私密类型', () => {
		expect(EDITION_RULES.web.clothingKinds).not.toContain('underwear');
		expect(EDITION_RULES.web.clothingKinds).not.toContain('underpants');
		expect(EDITION_RULES.desktop.clothingKinds).toContain('underwear');
		expect(EDITION_RULES.desktop.clothingKinds).toContain('underpants');
	});
});

describe('版本过滤 helper', () => {
	it('槽位与衣物类型按规则判断', () => {
		expect(isOutfitSlotVisible('underwear', EDITION_RULES.web)).toBe(false);
		expect(isOutfitSlotVisible('underwear', EDITION_RULES.desktop)).toBe(true);
		expect(isClothingKindAllowed('underpants', EDITION_RULES.web)).toBe(false);
		expect(isClothingKindAllowed('underpants', EDITION_RULES.desktop)).toBe(true);
		expect(isClothingKindAllowed(undefined, EDITION_RULES.web)).toBe(true);
		expect(isClothingKindAllowed('any', EDITION_RULES.web)).toBe(true);
	});

	it('衣柜条目按类型或文本命中隐藏', () => {
		const sensitiveKind = {
			kind: 'underwear' as const,
			category: '常服',
			name: '白色棉质内衣',
			description: '纯棉'
		};
		const sensitiveText = {
			kind: 'top' as const,
			category: '常服',
			name: '白色衬衫',
			description: '可作内裤替代'
		};
		const normal = {
			kind: 'top' as const,
			category: '常服',
			name: '白色衬衫',
			description: '纯棉'
		};
		expect(isWardrobeItemHidden(sensitiveKind, EDITION_RULES.web)).toBe(true);
		expect(isWardrobeItemHidden(sensitiveText, EDITION_RULES.web)).toBe(true);
		expect(isWardrobeItemHidden(normal, EDITION_RULES.web)).toBe(false);
		expect(isWardrobeItemHidden(sensitiveKind, EDITION_RULES.desktop)).toBe(false);
	});
});

describe('Web 版系统提示合规', () => {
	const webOptions = stateSummaryOptionsFor(EDITION_RULES.web);

	it('状态摘要不含私密穿着，且不修改底层数据', () => {
		const state = createInitialState();
		const text = summarizeState(state, webOptions);
		expect(text).not.toContain('内衣');
		expect(text).not.toContain('内裤');
		expect(text).toContain('上衣：白色衬衫');
		// 纯函数：原状态保留敏感槽位数据，导出/后续快照不丢。
		expect(state.outfit.underwear).toBe('白色棉质内衣');
		expect(state.outfit.underpants).toBe('白色棉质内裤');
		expect(state.outfit.wardrobe.some((item) => item.kind === 'underwear')).toBe(true);
	});

	it('buildContext 组装出的系统提示不含私密穿着', () => {
		const bundle = buildContext({
			state: createInitialState(),
			conversation: [{ id: '1', role: 'user', content: '早上好', timestamp: 1 }],
			worldInfo: [],
			stateSummaryOptions: webOptions
		});
		expect(bundle.systemMessage).not.toContain('内衣');
		expect(bundle.systemMessage).not.toContain('内裤');
		expect(bundle.systemMessage).toContain('上衣：白色衬衫');
	});

	it('桌面规则保持全量摘要', () => {
		const text = summarizeState(
			createInitialState(),
			stateSummaryOptionsFor(EDITION_RULES.desktop)
		);
		expect(text).toContain('内衣');
		expect(text).toContain('内裤');
	});
});

describe('getEditionRules', () => {
	it('返回指定版本的同一份规则表', () => {
		isTauriMock.mockReset();
		isTauriMock.mockReturnValue(true);
		expect(getEditionRules()).toBe(EDITION_RULES.desktop);
		isTauriMock.mockReturnValue(false);
		expect(getEditionRules()).toBe(EDITION_RULES.web);
	});
});

describe('桌面版保持完整能力', () => {
	it('工具描述与执行都保留私密槽位', async () => {
		const tool = buildSetOutfitTool(EDITION_RULES.desktop);
		expect(tool.description).toContain('underwear');
		expect(tool.description).toContain('内衣');
		expect(tool.description).toContain('内裤');

		const state = createInitialState();
		let updated: unknown = null;
		const ctx = {
			getState: () => state,
			update: async (patch: unknown) => {
				updated = patch;
				return null;
			},
			advanceTime: async () => null
		};
		const output = await tool.execute({ slot: 'underwear', item: '白色棉质内衣' }, ctx);
		expect(output).toContain('内衣');
		expect(updated).toEqual({ outfit: { underwear: '白色棉质内衣' } });
	});

	it('默认工具实例（既有调用方）仍为全量槽位', () => {
		const tool = STATE_TOOLS.find((item) => item.name === 'set_outfit');
		expect(tool?.description).toContain('内衣');
		expect(tool?.description).toContain('内裤');
	});
});

describe('Web 版工具与生成路径', () => {
	it('set_outfit 描述与执行都不接受私密槽位/条目', async () => {
		const tool = buildSetOutfitTool(EDITION_RULES.web);
		expect(tool.description).not.toContain('内衣');
		expect(tool.description).not.toContain('内裤');

		const state = createInitialState();
		let updated: unknown = null;
		const ctx = {
			getState: () => state,
			update: async (patch: unknown) => {
				updated = patch;
				return null;
			},
			advanceTime: async () => null
		};
		await expect(
			tool.execute({ slot: 'underwear', item: '白色棉质内衣' }, ctx)
		).rejects.toThrow('未知槽位');
		await expect(tool.execute({ item: '白色棉质内衣' }, ctx)).rejects.toThrow('未知槽位');
		expect(updated).toBeNull();
	});

	it('衣柜生成提示与解析都排除私密类型', () => {
		const system = buildGenerationSystemPrompt({
			kind: 'wardrobe',
			worldview: 'modern',
			allowedClothingKinds: EDITION_RULES.web.clothingKinds,
			requirements: ''
		});
		expect(system).not.toContain('内衣');
		expect(system).not.toContain('内裤');

		const parsed = parseGeneratedItems(
			'wardrobe',
			JSON.stringify([{ kind: 'underwear', name: '白色棉质内衣', description: '纯棉' }]),
			EDITION_RULES.web.clothingKinds
		);
		expect(parsed.items).toHaveLength(0);
		expect(parsed.issues.length).toBeGreaterThan(0);
	});
});