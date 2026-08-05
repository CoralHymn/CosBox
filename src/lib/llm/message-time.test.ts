import { describe, expect, it } from 'vitest';
import {
	annotateWorldTime,
	formatWorldTimeLabel,
	sanitizeAssistantText,
	WORLD_TIME_MARKER
} from './message-time';

describe('annotateWorldTime', () => {
	it('生成独占一行的元数据标注，正文保持独立', () => {
		expect(annotateWorldTime('好了快穿上吧', { day: 0, hour: 9, minute: 0 })).toBe(
			'【世界时间：周一 09:00】\n好了快穿上吧'
		);
	});

	it('空正文也保留元数据行', () => {
		expect(annotateWorldTime('', { day: 1, hour: 10, minute: 30 })).toBe(
			'【世界时间：周二 10:30】\n'
		);
	});

	it('标记常量用于系统提示识别', () => {
		expect(WORLD_TIME_MARKER).toBe('【世界时间：');
	});
});

describe('formatWorldTimeLabel', () => {
	it('输出调试视图的紧凑标注', () => {
		expect(formatWorldTimeLabel({ day: 0, hour: 9, minute: 5 })).toBe('（周一 09:05）');
	});
});

describe('sanitizeAssistantText', () => {
	it('剔除开头的完整标注行', () => {
		expect(sanitizeAssistantText('【世界时间：周一 12:00】\n我们到了')).toBe('我们到了');
	});

	it('剔除内联标注并保留前后文本', () => {
		expect(sanitizeAssistantText('（笑）【世界时间：周一 12:00】我们走吧')).toBe('（笑）我们走吧');
	});

	it('剔除多处标注', () => {
		expect(sanitizeAssistantText('【世界时间：周一 12:00】好\n【世界时间：周一 13:00】继续')).toBe(
			'好\n继续'
		);
	});

	it('标注独占一行时整行删除、保留正文结构', () => {
		expect(sanitizeAssistantText('【世界时间：周一 12:00】\n\n（伸懒腰）')).toBe('（伸懒腰）');
	});

	it('去掉回复开头的旧式时间前缀', () => {
		expect(sanitizeAssistantText('（周一 12:00）我们到了')).toBe('我们到了');
	});

	it('正文中的括号时间不被误删', () => {
		expect(sanitizeAssistantText('（周一见，记得带伞）')).toBe('（周一见，记得带伞）');
	});

	it('无标注原样返回（去除首尾空白）', () => {
		expect(sanitizeAssistantText('  正常回复  ')).toBe('正常回复');
	});
});
