import { describe, expect, it } from 'vitest';
import { parseConfigPart, serializeConfigPart } from './config-transfer';

describe('config-transfer', () => {
	it('序列化 → 解析往返', () => {
		const items = [
			{ id: 'p1', category: '商业街', name: '中央商店街', description: 'x' },
			{ id: 'p2', category: '郊外', name: '银沙海滨浴场', description: 'y' }
		];
		const raw = serializeConfigPart('locations', items);
		const parsed = parseConfigPart('locations', raw);
		expect(parsed.issues).toEqual([]);
		expect(parsed.items).toEqual(items);
	});

	it('类型不匹配报错', () => {
		const raw = serializeConfigPart('wardrobe', []);
		const parsed = parseConfigPart('locations', raw);
		expect(parsed.items).toEqual([]);
		expect(parsed.issues[0]).toContain('类型不匹配');
	});

	it('非法 JSON / 结构 / 版本 / 缺 items 报错', () => {
		expect(parseConfigPart('locations', 'not-json').issues[0]).toContain('JSON');
		expect(parseConfigPart('locations', '[1]').issues[0]).toContain('结构不正确');
		expect(
			parseConfigPart('locations', JSON.stringify({ kind: 'locations', version: 99, items: [] }))
				.issues[0]
		).toContain('版本');
		expect(
			parseConfigPart('locations', JSON.stringify({ kind: 'locations', version: 1 })).issues[0]
		).toContain('items');
	});

	it('内容非法时返回条目问题', () => {
		const raw = JSON.stringify({
			kind: 'locations',
			version: 1,
			items: [{ category: '', name: '', description: '' }]
		});
		const parsed = parseConfigPart('locations', raw);
		expect(parsed.items).toEqual([]);
		expect(parsed.issues.length).toBeGreaterThan(0);
	});
});
