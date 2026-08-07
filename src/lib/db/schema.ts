import Dexie, { type Table } from 'dexie';
import type { SnapshotNode, WorldInfoEntry } from '../core/types';
import type { MemoryEntry } from '../memory/types';

/** kv 表记录：应用级键值（设置、上次 checkout 的 head 等）。 */
export interface KvRecord {
	key: string;
	value: unknown;
}

/**
 * CosBox IndexedDB 数据库。
 * - snapshots：版本图节点，复合索引 [parentId+timestamp] 支撑按父查询。
 * - worldInfo：世界信息条目。
 * - kv：应用键值（设置、上次 checkout 的 head 等）。
 */
export class CosBoxDatabase extends Dexie {
	snapshots!: Table<SnapshotNode, string>;
	worldInfo!: Table<WorldInfoEntry, string>;
	memories!: Table<MemoryEntry, string>;
	kv!: Table<KvRecord, string>;

	constructor(name = 'cosbox') {
		super(name);
		this.version(1).stores({
			snapshots: 'id, [parentId+timestamp], parentId, timestamp',
			worldInfo: 'id',
			kv: 'key'
		});
		// v2：新增长期记忆表。
		this.version(2).stores({
			snapshots: 'id, [parentId+timestamp], parentId, timestamp',
			worldInfo: 'id',
			memories: 'id, pinned, category',
			kv: 'key'
		});
	}
}

let sharedDb: CosBoxDatabase | null = null;

/** 应用共享数据库单例（测试请直接 new CosBoxDatabase 实例）。 */
export function getDb(): CosBoxDatabase {
	if (sharedDb === null) {
		sharedDb = new CosBoxDatabase();
	}
	return sharedDb;
}
