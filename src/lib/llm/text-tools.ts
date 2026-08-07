import type { ToolCall } from './types';

/**
 * 从模型输出的文本（正文或思考过程）中解析文本形式的工具调用。
 * 兜底场景：DeepSeek 等思考模型有时把调用写进 reasoning_content 或正文，
 * 却未发出结构化的 tool_calls（或代理在流式转发时丢失了 tool_calls）。
 * 只识别明确的「工具名(参数)」调用语法，避免把角色扮演台词误判为调用。
 */
export function extractTextToolCalls(text: string): ToolCall[] {
	const calls: ToolCall[] = [];
	for (const name of TOOL_NAMES) {
		// 工具名与括号之间只允许空格/制表符（不允许换行），避免思考结尾的
		// 「goto_location」接上正文里的「（……）」被误拼成一次调用。
		const pattern = new RegExp(`\\b${name}[ \\t]*[（(]\\s*([^）)]*)[）)]`, 'g');
		for (const match of text.matchAll(pattern)) {
			const args = parseCallArgs(match[1] ?? '');
			if (args === null) {
				continue;
			}
			const mapped = mapToolArgs(name, args);
			if (mapped !== null) {
				calls.push({
					id: `text_call_${calls.length}`,
					name,
					arguments: mapped
				});
			}
		}
	}
	// DeepSeek V4 等模型已知会把工具调用写成纯文本 JSON 对象（放在 content 而非 tool_calls
	// 字段）：兼容 {"tool": "advance_time", "args": {...}} / {"name": "...", "arguments": {...}}
	// 与 OpenAI 风格的 {"function": {"name": "...", "arguments": {...}}}。
	calls.push(...extractJsonToolCalls(text));
	return calls;
}

/** 支持解析的四个状态工具名。 */
const TOOL_NAMES = ['advance_time', 'goto_location', 'set_outfit', 'set_attribute'] as const;

/**
 * 解析括号内参数：
 * - JSON 对象（{"minutes":120}）直接解析；
 * - key=value / key:value 键值对；
 * - 无等号的单个值作为位置参数（advance_time(120) / goto_location(食堂)）。
 */
function parseCallArgs(inner: string): Record<string, unknown> | null {
	const trimmed = inner.trim();
	if (trimmed === '') {
		return null;
	}
	if (trimmed.startsWith('{')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}
	const pairs: Record<string, unknown> = {};
	let positional: string | null = null;
	for (const part of trimmed.split(',')) {
		const eq = part.match(/^\s*(?:["']?)([A-Za-z_][A-Za-z0-9_]*)(?:["']?)\s*[=:：]\s*(.+)$/);
		if (eq) {
			pairs[eq[1]!] = stripQuotes(eq[2]!.trim());
		} else if (part.trim() !== '') {
			positional = stripQuotes(part.trim());
		}
	}
	if (positional !== null) {
		pairs._positional = positional;
	}
	return Object.keys(pairs).length > 0 ? pairs : null;
}

/** 把解析出的参数按工具映射为合法调用参数；缺关键参数返回 null。 */
function mapToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
	if (name === 'advance_time') {
		const raw = args.minutes ?? args._positional;
		const minutes = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
		return Number.isFinite(minutes) ? { minutes } : null;
	}
	if (name === 'goto_location') {
		const value = args.name ?? args._positional;
		const nameValue = typeof value === 'string' ? value.trim() : '';
		return nameValue !== '' ? { name: nameValue } : null;
	}
	if (name === 'set_outfit') {
		const slot = typeof args.slot === 'string' ? args.slot.trim() : '';
		const item = args.item;
		const itemValue = item === null ? null : typeof item === 'string' ? item.trim() : '';
		if (slot === '' || itemValue === '') {
			return null;
		}
		return { slot, item: itemValue ?? null };
	}
	if (name === 'set_attribute') {
		const key = typeof args.key === 'string' ? args.key.trim() : '';
		const value = args.value;
		const valueText = typeof value === 'string' ? value.trim() : value;
		if (key === '' || valueText === undefined || valueText === null) {
			return null;
		}
		return { key, value: valueText };
	}
	return null;
}

/**
 * 从正文中扫描 JSON 对象形态的工具调用（DeepSeek 已知行为：把调用写进 content）。
 * 只接受包含合法工具名的对象（tool/name/function.name 均可），并且 args/arguments
 * 必须是 JSON 对象；其余大括号内容（角色台词等）不会被误判。
 */
function extractJsonToolCalls(text: string): ToolCall[] {
	const calls: ToolCall[] = [];
	let searchFrom = 0;
	while (searchFrom < text.length) {
		const open = text.indexOf('{', searchFrom);
		if (open === -1) {
			break;
		}
		const end = findMatchingBrace(text, open);
		if (end === -1) {
			break;
		}
		const candidate = text.slice(open, end + 1);
		try {
			const parsed: unknown = JSON.parse(candidate);
			const mapped = mapJsonToolCall(parsed);
			if (mapped !== null) {
				calls.push({
					id: `text_call_${calls.length}`,
					name: mapped.name,
					arguments: mapped.arguments
				});
			}
		} catch {
			// 不是合法 JSON 对象（可能是角色台词里的花括号），跳过。
		}
		searchFrom = end + 1;
	}
	return calls;
}

/** 从 JSON 对象中解析工具名与参数；不是合法工具调用返回 null。 */
function mapJsonToolCall(parsed: unknown): { name: string; arguments: Record<string, unknown> } | null {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	const fn = record.function;
	const name =
		typeof record.tool === 'string' && record.tool.trim() !== ''
			? record.tool
			: typeof record.name === 'string' && record.name.trim() !== ''
				? record.name
				: fn !== null && typeof fn === 'object' && !Array.isArray(fn) &&
						typeof (fn as Record<string, unknown>).name === 'string'
					? String((fn as Record<string, unknown>).name)
					: '';
	if (!TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number])) {
		return null;
	}
	const fnArgs = fn !== null && typeof fn === 'object' && !Array.isArray(fn)
		? (fn as Record<string, unknown>).arguments
		: undefined;
	let args: unknown = record.args ?? record.arguments ?? fnArgs;
	// OpenAI 风格序列化时 arguments 是 JSON 字符串，解析成对象再校验。
	if (typeof args === 'string' && args.trim() !== '') {
		try {
			args = JSON.parse(args);
		} catch {
			return null;
		}
	}
	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		return null;
	}
	const mapped = mapToolArgs(name, args as Record<string, unknown>);
	return mapped === null ? null : { name, arguments: mapped };
}

/** 从 openIndex 开始找匹配的右花括号（跳过字符串与转义），找不到返回 -1。 */
function findMatchingBrace(text: string, openIndex: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = openIndex; i < text.length; i += 1) {
		const ch = text[i]!;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth += 1;
		} else if (ch === '}') {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

/** 去掉参数值的常见引号（英文/中文引号与书名号）。 */
function stripQuotes(value: string): string {
	return value.replace(/^['"“”「『]+|['"“”」』]+$/g, '').trim();
}
