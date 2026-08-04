/** CosBox 统一错误基类：所有可预期错误都携带稳定 code。 */
export class CosBoxError extends Error {
	/** 稳定错误码，便于 UI 与测试断言。 */
	readonly code: string;

	constructor(message: string, code = 'COSBOX_ERROR') {
		super(message);
		this.name = new.target.name;
		this.code = code;
	}
}

/** 角色状态校验失败。 */
export class StateValidationError extends CosBoxError {
	constructor(message: string) {
		super(message, 'STATE_INVALID');
	}
}

/** 快照版本图操作失败（节点缺失、断链、成环等）。 */
export class SnapshotError extends CosBoxError {
	constructor(message: string) {
		super(message, 'SNAPSHOT');
	}
}

/** IndexedDB 读写失败。 */
export class StorageError extends CosBoxError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, 'STORAGE');
		if (options?.cause !== undefined) {
			this.cause = options.cause;
		}
	}
}

/** LLM 调用失败（网络、鉴权、格式异常等）。 */
export class LlmError extends CosBoxError {
	/** HTTP 状态码（仅 openai-compatible provider 有）。 */
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message, 'LLM');
		this.status = status;
	}
}

/** 网页搜索失败（网络、鉴权、格式异常等）。 */
export class SearchError extends CosBoxError {
	constructor(message: string) {
		super(message, 'SEARCH');
	}
}

/** 角色卡导入/导出失败。 */
export class ImportError extends CosBoxError {
	constructor(message: string) {
		super(message, 'IMPORT');
	}
}

/**
 * 把任意抛出的值转换为面向用户的简短中文提示。
 * 永远不向用户泄露堆栈。
 */
export function toUserMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return '发生未知错误，请重试';
}
