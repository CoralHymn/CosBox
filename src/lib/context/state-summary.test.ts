import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import { formatAttributes, formatOutfit, summarizeSchedule, summarizeState } from './state-summary';

describe('formatOutfit', () => {
	it('拼接所有槽位', () => {
		expect(
			formatOutfit({ top: '衬衫', bottom: '裙子', shoes: '皮鞋', accessories: ['发带', '手表'] })
		).toBe('衬衫、裙子、皮鞋、发带、手表');
	});

	it('空字符串槽位被过滤', () => {
		expect(formatOutfit({ top: '衬衫', bottom: '', shoes: null, accessories: [] })).toBe('衬衫');
	});

	it('全空时返回占位文案', () => {
		expect(formatOutfit({ top: null, bottom: null, shoes: null, accessories: [] })).toBe(
			'（无穿着描述）'
		);
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
		expect(text).toContain('地点：学院正门');
		expect(text).toContain('穿着：白色衬衫');
		expect(text).toContain('属性：name:绫音');
		expect(text).toContain('今日日程：周一 08:00-09:00 晨会');
	});
});
