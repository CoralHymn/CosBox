import { describe, expect, it } from 'vitest';
import { groupByCategory, moveItemToTarget } from './grouping';

describe('groupByCategory', () => {
	it('按分类分组并保持组内顺序', () => {
		const rows = [
			{ id: 'a', category: '学校', name: '食堂' },
			{ id: 'b', category: '校外', name: '海边' },
			{ id: 'c', category: '学校', name: '游泳馆' }
		];
		const groups = groupByCategory(rows);
		expect(groups.map((g) => g.category)).toEqual(['校外', '学校']);
		expect(groups[1]!.items.map((item) => item.name)).toEqual(['食堂', '游泳馆']);
	});

	it('未分类（空串）放在最后', () => {
		const groups = groupByCategory([
			{ id: 'a', category: '', name: '无分类' },
			{ id: 'b', category: '学校', name: '食堂' }
		]);
		expect(groups.map((g) => g.category)).toEqual(['学校', '']);
	});

	it('空输入返回空数组', () => {
		expect(groupByCategory([])).toEqual([]);
	});
});

describe('moveItemToTarget', () => {
	const rows = [
		{ id: 'a', category: '学校', name: '食堂' },
		{ id: 'b', category: '学校', name: '教室' },
		{ id: 'c', category: '学校', name: '图书馆' },
		{ id: 'd', category: '校外', name: '海边' }
	];

	it('向下拖拽：落在目标之后', () => {
		expect(moveItemToTarget(rows, 'a', 'c').map((row) => row.id)).toEqual(['b', 'c', 'a', 'd']);
	});

	it('向上拖拽：落在目标之前', () => {
		expect(moveItemToTarget(rows, 'c', 'a').map((row) => row.id)).toEqual(['c', 'a', 'b', 'd']);
	});

	it('相同或未找到时返回原数组副本', () => {
		expect(moveItemToTarget(rows, 'a', 'a').map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(moveItemToTarget(rows, 'zz', 'a')).toEqual(rows);
		expect(moveItemToTarget(rows, 'a', 'zz')).toEqual(rows);
	});
});
