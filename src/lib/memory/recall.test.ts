import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from './types';
import { recallMemories } from './recall';

function entry(overrides: Partial<MemoryEntry>): MemoryEntry {
	const now = 1_700_000_000_000;
	return {
		id: 'm1',
		content: '绫音怕打雷',
		category: '角色偏好',
		keywords: ['打雷'],
		importance: 3,
		pinned: false,
		source: 'manual',
		createdAt: now,
		updatedAt: now,
		lastUsedAt: 0,
		useCount: 0,
		...overrides
	};
}

describe('recallMemories', () => {
	it('limit 为 0 或空列表时返回空数组', () => {
		expect(recallMemories([], ['hi'], 5)).toEqual([]);
		expect(recallMemories([entry({})], ['hi'], 0)).toEqual([]);
	});

	it('关键词命中优先于未命中', () => {
		const hit = entry({ id: 'hit', keywords: ['游泳课'], content: '上了游泳课' });
		const miss = entry({ id: 'miss', keywords: ['图书馆'], content: '常去图书馆' });
		const result = recallMemories([miss, hit], ['今天游泳课好累'], 5);
		expect(result.map((item) => item.id)).toEqual(['hit']);
	});

	it('零命中且非置顶的条目不注入', () => {
		const miss = entry({ id: 'miss', keywords: ['图书馆'], content: '常去图书馆' });
		const result = recallMemories([miss], ['今天去游泳'], 5);
		expect(result).toEqual([]);
	});

	it('置顶条目始终在最前（按重要度排序）', () => {
		const pinnedLow = entry({ id: 'p1', pinned: true, importance: 2, keywords: [] });
		const hitHigh = entry({ id: 'h1', importance: 5, keywords: ['食堂'] });
		const pinnedHigh = entry({ id: 'p2', pinned: true, importance: 4, keywords: [] });
		const result = recallMemories([hitHigh, pinnedLow, pinnedHigh], ['食堂'], 5);
		expect(result.map((item) => item.id)).toEqual(['p2', 'p1', 'h1']);
	});

	it('超过 limit 时截断，保留最相关条目', () => {
		const hitA = entry({ id: 'a', keywords: ['食堂'] });
		const hitB = entry({ id: 'b', keywords: ['食堂', '咖喱'] });
		const hitC = entry({ id: 'c', pinned: true, keywords: [] });
		const result = recallMemories([hitA, hitB, hitC], ['食堂的咖喱饭'], 2);
		expect(result.map((item) => item.id)).toEqual(['c', 'b']);
	});

	it('空正文条目不参与召回', () => {
		const blank = entry({ id: 'blank', content: '   ' });
		const normal = entry({ id: 'n', keywords: ['电影'] });
		const result = recallMemories([blank, normal], ['去看电影'], 5);
		expect(result.map((item) => item.id)).toEqual(['n']);
	});
});
