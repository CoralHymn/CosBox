import { findDuplicateMemory } from '../memory/dedupe';
import type { ExtractedMemory, MemoryEntry } from '../memory/types';
import { newId } from '../utils/id';
import type { MemoryRepository } from '../db/memory-repo';

/** 手动添加记忆时的输入（id/统计字段由 store 生成）。 */
export interface MemoryDraft {
	content: string;
	category: string;
	keywords: string[];
	importance: number;
	pinned: boolean;
}

/** 批量导入提取结果时的返回值：导入条数与因重复跳过的条数。 */
export interface MemoryImportResult {
	imported: number;
	skipped: number;
}

/** 记忆 store：长期记忆的加载、增删改、置顶与 LLM 提取结果导入。 */
export function createMemoryStore(repo: MemoryRepository) {
	let entries = $state<MemoryEntry[]>([]);
	let loaded = $state(false);

	/** 去空白并去重（保持顺序）。 */
	function uniqueNonEmpty(values: ReadonlyArray<string>): string[] {
		return values
			.map((value) => value.trim())
			.filter((value, index, array) => value !== '' && array.indexOf(value) === index);
	}

	/** 展示排序：置顶优先，其次重要度，最后最近更新。 */
	const sorted = $derived(
		[...entries].sort(
			(a, b) =>
				Number(b.pinned) - Number(a.pinned) ||
				b.importance - a.importance ||
				b.updatedAt - a.updatedAt
		)
	);

	/** 从本地库加载全部记忆。 */
	async function load(): Promise<void> {
		entries = await repo.getAll();
		loaded = true;
	}

	/** 手动添加一条记忆（返回新条目）。 */
	async function add(draft: MemoryDraft): Promise<MemoryEntry> {
		const now = Date.now();
		const entry: MemoryEntry = {
			id: newId(),
			content: draft.content.trim(),
			category: draft.category.trim() || '其他',
			keywords: uniqueNonEmpty(draft.keywords),
			importance: Math.min(5, Math.max(1, Math.round(draft.importance))),
			pinned: draft.pinned,
			source: 'manual',
			createdAt: now,
			updatedAt: now,
			lastUsedAt: 0,
			useCount: 0
		};
		entries = [...entries, entry];
		await repo.upsert(entry);
		return entry;
	}

	/** 局部更新一条记忆（重要度/置顶/分类/内容等）。 */
	async function update(id: string, patch: Partial<Omit<MemoryEntry, 'id'>>): Promise<void> {
		const current = entries.find((entry) => entry.id === id);
		if (current === undefined) {
			return;
		}
		const next: MemoryEntry = { ...current, ...patch, updatedAt: Date.now() };
		entries = entries.map((entry) => (entry.id === id ? next : entry));
		await repo.upsert(next);
	}

	/** 删除一条记忆。 */
	async function remove(id: string): Promise<void> {
		entries = entries.filter((entry) => entry.id !== id);
		await repo.remove(id);
	}

	/** 切换置顶状态。 */
	async function togglePinned(id: string): Promise<void> {
		const current = entries.find((entry) => entry.id === id);
		if (current !== undefined) {
			await update(id, { pinned: !current.pinned });
		}
	}

	/** 记录一次召回（更新 lastUsedAt / useCount，供排序与衰减使用）。 */
	async function markUsed(ids: ReadonlyArray<string>): Promise<void> {
		const now = Date.now();
		const targets = entries.filter((entry) => ids.includes(entry.id));
		if (targets.length === 0) {
			return;
		}
		const updated: MemoryEntry[] = targets.map((entry) => ({
				...entry,
				lastUsedAt: now,
				useCount: entry.useCount + 1,
				updatedAt: entry.updatedAt
			}));
		entries = entries.map(
			(entry) => updated.find((candidate) => candidate.id === entry.id) ?? entry
		);
		await repo.bulkPut(updated);
	}

	/**
	 * 批量导入 LLM 提取结果：与既有记忆去重（内容归一化比对），
	 * 返回导入/跳过数量，供 UI 提示。
	 */
	async function importExtracted(
		items: ReadonlyArray<ExtractedMemory>
	): Promise<MemoryImportResult> {
		const now = Date.now();
		const fresh: MemoryEntry[] = [];
		let skipped = 0;
		for (const item of items) {
			if (item.content.trim() === '') {
				continue;
			}
			if (findDuplicateMemory(item.content, [...entries, ...fresh]) !== undefined) {
				skipped += 1;
				continue;
			}
			fresh.push({
				id: newId(),
				content: item.content.trim(),
				category: item.category.trim() || '其他',
				keywords: uniqueNonEmpty(item.keywords),
				importance: Math.min(5, Math.max(1, Math.round(item.importance))),
				pinned: false,
				source: 'extract',
				createdAt: now,
				updatedAt: now,
				lastUsedAt: 0,
				useCount: 0
			});
		}
		if (fresh.length > 0) {
			entries = [...entries, ...fresh];
			await repo.bulkPut(fresh);
		}
		return { imported: fresh.length, skipped };
	}

	return {
		get entries() {
			return entries;
		},
		get sorted() {
			return sorted;
		},
		get loaded() {
			return loaded;
		},
		load,
		add,
		update,
		remove,
		togglePinned,
		markUsed,
		importExtracted
	};
}
