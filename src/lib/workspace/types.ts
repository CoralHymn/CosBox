/** 工作区元信息：注册表中的轻量条目（完整数据分散在各业务表与作用域 kv 中）。 */
export interface WorkspaceMeta {
	id: string;
	name: string;
	createdAt: number;
	/** 最近一次进入/切换时间（列表排序用）。 */
	updatedAt: number;
}
