import Dexie, { type Table } from 'dexie';
import type { SnapshotNode, WorldInfoEntry } from '../core/types';
import type { MemoryEntry } from '../memory/types';
import { DEFAULT_WORKSPACE_ID } from './workspace-scope';

/** kv 表记录：应用级键值（设置、上次 checkout 的 head 等）。 */
export interface KvRecord {
	key: string;
	value: unknown;
}

/**
 * CosBox IndexedDB 数据库。
 * - snapshots：版本图节点，复合索引 [workspaceId+parentId+timestamp] 支撑按工作区+父查询。
 * - worldInfo：世界信息条目。
 * - memories：长期记忆条目。
 * - kv：应用键值（设置、注册表、工作区作用域键等）。
 * 多工作区采用「单库 + workspaceId 分区列」：三个业务表都按 workspaceId 过滤。
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
		// v3：多工作区——三个业务表增加 workspaceId 分区列与索引，
		// 存量行统一归入默认工作区（D104）。
		this.version(3)
			.stores({
				snapshots: 'id, [workspaceId+parentId+timestamp], workspaceId, parentId, timestamp',
				worldInfo: 'id, workspaceId',
				memories: 'id, workspaceId, pinned, category',
				kv: 'key'
			})
			.upgrade(async (tx) => {
				await stampWorkspaceId(tx, 'snapshots');
				await stampWorkspaceId(tx, 'worldInfo');
				await stampWorkspaceId(tx, 'memories');
			});
	}
}

/** v2 → v3：把存量行补上默认工作区 id（数据量小，toArray + bulkPut 足够）。 */
interface UpgradeTxLike {
	table(name: string): {
		toArray(): Promise<unknown[]>;
		bulkPut(rows: unknown[]): Promise<unknown>;
	};
}

async function stampWorkspaceId(
	tx: UpgradeTxLike,
	table: 'snapshots' | 'worldInfo' | 'memories'
): Promise<void> {
	const rows = (await tx.table(table).toArray()) as { workspaceId?: string }[];
	if (rows.length === 0) {
		return;
	}
	await tx.table(table).bulkPut(rows.map((row) => ({ ...row, workspaceId: DEFAULT_WORKSPACE_ID })));
}

let sharedDb: CosBoxDatabase | null = null;

/** 应用共享数据库单例（测试请直接 new CosBoxDatabase 实例）。 */
export function getDb(): CosBoxDatabase {
	if (sharedDb === null) {
		sharedDb = new CosBoxDatabase();
	}
	return sharedDb;
}
