import type { MemoryEntry } from './types';

/** 归一化记忆文本：去空白、去标点，用于重复检测。 */
export function normalizeMemoryText(content: string): string {
	return content
		.replace(/[\s，。！？、；：,.!?;:""''（）()【】[\]]/g, '')
		.toLowerCase();
}

/**
 * 判断一条候选记忆是否与既有记忆重复：
 * 完全一致（归一化后）或一方包含另一方（长度差在 50% 以内）视为重复。
 */
export function findDuplicateMemory(
	candidate: string,
	existing: ReadonlyArray<MemoryEntry>
): MemoryEntry | undefined {
	const norm = normalizeMemoryText(candidate);
	if (norm === '') {
		return undefined;
	}
	for (const entry of existing) {
		const other = normalizeMemoryText(entry.content);
		if (other === '') {
			continue;
		}
		if (other === norm) {
			return entry;
		}
		const shorter = norm.length <= other.length ? norm : other;
		const longer = norm.length <= other.length ? other : norm;
		if (shorter.length >= 4 && longer.includes(shorter) && longer.length <= shorter.length * 1.5) {
			return entry;
		}
	}
	return undefined;
}
