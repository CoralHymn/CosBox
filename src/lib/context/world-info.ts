import type { WorldInfoEntry } from '../core/types';

/** 世界信息命中结果（扁平化，方便管道直接拼装）。 */
export interface WorldInfoHit {
	entryId: string;
	/** 命中的原始关键词（未归一化，便于展示）。 */
	matchedKey: string;
	content: string;
	priority: number;
}

/** 归一化触发文本：去首尾空白 + 小写。 */
export function normalizeTrigger(text: string): string {
	return text.trim().toLocaleLowerCase();
}

/**
 * 在若干文本中查找命中的世界信息条目。
 * - 只匹配 enabled 条目；空关键词跳过。
 * - 每条只记一次命中（首个匹配关键词）。
 * - 结果按 priority 降序，同优先级保持输入顺序。
 * 注：使用子串匹配（对中文友好）；英文不做词边界，见 DECISIONS.md。
 */
export function findWorldInfoHits(
	texts: ReadonlyArray<string>,
	entries: ReadonlyArray<WorldInfoEntry>
): WorldInfoHit[] {
	const combined = texts.map((text) => normalizeTrigger(text)).join('\n');
	const hits: WorldInfoHit[] = [];
	const seen = new Set<string>();

	for (const entry of entries) {
		if (!entry.enabled || !Array.isArray(entry.keys) || entry.keys.length === 0) {
			continue;
		}
		for (const rawKey of entry.keys) {
			const key = normalizeTrigger(rawKey);
			if (key === '' || !combined.includes(key)) {
				continue;
			}
			if (!seen.has(entry.id)) {
				seen.add(entry.id);
				hits.push({
					entryId: entry.id,
					matchedKey: rawKey,
					content: entry.content,
					priority: entry.priority
				});
			}
			break;
		}
	}

	hits.sort((a, b) => b.priority - a.priority);
	return hits;
}
