import { describe, expect, it } from 'vitest';
import { StateValidationError } from './errors';
import {
	addMinutes,
	applyStateDelta,
	createInitialScheduleEntries,
	createInitialState,
	currentScheduleEntry,
	describeCurrentActivity,
	formatMinutesOfDay,
	formatWorldTime,
	isValidWorldTime,
	minutesSinceMidnight,
	normalizeWorldTime,
	validateCharacterState
} from './state';
import type { ScheduleEntry, WorldTime } from './types';

function validTime(): WorldTime {
	return { day: 0, hour: 8, minute: 0 };
}

describe('createInitialState', () => {
	it('返回完整且合法的初始状态', () => {
		const state = createInitialState();
		expect(() => validateCharacterState(state)).not.toThrow();
		expect(state.attributes.name).toBe('绫音');
		expect(state.schedule.entries.length).toBeGreaterThan(0);
	});

	it('每次调用返回全新对象，互不共享引用', () => {
		const a = createInitialState();
		const b = createInitialState();
		expect(a).not.toBe(b);
		expect(a.outfit).not.toBe(b.outfit);
	});
});

describe('createInitialScheduleEntries', () => {
	it('生成可校验的默认日程', () => {
		const entries = createInitialScheduleEntries();
		expect(entries.length).toBe(3);
		for (const entry of entries) {
			expect(entry.start).toBeLessThan(entry.end);
		}
	});
});

describe('applyStateDelta', () => {
	it('浅合并 outfit 槽位并整体替换 accessories', () => {
		const state = createInitialState();
		const next = applyStateDelta(state, {
			outfit: { top: '黑色卫衣', accessories: ['围巾'] }
		});
		expect(next.outfit.top).toBe('黑色卫衣');
		expect(next.outfit.bottom).toBe(state.outfit.bottom);
		expect(next.outfit.accessories).toEqual(['围巾']);
	});

	it('浅合并 location', () => {
		const state = createInitialState();
		const next = applyStateDelta(state, { location: { id: 'lib', name: '图书馆' } });
		expect(next.location.name).toBe('图书馆');
		expect(next.location.description).toBe(state.location.description);
	});

	it('整体替换 schedule.entries 与 time', () => {
		const state = createInitialState();
		const entries: ScheduleEntry[] = [{ id: 'x', day: 2, start: 60, end: 120, title: '自习' }];
		const next = applyStateDelta(state, {
			schedule: { time: { day: 2, hour: 9, minute: 0 }, entries }
		});
		expect(next.schedule.time.day).toBe(2);
		expect(next.schedule.entries).toEqual(entries);
		expect(next.schedule.entries).not.toBe(entries);
	});

	it('按 key 合并 attributes', () => {
		const state = createInitialState();
		const next = applyStateDelta(state, { attributes: { affection: 55, mood: '开心' } });
		expect(next.attributes.affection).toBe(55);
		expect(next.attributes.mood).toBe('开心');
		expect(next.attributes.trust).toBe(20);
	});

	it('空补丁返回等价新对象且不抛错', () => {
		const state = createInitialState();
		const next = applyStateDelta(state, {});
		expect(next).not.toBe(state);
		expect(next.attributes).toEqual(state.attributes);
	});

	it('未知顶层键抛 StateValidationError', () => {
		expect(() =>
			applyStateDelta(createInitialState(), { outfit: { top: 'x' }, bogus: 1 } as never)
		).toThrow(StateValidationError);
	});

	it('非法补丁（时间越界）抛错且不改状态', () => {
		const state = createInitialState();
		expect(() =>
			applyStateDelta(state, { schedule: { time: { day: 9, hour: 0, minute: 0 } } })
		).toThrow(StateValidationError);
		expect(state.schedule.time.day).toBe(0);
	});
});

describe('validateCharacterState', () => {
	it('拒绝 null / 数组 / 非对象', () => {
		expect(() => validateCharacterState(null as never)).toThrow(StateValidationError);
		expect(() => validateCharacterState([] as never)).toThrow(StateValidationError);
	});

	it('拒绝非法穿着结构', () => {
		const base = createInitialState();
		expect(() => validateCharacterState({ ...base, outfit: null as never })).toThrow(
			StateValidationError
		);
		expect(() =>
			validateCharacterState({ ...base, outfit: { ...base.outfit, top: 42 } as never })
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({ ...base, outfit: { ...base.outfit, accessories: '发带' } as never })
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				outfit: { ...base.outfit, accessories: ['发带', 1] } as never
			})
		).toThrow(StateValidationError);
	});

	it('拒绝非法地点结构', () => {
		const base = createInitialState();
		expect(() => validateCharacterState({ ...base, location: null as never })).toThrow(
			StateValidationError
		);
		expect(() =>
			validateCharacterState({ ...base, location: { ...base.location, id: 1 } as never })
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({ ...base, location: { ...base.location, id: '' } })
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({ ...base, location: { ...base.location, name: '  ' } })
		).toThrow(StateValidationError);
	});

	it('拒绝非法日程结构', () => {
		const base = createInitialState();
		expect(() => validateCharacterState({ ...base, schedule: null as never })).toThrow(
			StateValidationError
		);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, time: { day: 7, hour: 0, minute: 0 } }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({ ...base, schedule: { ...base.schedule, entries: 'x' as never } })
		).toThrow(StateValidationError);
	});

	it('拒绝非法日程条目', () => {
		const base = createInitialState();
		const valid: ScheduleEntry = { id: 'e1', day: 0, start: 60, end: 120, title: '自习' };
		expect(() =>
			validateCharacterState({ ...base, schedule: { ...base.schedule, entries: [null as never] } })
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, id: '' }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, title: ' ' }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, day: 9 }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, start: -1 }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, end: 1500 }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, end: 60 }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, start: 0.5 }] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: { ...base.schedule, entries: [{ ...valid, locationId: 1 } as never] }
			})
		).toThrow(StateValidationError);
		expect(() =>
			validateCharacterState({
				...base,
				schedule: {
					...base.schedule,
					entries: [{ day: 0, start: 60, end: 120, title: '缺id' } as never]
				}
			})
		).toThrow(StateValidationError);
	});

	it('拒绝非法属性', () => {
		const base = createInitialState();
		expect(() => validateCharacterState({ ...base, attributes: null as never })).toThrow(
			StateValidationError
		);
		expect(() =>
			validateCharacterState({ ...base, attributes: { love: [1, 2] } as never })
		).toThrow(StateValidationError);
	});
});

describe('isValidWorldTime', () => {
	it('接受合法时间', () => {
		expect(isValidWorldTime(validTime())).toBe(true);
		expect(isValidWorldTime({ day: 6, hour: 23, minute: 59 })).toBe(true);
	});

	it('拒绝非法时间', () => {
		expect(isValidWorldTime(null as never)).toBe(false);
		expect(isValidWorldTime({ day: 1.5, hour: 0, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: -1, hour: 0, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: 7, hour: 0, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: 1.5, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: -1, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: 24, minute: 0 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: 0, minute: 1.5 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: 0, minute: -1 })).toBe(false);
		expect(isValidWorldTime({ day: 0, hour: 0, minute: 60 })).toBe(false);
	});
});

describe('normalizeWorldTime', () => {
	it('把非法值夹取到合法范围并取整', () => {
		expect(normalizeWorldTime({ day: 9, hour: 25, minute: 70 })).toEqual({
			day: 6,
			hour: 23,
			minute: 59
		});
		expect(normalizeWorldTime({ day: -3, hour: -1, minute: -5 })).toEqual({
			day: 0,
			hour: 0,
			minute: 0
		});
		expect(normalizeWorldTime({ day: 0, hour: 8.9, minute: 30.9 })).toEqual({
			day: 0,
			hour: 8,
			minute: 30
		});
	});

	it('非有限值收敛到 min', () => {
		expect(
			normalizeWorldTime({
				day: Number.NaN,
				hour: Number.POSITIVE_INFINITY,
				minute: Number.NEGATIVE_INFINITY
			})
		).toEqual({ day: 0, hour: 0, minute: 0 });
	});
});

describe('addMinutes', () => {
	it('简单前进', () => {
		expect(addMinutes({ day: 0, hour: 8, minute: 0 }, 30)).toEqual({ day: 0, hour: 8, minute: 30 });
	});

	it('跨天推进', () => {
		expect(addMinutes({ day: 0, hour: 23, minute: 50 }, 20)).toEqual({
			day: 1,
			hour: 0,
			minute: 10
		});
	});

	it('跨周循环', () => {
		expect(addMinutes({ day: 6, hour: 23, minute: 59 }, 1)).toEqual({ day: 0, hour: 0, minute: 0 });
		expect(addMinutes({ day: 0, hour: 0, minute: 0 }, 7 * 24 * 60 + 5)).toEqual({
			day: 0,
			hour: 0,
			minute: 5
		});
	});

	it('负值回拨', () => {
		expect(addMinutes({ day: 0, hour: 0, minute: 10 }, -20)).toEqual({
			day: 6,
			hour: 23,
			minute: 50
		});
	});

	it('非法分钟数抛错', () => {
		expect(() => addMinutes(validTime(), Number.NaN)).toThrow(StateValidationError);
	});
});

describe('时间格式化与日程查询', () => {
	it('minutesSinceMidnight 计算正确', () => {
		expect(minutesSinceMidnight({ day: 0, hour: 8, minute: 30 })).toBe(510);
	});

	it('formatWorldTime 输出中文星期与补零时间', () => {
		expect(formatWorldTime({ day: 0, hour: 8, minute: 5 })).toBe('周一 08:05');
	});

	it('formatMinutesOfDay 补零并夹取', () => {
		expect(formatMinutesOfDay(540)).toBe('09:00');
		expect(formatMinutesOfDay(-5)).toBe('00:00');
		expect(formatMinutesOfDay(99999)).toBe('23:59');
	});

	it('currentScheduleEntry 命中/未命中/重叠取最早', () => {
		const schedule = {
			time: validTime(),
			entries: [
				{ id: 'a', day: 0, start: 480, end: 540, title: '晨会' },
				{ id: 'b', day: 0, start: 470, end: 560, title: '重叠课' }
			]
		};
		expect(currentScheduleEntry(schedule)?.title).toBe('重叠课');
		expect(currentScheduleEntry(schedule, { day: 3, hour: 10, minute: 0 })).toBeNull();
		expect(currentScheduleEntry(schedule, { day: 0, hour: 9, minute: 0 })?.title).toBe('重叠课');
	});

	it('describeCurrentActivity 覆盖进行中与空闲', () => {
		const schedule = {
			time: validTime(),
			entries: [{ id: 'a', day: 0, start: 480, end: 540, title: '晨会' }]
		};
		expect(describeCurrentActivity(schedule)).toContain('晨会');
		expect(describeCurrentActivity({ ...schedule, entries: [] })).toBe('自由活动');
	});
});
