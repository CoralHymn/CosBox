import type { KvRepository } from '../db/kv-repo';
import type { CompactionState } from '../llm/compaction';
import type { TokenUsage } from '../llm/types';

/** 持久化的最近一次请求上下文用量（仅保留面板展示所需字段，不保存完整消息数组）。 */
export interface PersistedContextUsage {
	usage: TokenUsage;
	compaction: CompactionState | null;
	/** 压缩时保留的最近完整消息数（展示用）。 */
	keptRecent: number;
	/** 保存时间戳（ms）。 */
	savedAt: number;
}

const KEY = 'context.usage';

/** 校验持久化的 usage 形状，避免旧版本或损坏数据导致面板崩溃。 */
function isTokenUsage(value: unknown): value is TokenUsage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.promptTokens === 'number' &&
		typeof record.completionTokens === 'number' &&
		typeof record.cachedTokens === 'number'
	);
}

/** 校验持久化的压缩状态形状。 */
function isCompactionState(value: unknown): value is CompactionState {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.summary === 'string' && typeof record.boundaryId === 'string';
}

/** 校验持久化记录整体形状；非法数据直接忽略。 */
function isPersistedContextUsage(value: unknown): value is PersistedContextUsage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		isTokenUsage(record.usage) &&
		(record.compaction === null || isCompactionState(record.compaction)) &&
		typeof record.keptRecent === 'number' &&
		typeof record.savedAt === 'number'
	);
}

/**
 * 上下文用量持久化 store：把最近一次请求的 token 用量与压缩状态写入 IndexedDB，
 * 应用重启后侧栏仍能显示上次的用量面板（而非空白占位）。
 */
export function createContextUsageStore(kv: KvRepository) {
	let usage = $state<PersistedContextUsage | null>(null);
	let loaded = $state(false);

	/** 从本地库读取上次保存的用量；缺失或损坏时保持为空。 */
	async function load(): Promise<void> {
		try {
			const saved = await kv.get<unknown>(KEY);
			if (isPersistedContextUsage(saved)) {
				usage = saved;
			}
		} catch {
			// 读取失败不阻断启动，面板保持空态。
		} finally {
			loaded = true;
		}
	}

	/** 保存新用量并立即更新内存态；写入失败由调用方提示。 */
	async function save(next: PersistedContextUsage): Promise<void> {
		usage = next;
		await kv.set(KEY, next);
	}

	return {
		get usage() {
			return usage;
		},
		get loaded() {
			return loaded;
		},
		load,
		save
	};
}
