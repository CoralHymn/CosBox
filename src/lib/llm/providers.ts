import {
	DEFAULT_DECISION_MODEL_CONFIG,
	DEFAULT_LLM_CONFIG,
	type DecisionModelConfig,
	type LlmConfig
} from './types';
import type { WebSearchConfig } from '../search/types';

/** 主流模型服务商预设。 */
export interface LlmProviderPreset {
	/** 稳定 id（存入配置的 providerId）。 */
	id: string;
	/** 展示名。 */
	label: string;
	/** OpenAI-compatible 基址。 */
	baseUrl: string;
	/** 端点禁浏览器 CORS 直连，需走内置软件通道转发（缺省视为不需要）。 */
	useProxy?: boolean;
	/** 默认模型。 */
	defaultModel: string;
	/** 常用模型建议（datalist 下拉）。 */
	models: string[];
	/** 是否需要 API Key。 */
	requiresApiKey: boolean;
	/** 备注（选填）。 */
	notes?: string;
}

/**
 * 主流服务商预设目录（2026-08 核实）。
 * 模型名会随官方迭代，设置页可随时手改；baseUrl 均为 OpenAI-compatible 端点。
 */
export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
	{
		id: 'openai',
		label: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		defaultModel: 'gpt-5.6-terra',
		models: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano'],
		requiresApiKey: true
	},
	{
		id: 'anthropic',
		label: 'Anthropic Claude',
		baseUrl: 'https://api.anthropic.com/v1',
		defaultModel: 'claude-sonnet-4-6',
		models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
		requiresApiKey: true,
		notes: '通过 Anthropic 的 OpenAI 兼容端点接入'
	},
	{
		id: 'google',
		label: 'Google Gemini',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		defaultModel: 'gemini-2.5-flash',
		models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-pro'],
		requiresApiKey: true,
		notes: '通过 Google 官方 OpenAI 兼容端点接入'
	},
	{
		id: 'baidu',
		label: '百度千帆 ERNIE',
		baseUrl: 'https://qianfan.baidubce.com/v2',
		defaultModel: 'ernie-5.0-8k',
		models: ['ernie-5.0-8k', 'ernie-4.0-8k', 'ernie-lite-8k', 'ernie-speed-128k'],
		requiresApiKey: true,
		notes: '通过千帆 v2 OpenAI 兼容端点接入'
	},
	{
		id: 'tencent',
		label: '腾讯混元 Hunyuan',
		baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
		defaultModel: 'hunyuan-turbo',
		models: ['hunyuan-turbo', 'hunyuan-standard', 'hunyuan-lite'],
		requiresApiKey: true,
		notes: '通过腾讯云 OpenAI 兼容端点接入'
	},
	{
		id: 'yi',
		label: '零一万物 Yi',
		baseUrl: 'https://api.lingyiwanwu.com/v1',
		defaultModel: 'yi-large',
		models: ['yi-large', 'yi-medium'],
		requiresApiKey: true,
		notes: '通过零一万物 OpenAI 兼容端点接入'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com/v1',
		defaultModel: 'deepseek-v4-flash',
		models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
		requiresApiKey: true
	},
	{
		id: 'moonshot',
		label: 'Moonshot Kimi',
		baseUrl: 'https://api.moonshot.cn/v1',
		defaultModel: 'kimi-k3',
		models: ['kimi-k3', 'kimi-k2.5', 'moonshot-v1-8k'],
		requiresApiKey: true
	},
	{
		id: 'zhipu',
		label: '智谱 GLM',
		baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
		defaultModel: 'glm-5',
		models: ['glm-5', 'glm-4.7-flash', 'glm-4-flash', 'glm-4-plus'],
		requiresApiKey: true
	},
	{
		id: 'glm-coding',
		label: '智谱 GLM Coding Plan',
		baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
		defaultModel: 'glm-5.2',
		models: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
		requiresApiKey: true,
		notes: '通过 GLM Coding Plan 专属 OpenAI 兼容端点接入'
	},
	{
		id: 'qwen',
		label: '通义千问 Qwen',
		baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		defaultModel: 'qwen-max',
		models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-flagship'],
		requiresApiKey: true,
		notes: '通过阿里云百炼 OpenAI 兼容端点接入'
	},
	{
		id: 'minimax',
		label: 'MiniMax',
		baseUrl: 'https://api.minimax.io/v1',
		defaultModel: 'MiniMax-M3',
		models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-M2'],
		requiresApiKey: true,
		notes: '通过 MiniMax 国际 OpenAI 兼容端点接入'
	},
	{
		id: 'mistral',
		label: 'Mistral',
		baseUrl: 'https://api.mistral.ai/v1',
		defaultModel: 'mistral-large-latest',
		models: [
			'mistral-large-latest',
			'mistral-small-latest',
			'codestral-latest',
			'pixtral-large-latest'
		],
		requiresApiKey: true
	},
	{
		id: 'groq',
		label: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		defaultModel: 'llama-3.3-70b-versatile',
		models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
		requiresApiKey: true
	},
	{
		id: 'cerebras',
		label: 'Cerebras',
		baseUrl: 'https://api.cerebras.ai/v1',
		defaultModel: 'gpt-oss-120b',
		models: ['gpt-oss-120b', 'llama-3.3-70b', 'gemma-4-31b'],
		requiresApiKey: true
	},
	{
		id: 'xai',
		label: 'xAI Grok',
		baseUrl: 'https://api.x.ai/v1',
		defaultModel: 'grok-4.3',
		models: ['grok-4.3', 'grok-4.20-reasoning', 'grok-4.20-non-reasoning', 'grok-4-fast-reasoning'],
		requiresApiKey: true
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		defaultModel: 'openrouter/auto',
		models: [
			'openrouter/auto',
			'openai/gpt-5.6',
			'anthropic/claude-sonnet-4-6',
			'google/gemini-2.5-flash'
		],
		requiresApiKey: true,
		notes: '通过 OpenRouter 统一网关 OpenAI 兼容端点接入'
	},
	{
		id: 'opencode-go',
		label: 'OpenCode GO（订阅）',
		// opencode.ai 不允许浏览器 CORS 直连（OPTIONS 预检直接 404），故标 useProxy：
		// 请求前由 platform/http.ts 换成 /llm-proxy/<host>/ 逻辑前缀——浏览器
		// dev/preview 交给 vite.config.ts 的 llmRelay 中间件（D99），Tauri 打包版
		// 在 platform/http.ts 里还原成真实端点并走 HTTP 插件（D109 / D112）。
		baseUrl: 'https://opencode.ai/zen/go/v1',
		useProxy: true,
		defaultModel: 'kimi-k2.6',
		models: [
			'kimi-k2.6',
			'kimi-k2.7-code',
			'glm-5.2',
			'glm-5.1',
			'deepseek-v4-pro',
			'deepseek-v4-flash',
			'mimo-v2.5',
			'grok-4.5'
		],
		requiresApiKey: true,
		notes: '通过 OpenCode GO 订阅端点接入'
	},
	{
		id: 'opencode-zen',
		label: 'OpenCode Zen（按量计费）',
		baseUrl: 'https://opencode.ai/zen/v1',
		useProxy: true,
		defaultModel: 'minimax-m3',
		models: [
			'minimax-m3',
			'minimax-m2.7',
			'glm-5.1',
			'kimi-k2.6',
			'deepseek-v4-pro',
			'deepseek-v4-flash',
			'deepseek-v4-flash-free'
		],
		requiresApiKey: true,
		notes: '通过 OpenCode Zen 按量端点接入'
	},
	{
		id: 'command-code',
		label: 'Command Code GOAT（订阅）',
		// 与 OpenCode 相反：api.commandcode.ai 允许浏览器 CORS 直连（预检 204 +
		// Access-Control-Allow-Origin: *），因此不标 useProxy。
		baseUrl: 'https://api.commandcode.ai/provider/v1',
		defaultModel: 'xiaomi/mimo-v2.5',
		models: [
			'gpt-5.6-sol',
			'gpt-5.6-luna',
			'zai-org/GLM-5.2',
			'z-ai/glm-5.3-flash',
			'deepseek/deepseek-v4-pro',
			'deepseek/deepseek-v4-flash',
			'moonshotai/Kimi-K2.7-Code',
			'MiniMaxAI/MiniMax-M3',
			'google/gemini-3.8-flash',
			'Qwen/Qwen3.8-Max',
			'Qwen/Qwen3.7-Max',
			'Qwen/Qwen3.7-Plus',
			'Qwen/Qwen3.6-Plus',
			'xiaomi/mimo-v2.5',
			'xiaomi/mimo-v2.5-pro',
			'tencent/hy3-paid'
		],
		requiresApiKey: true,
		notes: '通过commandcode的 OpenAI 兼容端点接入'
	},
	{
		id: 'ollama',
		label: 'Ollama（本地）',
		baseUrl: 'http://localhost:11434/v1',
		defaultModel: 'qwen3:8b',
		models: ['qwen3:8b', 'llama3.1:8b', 'mistral:7b'],
		requiresApiKey: false,
		notes: '通过本地 Ollama OpenAI 兼容端点接入'
	},
	{
		id: 'litellm',
		label: 'LiteLLM Proxy（本地）',
		baseUrl: 'http://localhost:4000/v1',
		defaultModel: 'gpt-4o-mini',
		models: ['gpt-4o-mini', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
		requiresApiKey: false,
		notes: '通过本地 LiteLLM Proxy OpenAI 兼容端点接入'
	},
	{
		id: 'siliconflow',
		label: '硅基流动 SiliconFlow',
		baseUrl: 'https://api.siliconflow.cn/v1',
		defaultModel: 'deepseek-ai/DeepSeek-V3',
		models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B'],
		requiresApiKey: true,
		notes: '通过硅基流动 OpenAI 兼容端点接入'
	},
	{
		id: 'together',
		label: 'Together AI',
		baseUrl: 'https://api.together.xyz/v1',
		defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
		models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
		requiresApiKey: true
	},
	{
		id: 'vllm',
		label: 'vLLM（本地）',
		baseUrl: 'http://localhost:8000/v1',
		defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
		models: ['Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.1-8B-Instruct'],
		requiresApiKey: false,
		notes: '通过本地 vLLM OpenAI 兼容端点接入'
	},
	{
		id: 'azure',
		label: 'Azure OpenAI',
		baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1',
		defaultModel: 'gpt-4o',
		models: ['gpt-4o', 'gpt-4o-mini'],
		requiresApiKey: true,
		notes: '通过 Azure OpenAI 兼容端点接入'
	}
];

/** 自定义端点（不套用任何预设）。 */
export const CUSTOM_PROVIDER_ID = 'custom';

/** 按 id 查找预设；不存在返回 undefined。 */
export function findProviderPreset(id: string): LlmProviderPreset | undefined {
	return LLM_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/**
 * 旧存档升级：早期把「走内置通道」藏在 baseUrl 里（如 `/llm-proxy/zen/go/v1`，
 * 前缀后第一段是路径而非主机名，当时通道只指向 opencode.ai）。
 * 现在通道由 `useProxy` 表达，baseUrl 一律存真实绝对地址（见 D112）。
 */
export function upgradeLegacyProxyBaseUrl(
	baseUrl: string,
	useProxy?: boolean
): { baseUrl: string; useProxy: boolean } {
	if (!baseUrl.startsWith('/llm-proxy/')) {
		return { baseUrl, useProxy: useProxy ?? false };
	}
	return {
		baseUrl: `https://opencode.ai/${baseUrl.slice('/llm-proxy/'.length)}`,
		useProxy: true
	};
}

/** 应用预设：返回以该预设填充的完整配置（保留已有 key 之外的显式值）。 */
export function applyProviderPreset(config: LlmConfig, preset: LlmProviderPreset): LlmConfig {
	return {
		...config,
		provider: 'openai-compatible',
		providerId: preset.id,
		baseUrl: preset.baseUrl,
		useProxy: preset.useProxy ?? false,
		model: preset.defaultModel,
		apiKey: config.apiKey
	};
}

/**
 * 判断配置是否指向 DeepSeek 思考系模型。
 * DeepSeek V4（model 名含 `deepseek-*`）的思考模式不接受 `tool_choice` 参数，
 * 强发 `tool_choice: "required"` 会返回 400，因此 CosBox 在此类模型上放弃强制工具调用，
 * 改用「强提示 + 非流式重试」。
 * 通过 providerId 与模型名双方面检查，兼容第三方代理（如 SiliconFlow 的 `deepseek-ai/DeepSeek-V3`）。
 */
export function isDeepSeekModel(config: Pick<LlmConfig, 'providerId' | 'model'>): boolean {
	const model = config.model.toLowerCase();
	const providerId = config.providerId.toLowerCase();
	return providerId === 'deepseek' || model.includes('deepseek');
}

/** LLM 配置补丁：webSearch 允许部分字段（兼容旧版本存档）。 */
export interface LlmConfigPatch {
	provider?: LlmConfig['provider'];
	providerId?: string;
	baseUrl?: string;
	useProxy?: boolean;
	apiKey?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	modelContextWindow?: number;
	autoCompact?: boolean;
	compactThreshold?: number;
	stream?: boolean;
	allowAiStateTools?: boolean;
	/** 决策模型补执行开关（旧存档字段 llmStateConfirm 自动迁移）。 */
	decisionConfirm?: boolean;
	/** 旧版 LLM 状态确认开关。 */
	llmStateConfirm?: boolean;
	decisionModel?: Partial<DecisionModelConfig>;
	textToolFallback?: boolean;
	memoryEnabled?: boolean;
	memoryInjectLimit?: number;
	memoryAutoExtract?: boolean;
	modelServices?: LlmConfig['modelServices'];
	agentModelId?: string;
	agentModelEntryId?: string;
	/** 旧版三角色绑定字段：读取时迁移到智能体。 */
	chatModelId?: string;
	chatModelEntryId?: string;
	judgeModelId?: string;
	judgeModelEntryId?: string;
	generatorModelId?: string;
	generatorModelEntryId?: string;
	webSearch?: Partial<WebSearchConfig>;
}

/**
 * 归一化 LLM 配置：兼容旧版本存档（缺少 providerId / webSearch 字段）。
 * 返回完整配置，保证嵌套字段与默认值都存在。
 */
export function normalizeLlmConfig(partial: LlmConfigPatch): LlmConfig {
	const defaults = DEFAULT_LLM_CONFIG;
	const savedSearch = partial.webSearch;
	const search: WebSearchConfig = {
		enabled: savedSearch?.enabled ?? defaults.webSearch.enabled,
		provider: savedSearch?.provider ?? defaults.webSearch.provider,
		apiKey: savedSearch?.apiKey ?? defaults.webSearch.apiKey,
		maxResults: savedSearch?.maxResults ?? defaults.webSearch.maxResults
	};
	const endpoint = upgradeLegacyProxyBaseUrl(partial.baseUrl ?? defaults.baseUrl, partial.useProxy);
	const decisionDefaults = DEFAULT_DECISION_MODEL_CONFIG;
	const savedDecision = partial.decisionModel;
	const decisionModel: DecisionModelConfig = {
		provider: 'jev',
		baseUrl:
			(savedDecision?.baseUrl ?? decisionDefaults.baseUrl).trim().replace(/\/+$/, '') ||
			decisionDefaults.baseUrl,
		useProxy: savedDecision?.useProxy ?? decisionDefaults.useProxy,
		apiKey: savedDecision?.apiKey ?? decisionDefaults.apiKey,
		model: savedDecision?.model?.trim() || decisionDefaults.model,
		threshold: clampUnit(savedDecision?.threshold ?? decisionDefaults.threshold)
	};
	return {
		provider: partial.provider ?? defaults.provider,
		providerId: partial.providerId ?? CUSTOM_PROVIDER_ID,
		baseUrl: endpoint.baseUrl,
		useProxy: endpoint.useProxy,
		apiKey: partial.apiKey ?? defaults.apiKey,
		model: partial.model ?? defaults.model,
		temperature: partial.temperature ?? defaults.temperature,
		maxTokens: partial.maxTokens ?? defaults.maxTokens,
		modelContextWindow: partial.modelContextWindow ?? defaults.modelContextWindow,
		autoCompact: partial.autoCompact ?? defaults.autoCompact ?? true,
		compactThreshold: partial.compactThreshold ?? defaults.compactThreshold ?? 0.8,
		stream: partial.stream ?? defaults.stream ?? true,
		allowAiStateTools: partial.allowAiStateTools ?? defaults.allowAiStateTools ?? true,
		decisionConfirm: partial.decisionConfirm ?? partial.llmStateConfirm ?? false,
		decisionModel,
		textToolFallback: partial.textToolFallback ?? defaults.textToolFallback ?? true,
		memoryEnabled: partial.memoryEnabled ?? defaults.memoryEnabled ?? true,
		memoryInjectLimit: partial.memoryInjectLimit ?? defaults.memoryInjectLimit ?? 5,
		memoryAutoExtract: partial.memoryAutoExtract ?? defaults.memoryAutoExtract ?? false,
		modelServices: Array.isArray(partial.modelServices) ? [...partial.modelServices] : [],
		agentModelId: partial.agentModelId ?? partial.chatModelId ?? '',
		agentModelEntryId: partial.agentModelEntryId ?? partial.chatModelEntryId ?? '',
		webSearch: search
	};
}

/** 决策阈值规范到 0-1；非法值回退默认。 */
function clampUnit(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_DECISION_MODEL_CONFIG.threshold;
	}
	return Math.min(1, Math.max(0, value));
}
