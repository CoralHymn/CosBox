import {
	KIND_LABELS,
	parseGeneratedItems,
	type GeneratedItem,
	type GeneratorKind
} from '../llm/generator';

/** 单个配置段导出文件的版本。 */
export const CONFIG_PART_VERSION = 1;

/** 把配置段序列化为可分享的 JSON 文本（带类型标识）。 */
export function serializeConfigPart(kind: GeneratorKind, items: readonly GeneratedItem[]): string {
	return JSON.stringify({ kind, version: CONFIG_PART_VERSION, items }, null, 2);
}

/** 解析配置段导入文件；类型不符或内容非法时返回问题列表。 */
export function parseConfigPart(
	kind: GeneratorKind,
	raw: string
): { items: GeneratedItem[]; issues: string[] } {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { items: [], issues: ['文件不是合法的 JSON'] };
	}
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		return { items: [], issues: ['文件结构不正确'] };
	}
	const record = data as Record<string, unknown>;
	if (record.kind !== kind) {
		return {
			items: [],
			issues: [
				`文件类型不匹配：需要「${KIND_LABELS[kind]}」，实际为「${String(record.kind ?? '未知')}」`
			]
		};
	}
	if (record.version !== CONFIG_PART_VERSION) {
		return {
			items: [],
			issues: [`不支持的版本：${String(record.version)}`]
		};
	}
	if (!Array.isArray(record.items)) {
		return { items: [], issues: ['文件缺少 items 数组'] };
	}
	return parseGeneratedItems(kind, JSON.stringify(record.items));
}
