import { formatWorldTime } from '../core/state';
import type { WorldTime } from '../core/types';

/**
 * 世界时间元数据标注的起始标记。
 * 元数据只会在「发送给模型 / 摘要请求」的边界注入，消息正文本身保持纯净，
 * 避免模型把时间标注当作台词、旁白而模仿复述。
 */
export const WORLD_TIME_MARKER = '【世界时间：';

/** 调试视图角色行的时间标注前缀（如「（周一 09:00）」）。 */
export const WORLD_TIME_LABEL_PREFIX = '（';
export const WORLD_TIME_LABEL_SUFFIX = '）';

/** 匹配模型误输出的完整「【世界时间：周一 12:00】」标注（要求闭合，避免误删同行正文）。 */
const WORLD_TIME_MARKER_PATTERN = /【世界时间：[^】\n]*】/g;
/** 匹配回复开头的旧式时间前缀，如「（周一 12:00）」——仅限开头，避免误伤正文括号。 */
const LEADING_LEGACY_TIME_PATTERN = /^\s*（周[一二三四五六日]\s*\d{1,2}:\d{2}）\s*/;

/**
 * 生成注入到 API 载荷的消息正文：时间元数据独占一行，与对话内容分离。
 * 例：「【世界时间：周一 09:00】\n好了快穿上吧」。
 */
export function annotateWorldTime(content: string, worldTime: WorldTime): string {
	return `${WORLD_TIME_MARKER}${formatWorldTime(worldTime)}】\n${content}`;
}

/** 调试视图使用的紧凑时间标注，如「（周一 09:00）」。 */
export function formatWorldTimeLabel(worldTime: WorldTime): string {
	return `${WORLD_TIME_LABEL_PREFIX}${formatWorldTime(worldTime)}${WORLD_TIME_LABEL_SUFFIX}`;
}

/**
 * 清洗模型回复，移除误输出的世界时间标注。
 * 「【世界时间：…】」是 CosBox 保留给元数据的格式，模型回复中出现一律是模仿幻觉，
 * 直接剔除；同时去掉回复开头的旧式时间前缀（如「（周一 12:00）」）。
 * 标注独占一行时连该行一起删除，内联出现时只删标注本身、保留前后文本。
 */
export function sanitizeAssistantText(text: string): string {
	const cleaned = text
		.split('\n')
		.map((line, index) => {
			const withoutMarker = line.replace(WORLD_TIME_MARKER_PATTERN, '').trimEnd();
			// 标注独占一行：该行移除标注后为空且原行非空 → 整行丢弃。
			if (withoutMarker.trim() === '' && line.trim() !== '') {
				return null;
			}
			return index === 0 ? withoutMarker.replace(LEADING_LEGACY_TIME_PATTERN, '') : withoutMarker;
		})
		.filter((line): line is string => line !== null)
		.join('\n');
	return cleaned.replace(/^\s*\n+/, '').trim();
}
