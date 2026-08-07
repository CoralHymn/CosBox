import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from './types';
import { findDuplicateMemory, normalizeMemoryText } from './dedupe';

function entry(content: string): MemoryEntry {
	return {
		id: 'm',
		content,
		category: '其他',
		keywords: [],
		importance: 3,
		pinned: false,
		source: 'manual',
		createdAt: 1,
		updatedAt: 1,
		lastUsedAt: 0,
		useCount: 0
	};
}

describe('normalizeMemoryText', () => {
	it('去除空白与中英文标点并转小写', () => {
		expect(normalizeMemoryText(' 绫音怕打雷，怕雷！ ')).toBe('绫音怕打雷怕雷');
		expect(normalizeMemoryText('Likes Coffee.')).toBe('likescoffee');
	});
});

describe('findDuplicateMemory', () => {
	it('归一化后完全一致视为重复', () => {
		expect(findDuplicateMemory('绫音怕打雷，怕雷', [entry('绫音怕打雷怕雷')])).toBeDefined();
	});

	it('一方包含另一方（长度相近）视为重复', () => {
		expect(
			findDuplicateMemory('绫音怕打雷躲进怀里', [entry('绫音怕打雷躲进怀里睡觉')])
		).toBeDefined();
	});

	it('明显不同的内容不算重复', () => {
		expect(findDuplicateMemory('绫音喜欢咖喱饭', [entry('绫音怕打雷')])).toBeUndefined();
	});

	it('空候选不匹配任何条目', () => {
		expect(findDuplicateMemory('   ', [entry('任何内容')])).toBeUndefined();
	});
});
