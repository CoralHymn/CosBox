import { LlmError } from '../core/errors';
import { applyProxyPrefix, platformFetch } from '../platform/http';

/** 从服务端获取的模型条目。 */
export interface FetchedModel {
	id: string;
	/** 服务端声明的上下文窗口（token）；未知为 undefined。 */
	contextWindow?: number;
}

/**
 * 从 OpenAI-compatible /models 响应中提取模型列表。
 * 兼容常见上下文窗口字段：context_window / context_length / max_context_length /
 * max_context_window / meta.context_length（Ollama 等）。
 */
export function parseModelListResponse(data: unknown): FetchedModel[] {
	if (!isRecord(data) || !Array.isArray(data.data)) {
		return [];
	}
	const models: FetchedModel[] = [];
	for (const entry of data.data) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
			continue;
		}
		const contextWindow = readContextWindow(entry);
		models.push(contextWindow === undefined ? { id: entry.id } : { id: entry.id, contextWindow });
	}
	return models;
}

/** 拉取模型列表（带 Authorization）。失败抛 LlmError。 */
export async function fetchModelList(
	baseUrl: string,
	apiKey: string,
	useProxy?: boolean
): Promise<FetchedModel[]> {
	const base = baseUrl.trim().replace(/\/+$/, '');
	if (base === '') {
		throw new LlmError('未配置模型服务地址');
	}

	let response: Response;
	try {
		response = await platformFetch(applyProxyPrefix(`${base}/models`, useProxy), {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
			}
		});
	} catch (err) {
		throw new LlmError(`无法连接模型服务：${err instanceof Error ? err.message : '网络错误'}`);
	}

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new LlmError(
			`模型服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
			response.status
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		throw new LlmError(
			`模型服务返回了无法解析的响应：${err instanceof Error ? err.message : 'JSON 错误'}`
		);
	}
	return parseModelListResponse(body);
}

/** 连接测试：GET /models 成功即通过；失败抛 LlmError。 */
export async function testConnection(
	baseUrl: string,
	apiKey: string,
	useProxy?: boolean
): Promise<void> {
	await fetchModelList(baseUrl, apiKey, useProxy);
}

/** 从模型条目中读取上下文窗口字段；缺失或非法返回 undefined。 */
function readContextWindow(entry: Record<string, unknown>): number | undefined {
	const candidates = [
		entry.context_window,
		entry.context_length,
		entry.max_context_length,
		entry.max_context_window
	];
	for (const value of candidates) {
		const parsed = toPositiveInt(value);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	if (isRecord(entry.meta)) {
		const parsed = toPositiveInt(entry.meta.context_length);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	return undefined;
}

/** 读取正整数；缺失/非法返回 undefined。 */
function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

/** 类型守卫：非空对象（Record）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
