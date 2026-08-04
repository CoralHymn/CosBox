import { describe, expect, it } from 'vitest';
import { ImportError } from '../core/errors';
import type { WorldInfoEntry } from '../core/types';
import {
	buildCharaCardV3,
	mapCardToCosBox,
	parseCharaCard,
	serializeCharaCard,
	type CharaCardV3
} from './chara-card-v3';

function sampleCard(): CharaCardV3 {
	return {
		spec: 'chara_card_v3',
		spec_version: '3.0',
		data: {
			name: '绫音',
			description: '安静温柔的学园少女',
			personality: '内向、细心',
			scenario: '场景发生在樱花学园',
			system_prompt: '始终以绫音身份回应',
			first_mes: '初次见面，我是绫音。',
			alternate_greetings: ['备用问候'],
			tags: ['学园', '日常'],
			creator: '作者A',
			character_version: '1.0',
			character_book: {
				entries: [
					{ keys: ['图书馆'], content: '图书馆三楼是禁地', insertion_order: 42, enabled: true }
				]
			}
		}
	};
}

describe('parseCharaCard', () => {
	it('解析合法卡片', () => {
		const card = parseCharaCard(JSON.stringify(sampleCard()));
		expect(card.data.name).toBe('绫音');
	});

	it('非法 JSON 抛 ImportError', () => {
		expect(() => parseCharaCard('{oops')).toThrow(ImportError);
	});

	it('非对象输入抛 ImportError', () => {
		expect(() => parseCharaCard('"字符串"')).toThrow(ImportError);
		expect(() => parseCharaCard('null')).toThrow(ImportError);
	});

	it('错误 spec 抛 ImportError', () => {
		const card = { ...sampleCard(), spec: 'chara_card_v2' };
		expect(() => parseCharaCard(JSON.stringify(card))).toThrow(ImportError);
	});

	it('缺少 data.name 抛 ImportError', () => {
		const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {} };
		expect(() => parseCharaCard(JSON.stringify(card))).toThrow(ImportError);
	});
});

describe('mapCardToCosBox', () => {
	it('映射属性、世界信息、问候语与系统提示', () => {
		const mapped = mapCardToCosBox(sampleCard());
		expect(mapped.statePatch.attributes.name).toBe('绫音');
		expect(mapped.statePatch.attributes.tags).toBe('学园,日常');
		expect(mapped.statePatch.attributes.creator).toBe('作者A');
		expect(mapped.statePatch.attributes.character_version).toBe('1.0');
		expect(mapped.greeting).toBe('初次见面，我是绫音。');
		expect(mapped.systemPrompt).toBe('始终以绫音身份回应');
		const comments = mapped.worldInfo.map((w) => w.comment);
		expect(comments).toContain('角色背景');
		expect(comments).toContain('性格');
		expect(comments).toContain('场景设定');
		const book = mapped.worldInfo.find((w) => w.comment === undefined)!;
		expect(book.keys).toEqual(['图书馆']);
		expect(book.priority).toBe(42);
		expect(book.enabled).toBe(true);
	});

	it('first_mes 缺失时回退 alternate_greetings', () => {
		const card = sampleCard();
		delete card.data.first_mes;
		const mapped = mapCardToCosBox(card);
		expect(mapped.greeting).toBe('备用问候');
	});

	it('空白字段被跳过', () => {
		const card = sampleCard();
		card.data.description = '  ';
		delete card.data.first_mes;
		card.data.alternate_greetings = [];
		const mapped = mapCardToCosBox(card);
		expect(mapped.worldInfo.find((w) => w.comment === '角色背景')).toBeUndefined();
		expect(mapped.greeting).toBeNull();
	});

	it('constant 条目默认禁用', () => {
		const card = sampleCard();
		card.data.character_book = { entries: [{ keys: ['k'], content: 'c', constant: true }] };
		const mapped = mapCardToCosBox(card);
		expect(mapped.worldInfo.find((w) => w.keys[0] === 'k')!.enabled).toBe(false);
	});
});

describe('buildCharaCardV3 / serializeCharaCard', () => {
	function worldInfo(): WorldInfoEntry[] {
		return [
			{
				id: 'a',
				keys: ['绫音'],
				content: '安静温柔的学园少女',
				comment: '角色背景',
				enabled: true,
				priority: 100
			},
			{
				id: 'b',
				keys: ['绫音', '性格'],
				content: '内向',
				comment: '性格',
				enabled: true,
				priority: 90
			},
			{ id: 'c', keys: ['图书馆'], content: '三楼禁地', enabled: true, priority: 42 }
		];
	}

	it('反向映射回 V3 结构', () => {
		const card = buildCharaCardV3({
			name: '绫音',
			systemPrompt: '规则',
			worldInfo: worldInfo(),
			conversation: [
				{ id: '1', role: 'assistant', content: '初次见面。', timestamp: 1 },
				{ id: '2', role: 'user', content: '你好', timestamp: 2 }
			],
			creator: '作者A',
			characterVersion: '1.0',
			tags: ['日常']
		});
		expect(card.spec).toBe('chara_card_v3');
		expect(card.data.description).toBe('安静温柔的学园少女');
		expect(card.data.personality).toBe('内向');
		expect(card.data.system_prompt).toBe('规则');
		expect(card.data.first_mes).toBe('初次见面。');
		expect(card.data.creator).toBe('作者A');
		expect(card.data.tags).toEqual(['日常']);
		expect(card.data.character_book?.entries).toHaveLength(1);
		expect(card.data.character_book?.entries[0]!.keys).toEqual(['图书馆']);
		expect(card.data.character_book?.entries[0]!.insertion_order).toBe(42);
	});

	it('无标签与空世界书时省略字段', () => {
		const card = buildCharaCardV3({
			name: '绫音',
			systemPrompt: null,
			worldInfo: [],
			conversation: []
		});
		expect(card.data.tags).toBeUndefined();
		expect(card.data.character_book).toBeUndefined();
		expect(card.data.first_mes).toBeUndefined();
	});

	it('serializeCharaCard 输出可解析 JSON', () => {
		const text = serializeCharaCard(sampleCard());
		expect(JSON.parse(text)).toEqual(sampleCard());
	});

	it('导入再导出保持名字与描述', () => {
		const mapped = mapCardToCosBox(sampleCard());
		const exported = buildCharaCardV3({
			name: mapped.statePatch.attributes.name as string,
			systemPrompt: mapped.systemPrompt,
			worldInfo: mapped.worldInfo,
			conversation: [{ id: 'x', role: 'assistant', content: mapped.greeting!, timestamp: 1 }]
		});
		expect(exported.data.name).toBe('绫音');
		expect(exported.data.description).toBe('安静温柔的学园少女');
	});
});
