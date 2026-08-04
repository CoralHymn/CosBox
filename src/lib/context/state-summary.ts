import { describeCurrentActivity, formatMinutesOfDay, formatWorldTime } from '../core/state';
import type { CharacterState, OutfitState, ScheduleState } from '../core/types';

/**
 * 把穿着结构渲染成自然语言，如「白色衬衫、深蓝百褶裙、黑色皮鞋、蝴蝶结发带」。
 */
export function formatOutfit(outfit: OutfitState): string {
	const parts = [outfit.top, outfit.bottom, outfit.shoes, ...outfit.accessories].filter(
		(part): part is string => part !== null && part !== ''
	);
	return parts.length > 0 ? parts.join('、') : '（无穿着描述）';
}

/**
 * 把属性表渲染成一行摘要，如「name:绫音，age:17，affection:30」。
 */
export function formatAttributes(attributes: Record<string, number | string | boolean>): string {
	const parts = Object.entries(attributes).map(([key, value]) => `${key}:${String(value)}`);
	return parts.length > 0 ? parts.join('，') : '（无属性）';
}

/**
 * 渲染今日日程：按时段排序的条目列表，如「周一 08:00-09:00 晨会」。
 */
export function summarizeSchedule(schedule: ScheduleState): string {
	const sorted = [...schedule.entries].sort(
		(a, b) => a.day - b.day || a.start - b.start || a.title.localeCompare(b.title)
	);
	if (sorted.length === 0) {
		return '今日无安排';
	}
	return sorted
		.map((entry) => {
			const dayName = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][entry.day] ?? '?';
			return `${dayName} ${formatMinutesOfDay(entry.start)}-${formatMinutesOfDay(entry.end)} ${entry.title}`;
		})
		.join('；');
}

/**
 * 生成结构化状态摘要，注入 LLM 系统提示。
 * 覆盖：时间、当前活动、地点、穿着、属性、日程。
 */
export function summarizeState(state: CharacterState): string {
	const lines = [
		'【当前状态】',
		`时间：${formatWorldTime(state.schedule.time)}（${describeCurrentActivity(state.schedule)}）`,
		`地点：${state.location.name}（${state.location.description}）`,
		`穿着：${formatOutfit(state.outfit)}`,
		`属性：${formatAttributes(state.attributes)}`,
		`今日日程：${summarizeSchedule(state.schedule)}`
	];
	return lines.join('\n');
}
