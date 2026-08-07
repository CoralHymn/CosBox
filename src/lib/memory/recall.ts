import type { MemoryEntry } from './types';

/** 召回候选的评分：关键词命中（主）+ 重要度 + 最近使用加权。 */
function scoreMemory(entry: MemoryEntry, hitCount: number, now: number): number {
	const keywordScore = hitCount * 10;
	const importanceScore = (entry.importance - 1) * 2;
	// 越久没被召回越优先（避免总是注入同一条）；用 lastUsedAt 距今的天数衰减。
	const daysSinceUse = Math.max(0, (now - entry.lastUsedAt) / 86_400_000);
	const recencyScore = Math.min(3, daysSinceUse * 0.2);
	return keywordScore + importanceScore + recencyScore;
}

/**
 * 从记忆中召回与最近对话相关的内容：
 * - 置顶条目始终参与（按重要度排序）；
 * - 其余条目仅在关键词命中时参与，按命中数量加权评分，命中越多越优先；
 * - 总条数受 limit 限制；零命中的非置顶条目不注入，避免无关记忆污染上下文。
 */
export function recallMemories(
	entries: ReadonlyArray<MemoryEntry>,
	contexts: ReadonlyArray<string>,
	limit: number
): MemoryEntry[] {
	if (limit <= 0 || entries.length === 0) {
		return [];
	}
	const now = Date.now();
	const joined = contexts.join('\n');
	const scored: { entry: MemoryEntry; hits: number; score: number }[] = [];
	for (const entry of entries) {
		if (entry.content.trim() === '') {
			continue;
		}
		let hits = 0;
		for (const keyword of entry.keywords) {
			if (keyword.trim() !== '' && joined.includes(keyword.trim())) {
				hits += 1;
			}
		}
		scored.push({ entry, hits, score: scoreMemory(entry, hits, now) });
	}
	const pinned = scored
		.filter((item) => item.entry.pinned)
		.sort((a, b) => b.entry.importance - a.entry.importance);
	const others = scored
		.filter((item) => !item.entry.pinned && item.hits > 0)
		.sort((a, b) => b.score - a.score || b.entry.importance - a.entry.importance);
	return [...pinned, ...others]
		.slice(0, limit)
		.map((item) => item.entry);
}
