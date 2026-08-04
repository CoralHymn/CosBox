import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import {
	formatAttributes,
	formatOutfit,
	formatPlaces,
	formatWardrobe,
	findWardrobeItem,
	summarizeSchedule,
	summarizeState
} from './state-summary';

describe('formatOutfit', () => {
	it('按穿戴顺序拼接所有槽位', () => {
		expect(
			formatOutfit({
				headwear: '贝雷帽',
				top: '衬衫',
				underwear: '白色内衣',
				underpants: '白色内裤',
				bottom: '裙子',
				socks: '白袜',
				shoes: '皮鞋',
				accessories: ['发带', '手表'],
				wardrobe: []
			})
		).toBe('贝雷帽、衬衫、白色内衣、白色内裤、裙子、白袜、皮鞋、发带、手表');
	});

	it('空字符串槽位被过滤', () => {
		expect(
			formatOutfit({
				headwear: '',
				top: '衬衫',
				underwear: null,
				underpants: null,
				bottom: '',
				socks: '',
				shoes: null,
				accessories: [],
				wardrobe: []
			})
		).toBe('衬衫');
	});

	it('全空时返回占位文案', () => {
		expect(
			formatOutfit({
				headwear: null,
				top: null,
				underwear: null,
				underpants: null,
				bottom: null,
				socks: null,
				shoes: null,
				accessories: [],
				wardrobe: []
			})
		).toBe('（无穿着描述）');
	});
});

describe('formatPlaces', () => {
	it('渲染带大类的地点库', () => {
		expect(
			formatPlaces([
				{ id: 'gate', category: '学校', name: '学院正门', description: '樱花道尽头' },
				{ id: 'lib', category: '学校', name: '图书馆', description: '三楼有禁书区' }
			])
		).toBe('学校 > 学院正门（樱花道尽头）；学校 > 图书馆（三楼有禁书区）');
	});

	it('空地点库返回占位文案', () => {
		expect(formatPlaces([])).toBe('（暂无已知地点）');
	});

	it('未分类地点不带前缀', () => {
		expect(formatPlaces([{ id: 'p', category: '', name: '海边', description: '涨潮' }])).toBe(
			'海边（涨潮）'
		);
	});
});

describe('formatWardrobe', () => {
	it('渲染带大类的衣柜条目', () => {
		expect(
			formatWardrobe([
				{ id: 'a', category: '常服', name: '白色衬衫', description: '领口带细蕾丝' },
				{ id: 'b', category: '运动服', name: '黑色卫衣', description: '胸前有印花' }
			])
		).toBe('常服 > 白色衬衫：领口带细蕾丝；运动服 > 黑色卫衣：胸前有印花');
	});

	it('空衣柜返回占位文案', () => {
		expect(formatWardrobe([])).toBe('（衣柜为空）');
	});

	it('未分类衣物不带前缀', () => {
		expect(formatWardrobe([{ id: 'a', category: '', name: '披肩', description: '薄纱' }])).toBe(
			'披肩：薄纱'
		);
	});
});

describe('findWardrobeItem', () => {
	it('按名称命中衣柜条目', () => {
		expect(
			findWardrobeItem(
				[{ id: 'a', category: '常服', name: '白色衬衫', description: '领口带细蕾丝' }],
				'白色衬衫'
			)?.description
		).toBe('领口带细蕾丝');
	});

	it('未命中返回 undefined', () => {
		expect(findWardrobeItem([], '不存在')).toBeUndefined();
	});
});

describe('formatAttributes', () => {
	it('渲染键值对', () => {
		expect(formatAttributes({ name: '绫音', age: 17, trust: true })).toBe(
			'name:绫音，age:17，trust:true'
		);
	});

	it('空表返回占位文案', () => {
		expect(formatAttributes({})).toBe('（无属性）');
	});
});

describe('summarizeSchedule', () => {
	it('按时段排序渲染', () => {
		const schedule = {
			time: { day: 0, hour: 8, minute: 0 },
			entries: [
				{ id: 'b', day: 0, start: 600, end: 660, title: '午休' },
				{ id: 'a', day: 0, start: 480, end: 540, title: '晨会' }
			]
		};
		expect(summarizeSchedule(schedule)).toBe('周一 08:00-09:00 晨会；周一 10:00-11:00 午休');
	});

	it('空日程返回占位文案', () => {
		expect(summarizeSchedule({ time: { day: 0, hour: 0, minute: 0 }, entries: [] })).toBe(
			'今日无安排'
		);
	});

	it('非法 day 渲染为 ?', () => {
		const schedule = {
			time: { day: 0, hour: 0, minute: 0 },
			entries: [{ id: 'x', day: 9, start: 60, end: 120, title: '异常' }]
		};
		expect(summarizeSchedule(schedule)).toBe('? 01:00-02:00 异常');
	});
});

describe('summarizeState', () => {
	it('输出包含全部关键行的结构化摘要', () => {
		const text = summarizeState(createInitialState());
		expect(text).toContain('【当前状态】');
		expect(text).toContain('时间：周一 08:00');
		expect(text).toContain('地点：学校 > 学院正门');
		expect(text).toContain('穿着：白色衬衫');
		expect(text).toContain('属性：name:绫音');
		expect(text).toContain('今日日程：周一 08:00-09:00 晨会');
		expect(text).toContain('【已知地点】学校 > 学院正门（樱花道尽头的校门，晨间常有学生出入）');
		expect(text).toContain('【衣柜】常服 > 白色衬衫：白色棉质衬衫，领口带细蕾丝，袖口挽起两折');
	});
});
