/** 分类分组结果。 */
export interface CategoryGroup<T> {
	category: string;
	items: T[];
}

/**
 * 按 category 分组：有分类的按分类名排序，未分类（空串）放最后，组内保持原顺序。
 * 用于地点库 / 衣柜的大类收纳展示。
 */
export function groupByCategory<T extends { category: string }>(
	rows: readonly T[]
): CategoryGroup<T>[] {
	const map = new Map<string, T[]>();
	for (const row of rows) {
		const list = map.get(row.category) ?? [];
		list.push(row);
		map.set(row.category, list);
	}
	return [...map.entries()]
		.map(([category, items]) => ({ category, items }))
		.sort((a, b) => {
			return (
				categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category)
			);
		});
}

/** 未分类（空串）排最后：rank 1；其余 rank 0。 */
function categoryRank(category: string): number {
	return category === '' ? 1 : 0;
}
