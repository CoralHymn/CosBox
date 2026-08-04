import type { ChatMessage, TokenUsage } from './types';

/** 每 1M token 的美元定价；null 表示该档未知（按输入价估算缓存价）。 */
export interface ModelPricing {
	input: number;
	output: number;
	cachedInput: number | null;
}

/** 已知模型的上下文窗口与定价信息。 */
export interface ModelInfo {
	contextWindow: number;
	pricing: ModelPricing;
}

/**
 * 主流模型信息目录（2026-08 调研）。
 * 定价为本地估算表，单位 USD/1M tokens；未知模型返回 undefined，UI 显示「—」。
 */
const MODEL_CATALOG: Record<string, ModelInfo> = {
	'gpt-5.6-terra': {
		contextWindow: 400_000,
		pricing: { input: 2.5, output: 15, cachedInput: 0.25 }
	},
	'gpt-5.6-luna': { contextWindow: 400_000, pricing: { input: 1, output: 6, cachedInput: null } },
	'gpt-5.6-sol': { contextWindow: 400_000, pricing: { input: 5, output: 30, cachedInput: null } },
	'gpt-5.3-codex': {
		contextWindow: 400_000,
		pricing: { input: 3.5, output: 28, cachedInput: 0.35 }
	},
	'claude-haiku-4-5': {
		contextWindow: 200_000,
		pricing: { input: 1, output: 5, cachedInput: null }
	},
	'claude-sonnet-4-6': {
		contextWindow: 200_000,
		pricing: { input: 3, output: 15, cachedInput: null }
	},
	'claude-opus-4-7': {
		contextWindow: 200_000,
		pricing: { input: 5, output: 25, cachedInput: null }
	},
	'gemini-2.5-flash': {
		contextWindow: 1_000_000,
		pricing: { input: 0.3, output: 2.5, cachedInput: 0.025 }
	},
	'gemini-2.5-pro': {
		contextWindow: 1_000_000,
		pricing: { input: 1.25, output: 10, cachedInput: 0.3125 }
	},
	'gemini-3-flash': {
		contextWindow: 1_000_000,
		pricing: { input: 0.5, output: 3, cachedInput: null }
	},
	'gemini-3-pro': {
		contextWindow: 1_000_000,
		pricing: { input: 4, output: 18, cachedInput: null }
	},
	'deepseek-v4-flash': {
		contextWindow: 256_000,
		pricing: { input: 0.14, output: 0.28, cachedInput: 0.0028 }
	},
	'deepseek-v4-pro': {
		contextWindow: 256_000,
		pricing: { input: 0.435, output: 0.87, cachedInput: 0.003625 }
	},
	'kimi-k3': { contextWindow: 128_000, pricing: { input: 3, output: 15, cachedInput: null } },
	'kimi-k2.6': { contextWindow: 128_000, pricing: { input: 0.95, output: 4, cachedInput: null } },
	'kimi-k2.5': { contextWindow: 128_000, pricing: { input: 0.6, output: 3, cachedInput: null } },
	'glm-5': { contextWindow: 200_000, pricing: { input: 1, output: 3.2, cachedInput: null } },
	'grok-4.3': { contextWindow: 1_000_000, pricing: { input: 1.25, output: 2.5, cachedInput: 0.2 } },
	'grok-4.20': { contextWindow: 1_000_000, pricing: { input: 2, output: 6, cachedInput: 0.5 } },
	'grok-4.5': { contextWindow: 1_000_000, pricing: { input: 2, output: 6, cachedInput: 0.5 } },
	'llama-3.3-70b': {
		contextWindow: 128_000,
		pricing: { input: 0.59, output: 0.79, cachedInput: null }
	},
	'llama-3.1-8b': {
		contextWindow: 128_000,
		pricing: { input: 0.05, output: 0.08, cachedInput: null }
	},
	'mistral-large': {
		contextWindow: 100_000,
		pricing: { input: 0.5, output: 1.5, cachedInput: null }
	},
	'mistral-medium': {
		contextWindow: 100_000,
		pricing: { input: 1.5, output: 7.5, cachedInput: null }
	},
	hunyuan: { contextWindow: 200_000, pricing: { input: 0.14, output: 0.56, cachedInput: null } },
	'qwen-max': { contextWindow: 128_000, pricing: { input: 1.6, output: 6.4, cachedInput: null } },
	'qwen-plus': { contextWindow: 128_000, pricing: { input: 0.8, output: 2, cachedInput: null } },
	'qwen-turbo': { contextWindow: 128_000, pricing: { input: 0.3, output: 0.6, cachedInput: null } }
};

/** 匹配中日韩字符（含全角符号与假名），启发式按 1 字符 ≈ 1 token。 */
const CJK_RE =
	/[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u31C0-\u31EF\u3200-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\uAC00-\uD7AF]/;

/** 每条消息的角色/分隔符开销（token）。 */
const PER_MESSAGE_OVERHEAD = 4;
/** 每个工具调用的参数开销（token）。 */
const PER_TOOL_CALL_OVERHEAD = 8;

/**
 * 启发式估算文本 token 数：
 * CJK 字符 1 字符 ≈ 1 token，其余按 4 字符 ≈ 1 token。
 * 仅用于本地费用/上下文占比展示，非精确统计。
 */
export function estimateTokens(text: string): number {
	if (text === '') {
		return 0;
	}
	let sum = 0;
	for (const char of text) {
		sum += CJK_RE.test(char) ? 1 : 0.25;
	}
	return Math.max(1, Math.ceil(sum));
}

/** 估算单条消息的 token 数：内容 + 角色开销 + 工具调用开销。 */
export function estimateMessageTokens(message: ChatMessage): number {
	return (
		estimateTokens(message.content) +
		PER_MESSAGE_OVERHEAD +
		(message.toolCalls?.length ?? 0) * PER_TOOL_CALL_OVERHEAD
	);
}

/** 估算消息数组的总 token 数。 */
export function estimateMessagesTokens(messages: ReadonlyArray<ChatMessage>): number {
	return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

/** 合并两次请求的 token 用量（agent 循环累加）。 */
export function sumUsage(first: TokenUsage, second: TokenUsage): TokenUsage {
	return {
		promptTokens: first.promptTokens + second.promptTokens,
		completionTokens: first.completionTokens + second.completionTokens,
		cachedTokens: first.cachedTokens + second.cachedTokens
	};
}

/**
 * 按模型 id 查找已知信息。
 * 匹配顺序：精确 → 最长前缀 → 包含（key 长度 ≥5，避免误匹配）。
 */
export function findModelInfo(model: string): ModelInfo | undefined {
	const normalized = model.trim().toLowerCase();
	if (normalized === '') {
		return undefined;
	}
	const direct = MODEL_CATALOG[normalized];
	if (direct) {
		return direct;
	}
	const keys = Object.keys(MODEL_CATALOG).sort((a, b) => b.length - a.length);
	for (const key of keys) {
		if (normalized.startsWith(key)) {
			return MODEL_CATALOG[key];
		}
	}
	for (const key of keys) {
		if (key.length >= 5 && normalized.includes(key)) {
			return MODEL_CATALOG[key];
		}
	}
	return undefined;
}

/**
 * 估算一次请求的费用（USD）。
 * 缓存 token 优先用缓存价；缓存价未知时按输入价计。未知模型返回 null。
 */
export function estimateCost(usage: TokenUsage, info: ModelInfo | undefined): number | null {
	if (!info) {
		return null;
	}
	const cached = Math.min(usage.cachedTokens, usage.promptTokens);
	const uncached = usage.promptTokens - cached;
	const cachedPrice = info.pricing.cachedInput ?? info.pricing.input;
	const inputCost = (uncached * info.pricing.input + cached * cachedPrice) / 1_000_000;
	const outputCost = (usage.completionTokens * info.pricing.output) / 1_000_000;
	return roundToSix(inputCost + outputCost);
}

/** 解析上下文窗口：优先使用服务端/配置值，其次查本地目录；都未知返回 null。 */
export function resolveContextWindow(
	configured: number | null | undefined,
	model: string
): number | null {
	if (configured !== undefined && configured !== null && configured > 0) {
		return Math.floor(configured);
	}
	return findModelInfo(model)?.contextWindow ?? null;
}

/** 保留 6 位小数的费用金额，避免浮点误差显示。 */
function roundToSix(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}
