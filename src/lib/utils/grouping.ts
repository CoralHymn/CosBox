/** 分类分组结果。 */
export interface CategoryGroup<T> {
	category: string;
	items: T[];
}

/**
 * 按 category 分组：有分类的按分类名排序，未分类（空串）放最后，组内保持原顺序。
 * 用于地点库 / 衣柜的大类收纳展示。
 *
 * 排序显式用 'zh-CN'：不带 locale 的 localeCompare 结果取决于运行环境默认语言，
 * CI（en-US）与中文系统、不同浏览器会算出相反的顺序，导致展示不一致、测试挂掉。
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
				categoryRank(a.category) - categoryRank(b.category) ||
				a.category.localeCompare(b.category, 'zh-CN')
			);
		});
}

/** 未分类（空串）排最后：rank 1；其余 rank 0。 */
function categoryRank(category: string): number {
	return category === '' ? 1 : 0;
}

/**
 * 拖拽排序：把 dragId 条目移动到 targetId 条目所在位置（同分类内部使用）。
 * 向下拖拽时落在目标之后，向上拖拽时落在目标之前；未找到或相同返回原数组副本。
 */
export function moveItemToTarget<T extends { id: string }>(
	rows: readonly T[],
	dragId: string,
	targetId: string
): T[] {
	const from = rows.findIndex((row) => row.id === dragId);
	const to = rows.findIndex((row) => row.id === targetId);
	if (from === -1 || to === -1 || from === to) {
		return [...rows];
	}
	const next = [...rows];
	const moved = next[from]!;
	next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
