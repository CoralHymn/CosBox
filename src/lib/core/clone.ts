/**
 * 深拷贝状态数据：优先使用 structuredClone。
 * Svelte 5 的 $state 响应式代理无法被 structuredClone 克隆（会抛 DataCloneError：
 * “#<Object> could not be cloned”），此时退回 JSON 序列化——
 * 角色状态的数据模型保证为 JSON 安全值（number/string/boolean/数组/普通对象）。
 */
export function clonePlain<T>(value: T): T {
	try {
		return structuredClone(value);
	} catch {
		return JSON.parse(JSON.stringify(value)) as T;
	}
}
