import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from './types';
import {
	buildGenerationSystemPrompt,
	buildImportPatch,
	buildReviewTool,
	GeneratorService,
	itemKeyFor,
	parseGeneratedItems,
	reviewGeneratedItems,
	WORLDVIEW_PRESETS,
	type GeneratedItem
} from './generator';

const config: LlmConfig = { ...DEFAULT_LLM_CONFIG };

describe('buildGenerationSystemPrompt', () => {
	it('地点：包含任务、世界观、格式与审查要求', () => {
		const prompt = buildGenerationSystemPrompt({
			kind: 'locations',
			worldview: 'ancient',
			requirements: '学园'
		});
		expect(prompt).toContain('【生成任务：地点库】');
		expect(prompt).toContain('【世界观：古代】');
		expect(prompt).toContain('禁止任何现代科技或现代建筑');
		expect(prompt).toContain('review_generation');
		expect(prompt).toContain('【用户要求】学园');
		// 大类按区域规划：小店铺合并进商业街，公共设施归入市中心/郊外
		expect(prompt).toContain('区域/地段');
		expect(prompt).toContain('商业街');
		expect(prompt).toContain('郊外');
	});

	it('衣柜：性别约束随请求注入', () => {
		const withGender = buildGenerationSystemPrompt({
			kind: 'wardrobe',
			worldview: 'modern',
			gender: '女',
			requirements: '日常'
		});
		expect(withGender).toContain('【生成任务：衣柜】');
		expect(withGender).toContain('角色性别：女');
		const withoutGender = buildGenerationSystemPrompt({
			kind: 'wardrobe',
			worldview: 'fantasy',
			requirements: '日常'
		});
		expect(withoutGender).toContain('角色性别：不限');
	});

	it('日程：输出格式使用 HH:MM', () => {
		const prompt = buildGenerationSystemPrompt({
			kind: 'schedule',
			worldview: 'modern',
			requirements: '一天'
		});
		expect(prompt).toContain('【生成任务：日程表】');
		expect(prompt).toContain('"HH:MM"');
	});
});

describe('itemKeyFor / buildImportPatch', () => {
	it('按名称去重并按类型合并，缺失 id 补全', () => {
		const existing: GeneratedItem[] = [
			{ id: 'p1', category: '学校', name: '食堂', description: 'a' }
		];
		const incoming: GeneratedItem[] = [
			{ category: '学校', name: '食堂', description: 'b' },
			{ category: '校外', name: '车站', description: 'c' }
		] as GeneratedItem[];
		const patch = buildImportPatch('locations', incoming, existing);
		expect(patch.places).toHaveLength(2);
		expect(patch.places![0]!.id).toBe('p1');
		expect(patch.places![1]!.name).toBe('车站');
		expect(patch.places![1]!.id).not.toBe('');
	});

	it('衣柜与日程分别合并到对应字段', () => {
		const wardrobe = buildImportPatch(
			'wardrobe',
			[{ category: '常服', kind: 'top', name: '衬衫', description: 'x' }] as GeneratedItem[],
			[]
		);
		expect(wardrobe.wardrobe).toHaveLength(1);
		const schedule = buildImportPatch(
			'schedule',
			[{ day: 0, start: 480, end: 540, title: '晨会' }] as GeneratedItem[],
			[]
		);
		expect(schedule.scheduleEntries).toHaveLength(1);
		expect(schedule.scheduleEntries![0]!.start).toBe(480);
	});

	it('itemKeyFor 按类型取键', () => {
		expect(itemKeyFor('locations', { id: 'a', category: '', name: '食堂', description: '' })).toBe(
			'食堂'
		);
		expect(
			itemKeyFor('wardrobe', { id: 'a', category: '', kind: 'top', name: '衬衫', description: '' })
		).toBe('衬衫');
		expect(itemKeyFor('schedule', { id: 'a', day: 0, start: 0, end: 1, title: '晨会' })).toBe(
			'晨会'
		);
	});
});

describe('parseGeneratedItems / reviewGeneratedItems', () => {
	it('解析合法 JSON 数组并归一化', () => {
		const result = parseGeneratedItems(
			'locations',
			JSON.stringify([{ category: '学校', name: '食堂', description: '咖喱饭' }])
		);
		expect(result.items).toHaveLength(1);
		expect(result.issues).toEqual([]);
		expect((result.items[0] as { name: string }).name).toBe('食堂');
	});

	it('解析失败 / 非数组返回问题', () => {
		expect(parseGeneratedItems('locations', 'not-json').issues).toEqual(['输出不是合法的 JSON']);
		expect(parseGeneratedItems('locations', '{}').issues).toEqual(['输出不是 JSON 数组']);
	});

	it('非法条目跳过并收集问题', () => {
		const result = parseGeneratedItems(
			'wardrobe',
			JSON.stringify([{ category: '常服', name: '', kind: 'top', description: 'x' }, 42])
		);
		expect(result.items).toEqual([]);
		expect(result.issues.length).toBeGreaterThan(0);
	});

	it('地点缺少名称、衣柜 kind 非法/合法均正确处理', () => {
		const location = parseGeneratedItems('locations', JSON.stringify([{}]));
		expect(location.items).toEqual([]);
		expect(location.issues.some((issue) => issue.includes('缺少地点名称'))).toBe(true);

		const wardrobe = parseGeneratedItems(
			'wardrobe',
			JSON.stringify([
				{ category: '常服', kind: 'top', name: '衬衫', description: 'x' },
				{ category: '常服', kind: 'cape', name: '披风', description: 'x' }
			])
		);
		expect(wardrobe.items).toHaveLength(1);
		expect((wardrobe.items[0] as { name: string }).name).toBe('衬衫');
		expect(wardrobe.issues.some((issue) => issue.includes('kind 非法'))).toBe(true);
	});

	it('审查：古代世界观发现现代元素', () => {
		const items: GeneratedItem[] = [
			{ id: 'a', category: '书院', name: '讲堂', description: '朴素的大厅' },
			{ id: 'b', category: '校外', name: '机场', description: '现代设施' }
		];
		const issues = reviewGeneratedItems('locations', items, 'ancient');
		expect(issues.some((issue) => issue.includes('机场'))).toBe(true);
		expect(issues.some((issue) => issue.includes('讲堂'))).toBe(false);
	});

	it('审查：重名与非法条目', () => {
		const items: GeneratedItem[] = [
			{ id: 'a', category: '', name: '食堂', description: 'x' },
			{ id: 'b', category: '', name: '食堂', description: 'y' }
		];
		const issues = reviewGeneratedItems('locations', items, 'modern');
		expect(issues.some((issue) => issue.includes('名称重复'))).toBe(true);
	});

	it('审查：场所类型被当作大类时提示合并进区域', () => {
		const issues = reviewGeneratedItems(
			'locations',
			[
				{ id: 'a', category: '奶茶店', name: 'XX奶茶', description: 'x' },
				{ id: 'b', category: '咖啡厅', name: '云朵咖啡屋', description: 'x' }
			],
			'modern'
		);
		expect(issues.some((issue) => issue.includes('场所类型'))).toBe(true);
		expect(issues.some((issue) => issue.includes('商业街'))).toBe(true);
	});

	it('审查：区域式大类（商业街/市中心/郊外）不提示', () => {
		const issues = reviewGeneratedItems(
			'locations',
			[
				{ id: 'a', category: '商业街', name: '中央商店街', description: 'x' },
				{ id: 'b', category: '郊外', name: '银沙海滨浴场', description: 'x' },
				{ id: 'c', category: '市中心', name: '城市历史博物馆', description: 'x' }
			],
			'modern'
		);
		expect(issues).toEqual([]);
	});

	it('现代世界观无禁词', () => {
		const issues = reviewGeneratedItems(
			'locations',
			[{ id: 'a', category: '学校', name: '食堂', description: 'x' }],
			'modern'
		);
		expect(issues).toEqual([]);
	});

	it('日程时间与 day 校验', () => {
		const bad = parseGeneratedItems(
			'schedule',
			JSON.stringify([
				{ day: 7, title: '', start: '09:00', end: '08:00' },
				{ day: 0, title: '晨会', start: '25:00', end: '08:00' }
			])
		);
		expect(bad.items).toEqual([]);
		expect(bad.issues.length).toBeGreaterThan(1);

		const good = parseGeneratedItems(
			'schedule',
			JSON.stringify([{ day: 2, title: '自习', start: '15:30', end: 1020, locationId: 'lib' }])
		);
		expect(good.items).toHaveLength(1);
		expect((good.items[0] as { start: number }).start).toBe(930);
		expect((good.items[0] as { locationId?: string }).locationId).toBe('lib');

		const weird = parseGeneratedItems(
			'schedule',
			JSON.stringify([
				{ day: 0, title: 'x', start: true, end: '08:00' },
				{ day: 0, title: 'y', start: 'abc', end: '09:00' }
			])
		);
		expect(weird.items).toEqual([]);
		expect(weird.issues).toHaveLength(2);
	});

	it('审查时非法条目直接跳过', () => {
		const issues = reviewGeneratedItems(
			'locations',
			[{ id: '', category: '', name: '', description: '' }] as GeneratedItem[],
			'modern'
		);
		expect(issues.some((issue) => issue.includes('缺少地点名称'))).toBe(true);
	});
});

describe('buildReviewTool', () => {
	it('items 非数组返回失败', () => {
		const tool = buildReviewTool('locations', 'modern');
		const result = tool.execute({});
		expect(result.issues).toEqual(['items 必须是数组']);
		expect(result.output).toContain('审查失败');
	});

	it('审查通过 / 发现问题', () => {
		const pass = buildReviewTool('locations', 'modern').execute({
			items: [{ category: '学校', name: '食堂', description: 'x' }]
		});
		expect(pass.issues).toEqual([]);
		expect(pass.output).toContain('审查通过：1 项');

		const fail = buildReviewTool('locations', 'ancient').execute({
			items: [{ category: '校外', name: '机场', description: 'x' }]
		});
		expect(fail.issues.length).toBeGreaterThan(0);
		expect(fail.output).toContain('审查发现');
	});
});

describe('GeneratorService', () => {
	it('客户端不支持工具调用时抛错', async () => {
		const service = new GeneratorService({ chat: vi.fn() });
		await expect(
			service.generate({ kind: 'locations', worldview: 'modern', requirements: 'x' }, config)
		).rejects.toThrow('不支持工具调用');
	});

	it('审查工具循环：调用审查 → 输出最终 JSON → 返回条目', async () => {
		const chatWithTools = vi
			.fn()
			.mockResolvedValueOnce({
				content: null,
				toolCalls: [
					{
						id: 'c1',
						name: 'review_generation',
						arguments: { items: [{ category: '学校', name: '食堂', description: 'x' }] }
					}
				]
			})
			.mockResolvedValueOnce({
				content: JSON.stringify([{ category: '学校', name: '食堂', description: 'x' }]),
				toolCalls: []
			});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'modern', requirements: '食堂' },
			config
		);
		expect(result.items).toHaveLength(1);
		expect(result.issues).toEqual([]);
		const calls = vi.mocked(chatWithTools).mock.calls;
		expect(calls).toHaveLength(2);
		// 审查工具声明已注册
		const tools = calls[0]![1] as Array<{ name: string }>;
		expect(tools[0]!.name).toBe('review_generation');
	});

	it('审查发现问题后模型修正再提交', async () => {
		const chatWithTools = vi
			.fn()
			.mockResolvedValueOnce({
				content: null,
				toolCalls: [
					{
						id: 'c1',
						name: 'review_generation',
						arguments: { items: [{ category: '校外', name: '机场', description: 'x' }] }
					}
				]
			})
			.mockResolvedValueOnce({
				content: JSON.stringify([{ category: '书院', name: '讲堂', description: 'x' }]),
				toolCalls: []
			});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'ancient', requirements: '书院' },
			config
		);
		expect((result.items[0] as { name: string }).name).toBe('讲堂');
		expect(result.issues).toEqual([]);
	});

	it('未知工具名称回馈模型', async () => {
		const chatWithTools = vi
			.fn()
			.mockResolvedValueOnce({
				content: null,
				toolCalls: [{ id: 'c1', name: 'fly', arguments: {} }]
			})
			.mockResolvedValueOnce({
				content: JSON.stringify([{ category: '学校', name: '食堂', description: 'x' }]),
				toolCalls: []
			});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'modern', requirements: 'x' },
			config
		);
		expect(result.items).toHaveLength(1);
		// 第二轮消息里包含未知工具提示
		const messages = vi.mocked(chatWithTools).mock.calls[1]![0] as Array<{ content: string }>;
		expect(messages.some((m) => m.content.includes('未知工具：fly'))).toBe(true);
	});

	it('最终输出解析失败时提示模型重试', async () => {
		const chatWithTools = vi
			.fn()
			.mockResolvedValueOnce({ content: 'not json', toolCalls: [] })
			.mockResolvedValueOnce({
				content: JSON.stringify([{ category: '学校', name: '食堂', description: 'x' }]),
				toolCalls: []
			});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'modern', requirements: 'x' },
			config
		);
		expect(result.items).toHaveLength(1);
		const messages = vi.mocked(chatWithTools).mock.calls[1]![0] as Array<{ content: string }>;
		expect(messages.some((m) => m.content.includes('输出解析失败'))).toBe(true);
	});

	it('超过轮数回退到最后一次审查结果', async () => {
		const chatWithTools = vi.fn().mockResolvedValue({
			content: null,
			toolCalls: [
				{
					id: 'c',
					name: 'review_generation',
					arguments: { items: [{ category: '校外', name: '机场', description: 'x' }] }
				}
			]
		});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'ancient', requirements: 'x' },
			config
		);
		expect(result.items).toHaveLength(1);
		expect(result.issues.some((issue) => issue.includes('机场'))).toBe(true);
	});

	it('超过轮数且无任何审查结果时给出重试提示', async () => {
		const chatWithTools = vi.fn().mockResolvedValue({
			content: null,
			toolCalls: [
				{
					id: 'c',
					name: 'review_generation',
					arguments: { items: [{ category: '学校', name: '食堂', description: 'x' }] }
				}
			]
		});
		const service = new GeneratorService({ chat: vi.fn(), chatWithTools });
		const result = await service.generate(
			{ kind: 'locations', worldview: 'modern', requirements: 'x' },
			config
		);
		expect(result.items).toHaveLength(1);
		expect(result.issues).toEqual(['生成未在限定轮数内完成，请重试']);
	});
});

describe('WORLDVIEW_PRESETS', () => {
	it('古代与奇幻包含禁词，现代为空', () => {
		expect(WORLDVIEW_PRESETS.ancient.bannedKeywords.length).toBeGreaterThan(0);
		expect(WORLDVIEW_PRESETS.fantasy.bannedKeywords.length).toBeGreaterThan(0);
		expect(WORLDVIEW_PRESETS.modern.bannedKeywords).toEqual([]);
	});
});
