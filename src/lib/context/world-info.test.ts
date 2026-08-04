import { describe, expect, it } from 'vitest';
import type { WorldInfoEntry } from '../core/types';
import { findWorldInfoHits, normalizeTrigger } from './world-info';

function entry(id: string, keys: string[], priority = 50, enabled = true): WorldInfoEntry {
	return { id, keys, content: `${id}-内容`, enabled, priority };
}

describe('normalizeTrigger', () => {
	it('去空白并转小写', () => {
		expect(normalizeTrigger('  Hello World ')).toBe('hello world');
	});
});

describe('findWorldInfoHits', () => {
	it('命中并返回内容', () => {
		const hits = findWorldInfoHits(['今天要去图书馆'], [entry('e1', ['图书馆'])]);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ entryId: 'e1', matchedKey: '图书馆', content: 'e1-内容' });
	});

	it('大小写不敏感', () => {
		const hits = findWorldInfoHits(['Go to the LIBRARY'], [entry('e1', ['library'])]);
		expect(hits).toHaveLength(1);
	});

	it('多关键词只记首个命中', () => {
		const hits = findWorldInfoHits(['图书馆开门了'], [entry('e1', ['图书馆', '书库'])]);
		expect(hits[0]!.matchedKey).toBe('图书馆');
	});

	it('禁用条目与空关键词被跳过', () => {
		const hits = findWorldInfoHits(
			['图书馆  '],
			[entry('off', ['图书馆'], 10, false), entry('empty', ['  '])]
		);
		expect(hits).toEqual([]);
	});

	it('keys 为空数组时跳过', () => {
		expect(findWorldInfoHits(['x'], [entry('e', [])])).toEqual([]);
	});

	it('按 priority 降序，同优先级保持输入顺序', () => {
		const hits = findWorldInfoHits(
			['猫在图书馆'],
			[entry('low', ['猫'], 10), entry('high', ['图书馆'], 100), entry('mid', ['猫'], 10)]
		);
		expect(hits.map((h) => h.entryId)).toEqual(['high', 'low', 'mid']);
	});

	it('无命中返回空数组', () => {
		expect(findWorldInfoHits(['你好'], [entry('e', ['猫'])])).toEqual([]);
	});

	it('同一文本中的同一条目不重复计数', () => {
		const hits = findWorldInfoHits(['猫猫猫猫'], [entry('e', ['猫'])]);
		expect(hits).toHaveLength(1);
	});

	it('跨多条文本合并搜索', () => {
		const hits = findWorldInfoHits(['第一条', '去图书馆'], [entry('e', ['图书馆'])]);
		expect(hits).toHaveLength(1);
	});
});
