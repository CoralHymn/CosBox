/** 迁移/兼容用默认工作区 id：存量单工作区数据升级后统一归入该 id。 */
export const DEFAULT_WORKSPACE_ID = 'default';

/**
 * 当前工作区定位器：一个可变的 id 持有者。
 * 仓储在构造时注入同一个实例，所有表查询按 `get()` 过滤；
 * 切换工作区只需 `set()` 后触发各方重载，仓储对象零重建。
 */
export class WorkspaceScope {
	private current: string = DEFAULT_WORKSPACE_ID;
	private readonly listeners = new Set<() => void>();

	/** 当前工作区 id。 */
	get(): string {
		return this.current;
	}

	/** 切换当前工作区 id 并通知订阅者（id 未变化时不通知）。 */
	set(id: string): void {
		if (this.current === id) {
			return;
		}
		this.current = id;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/** 订阅工作区切换，返回取消订阅函数。 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
