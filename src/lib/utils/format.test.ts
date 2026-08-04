import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTimestamp, truncate } from './format';

describe('formatTimestamp / formatDateTime', () => {
	it('输出补零的本地时间', () => {
		const ts = new Date(2026, 0, 5, 8, 5, 9).getTime();
		expect(formatTimestamp(ts)).toBe('08:05:09');
		expect(formatDateTime(ts)).toBe('01-05 08:05');
	});
});

describe('truncate', () => {
	it('短文本原样返回', () => {
		expect(truncate('你好', 10)).toBe('你好');
	});

	it('超长文本截断并补省略号', () => {
		expect(truncate('一二三四五', 3)).toBe('一二三…');
	});

	it('上限为 0 时全部截断', () => {
		expect(truncate('abc', 0)).toBe('…');
	});
});
