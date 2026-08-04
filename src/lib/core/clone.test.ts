import { describe, expect, it } from 'vitest';
import { clonePlain } from './clone';

describe('clonePlain', () => {
	it('普通对象深拷贝：结构与值相等且互不共享引用', () => {
		const value = { a: 1, b: { c: [1, 2] } };
		const cloned = clonePlain(value);
		expect(cloned).toEqual(value);
		expect(cloned).not.toBe(value);
		expect(cloned.b).not.toBe(value.b);
		expect(cloned.b.c).not.toBe(value.b.c);
	});

	it('structuredClone 失败时退回 JSON 深拷贝（不可克隆属性被丢弃）', () => {
		const value = { a: 1, fn: () => 2 };
		const cloned = clonePlain(value);
		expect(cloned).toEqual({ a: 1 });
	});
});
