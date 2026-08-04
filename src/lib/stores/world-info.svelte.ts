import type { WorldInfoEntry } from '../core/types';
import type { WorldInfoRepository } from '../db/world-info-repo';

/** 世界信息 store：条目的响应式列表 + 增删改入口。 */
export function createWorldInfoStore(repo: WorldInfoRepository) {
	let entries = $state<WorldInfoEntry[]>([]);

	/** 全量加载并按优先级降序排列。 */
	async function init(): Promise<void> {
		const all = await repo.getAll();
		entries = [...all].sort((a, b) => b.priority - a.priority);
	}

	/** 新增或整体替换一条。 */
	async function upsert(entry: WorldInfoEntry): Promise<void> {
		await repo.upsert(entry);
		await init();
	}

	/** 删除一条。 */
	async function remove(id: string): Promise<void> {
		await repo.remove(id);
		await init();
	}

	/** 批量导入（导入角色卡时使用）。 */
	async function importEntries(list: WorldInfoEntry[]): Promise<void> {
		for (const entry of list) {
			await repo.upsert(entry);
		}
		await init();
	}

	/** 清空全部条目。 */
	async function clear(): Promise<void> {
		await repo.clear();
		await init();
	}

	return {
		get entries() {
			return entries;
		},
		init,
		upsert,
		remove,
		importEntries,
		clear
	};
}
