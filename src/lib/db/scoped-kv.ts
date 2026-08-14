import type { KvRepository } from './kv-repo';
import type { WorkspaceScope } from './workspace-scope';

/**
 * 工作区作用域的 kv 接口：与 KvRepository 同形的读写方法，
 * 但键自动带 `ws:{工作区id}:` 前缀，切换工作区后读写自动落到新工作区。
 */
export interface ScopedKv {
	get<T>(key: string): Promise<T | undefined>;
	set<T>(key: string, value: T): Promise<void>;
	remove(key: string): Promise<void>;
}

/** 计算某工作区下键的完整前缀（删除工作区时清理 `ws:{id}:*` 用）。 */
export function workspaceKvPrefix(workspaceId: string): string {
	return `ws:${workspaceId}:`;
}

/** 计算某工作区下键的完整存储键。 */
export function workspaceKvKey(workspaceId: string, key: string): string {
	return `${workspaceKvPrefix(workspaceId)}${key}`;
}

/**
 * 把全局 KvRepository 包装为工作区作用域的 kv：get/set/remove 自动加前缀。
 * `getWorkspaceId` 每次调用实时取值，因此作用域随 WorkspaceScope 切换即时生效。
 */
export function createScopedKv(kv: KvRepository, getWorkspaceId: () => string): ScopedKv {
	const keyOf = (key: string): string => workspaceKvKey(getWorkspaceId(), key);
	return {
		get: <T>(key: string): Promise<T | undefined> => kv.get<T>(keyOf(key)),
		set: <T>(key: string, value: T): Promise<void> => kv.set(keyOf(key), value),
		remove: (key: string): Promise<void> => kv.remove(keyOf(key))
	};
}

/** 基于固定工作区 id 的作用域 kv（复制/删除/导出非当前工作区时用）。 */
export function createWorkspaceKv(kv: KvRepository, workspaceId: string): ScopedKv {
	return createScopedKv(kv, () => workspaceId);
}

/** 以 WorkspaceScope 为源的作用域 kv（运行时随当前工作区切换）。 */
export function createScopeKv(kv: KvRepository, scope: WorkspaceScope): ScopedKv {
	return createScopedKv(kv, () => scope.get());
}
