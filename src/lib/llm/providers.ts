import { DEFAULT_LLM_CONFIG, type LlmConfig } from './types';
import type { WebSearchConfig } from '../search/types';

/** 主流模型服务商预设。 */
export interface LlmProviderPreset {
	/** 稳定 id（存入配置的 providerId）。 */
	id: string;
	/** 展示名。 */
	label: string;
	/** OpenAI-compatible 基址。 */
	baseUrl: string;
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
		notes: '通过 Anthropic 的 OpenAI 兼容端点（/chat/completions）接入'
	},
	{
		id: 'google',
		label: 'Google Gemini',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		defaultModel: 'gemini-2.5-flash',
		models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-pro'],
		requiresApiKey: true,
		notes: '使用 Google 官方 OpenAI 兼容端点'
	},
	{
		id: 'baidu',
		label: '百度千帆 ERNIE',
		baseUrl: 'https://qianfan.baidubce.com/v2',
		defaultModel: 'ernie-5.0-8k',
		models: ['ernie-5.0-8k', 'ernie-4.0-8k', 'ernie-lite-8k', 'ernie-speed-128k'],
		requiresApiKey: true,
		notes: '千帆 v2 OpenAI 兼容模式'
	},
	{
		id: 'tencent',
		label: '腾讯混元 Hunyuan',
		baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
		defaultModel: 'hunyuan-turbo',
		models: ['hunyuan-turbo', 'hunyuan-standard', 'hunyuan-lite'],
		requiresApiKey: true,
		notes: '腾讯云 OpenAI 兼容端点'
	},
	{
		id: 'yi',
		label: '零一万物 Yi',
		baseUrl: 'https://api.lingyiwanwu.com/v1',
		defaultModel: 'yi-large',
		models: ['yi-large', 'yi-medium'],
		requiresApiKey: true,
		notes: '零一万物官方兼容端点'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com/v1',
		defaultModel: 'deepseek-v4-flash',
		models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
		requiresApiKey: true,
		notes: 'deepseek-chat / deepseek-reasoner 别名已于 2026-07 弃用'
	},
	{
		id: 'moonshot',
		label: 'Moonshot Kimi',
		baseUrl: 'https://api.moonshot.cn/v1',
		defaultModel: 'kimi-k3',
		models: ['kimi-k3', 'kimi-k2.5', 'moonshot-v1-8k'],
		requiresApiKey: true,
		notes: '海外可改用 https://api.moonshot.ai/v1'
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
		notes:
			'GLM Coding Plan 订阅专属端点（与通用 /api/paas/v4 不通用）；海外可改用 https://api.z.ai/api/coding/paas/v4'
	},
	{
		id: 'qwen',
		label: '通义千问 Qwen',
		baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		defaultModel: 'qwen-max',
		models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-flagship'],
		requiresApiKey: true,
		notes: '阿里云百炼 OpenAI 兼容模式'
	},
	{
		id: 'minimax',
		label: 'MiniMax',
		baseUrl: 'https://api.minimax.io/v1',
		defaultModel: 'MiniMax-M3',
		models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-M2'],
		requiresApiKey: true,
		notes: '国际端点；国内用户可改用 https://api.minimaxi.com/v1；M3 支持 1M 上下文'
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
		requiresApiKey: true,
		notes: '以高速推理著称，模型列表动态更新'
	},
	{
		id: 'cerebras',
		label: 'Cerebras',
		baseUrl: 'https://api.cerebras.ai/v1',
		defaultModel: 'gpt-oss-120b',
		models: ['gpt-oss-120b', 'llama-3.3-70b', 'gemma-4-31b'],
		requiresApiKey: true,
		notes: '晶圆级芯片极速推理；模型列表动态更新，以 GET /v1/models 为准'
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
		notes: '统一网关，模型 ID 格式为 vendor/model，以 OpenRouter 列表为准'
	},
	{
		id: 'opencode-go',
		label: 'OpenCode GO（订阅）',
		// opencode.ai 不支持浏览器 CORS。/llm-proxy 是「逻辑前缀」：
		// 浏览器 dev/preview 由 Vite 代理转发（D99）；Tauri 打包版在
		// platform/http.ts 中重写回 https://opencode.ai 并走 HTTP 插件（D109）。
		baseUrl: '/llm-proxy/zen/go/v1',
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
		notes:
			'首月 $5、之后 $10/月的开源模型订阅网关，Key 在 opencode.ai/auth 获取；opencode.ai 不允许浏览器 CORS 直连，桌面/移动端经内置通道转发。MiniMax/Qwen 系模型仅走 Anthropic /messages 端点，此处不可用'
	},
	{
		id: 'opencode-zen',
		label: 'OpenCode Zen（按量计费）',
		baseUrl: '/llm-proxy/zen/v1',
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
		notes:
			'OpenCode 按量计费网关；opencode.ai 不允许浏览器 CORS 直连，桌面/移动端经内置通道转发。Claude/GPT/Gemini 系走原生端点，此处仅可用 Chat Completions 模型'
	},
	{
		id: 'ollama',
		label: 'Ollama（本地）',
		baseUrl: 'http://localhost:11434/v1',
		defaultModel: 'qwen3:8b',
		models: ['qwen3:8b', 'llama3.1:8b', 'mistral:7b'],
		requiresApiKey: false,
		notes: '模型名以本地 ollama pull 的标签为准'
	},
	{
		id: 'litellm',
		label: 'LiteLLM Proxy（本地）',
		baseUrl: 'http://localhost:4000/v1',
		defaultModel: 'gpt-4o-mini',
		models: ['gpt-4o-mini', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
		requiresApiKey: false,
		notes: '模型名由 LiteLLM 代理配置决定'
	},
	{
		id: 'siliconflow',
		label: '硅基流动 SiliconFlow',
		baseUrl: 'https://api.siliconflow.cn/v1',
		defaultModel: 'deepseek-ai/DeepSeek-V3',
		models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B'],
		requiresApiKey: true,
		notes: '注册赠送额度，模型 ID 为 org/name 格式'
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
		notes: '本地部署的 vLLM 服务，模型名取决于部署参数'
	},
	{
		id: 'azure',
		label: 'Azure OpenAI',
		baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1',
		defaultModel: 'gpt-4o',
		models: ['gpt-4o', 'gpt-4o-mini'],
		requiresApiKey: true,
		notes: '把地址中的 YOUR_RESOURCE 替换为你的资源名；模型名填部署名'
	}
];

/** 自定义端点（不套用任何预设）。 */
export const CUSTOM_PROVIDER_ID = 'custom';

/** 按 id 查找预设；不存在返回 undefined。 */
export function findProviderPreset(id: string): LlmProviderPreset | undefined {
	return LLM_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/** 应用预设：返回以该预设填充的完整配置（保留已有 key 之外的显式值）。 */
export function applyProviderPreset(config: LlmConfig, preset: LlmProviderPreset): LlmConfig {
	return {
		...config,
		provider: 'openai-compatible',
		providerId: preset.id,
		baseUrl: preset.baseUrl,
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
	apiKey?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	modelContextWindow?: number;
	autoCompact?: boolean;
	compactThreshold?: number;
	stream?: boolean;
	allowAiStateTools?: boolean;
	llmStateConfirm?: boolean;
	textToolFallback?: boolean;
	memoryEnabled?: boolean;
	memoryInjectLimit?: number;
	memoryAutoExtract?: boolean;
	modelServices?: LlmConfig['modelServices'];
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
	return {
		provider: partial.provider ?? defaults.provider,
		providerId: partial.providerId ?? CUSTOM_PROVIDER_ID,
		baseUrl: partial.baseUrl ?? defaults.baseUrl,
		apiKey: partial.apiKey ?? defaults.apiKey,
		model: partial.model ?? defaults.model,
		temperature: partial.temperature ?? defaults.temperature,
		maxTokens: partial.maxTokens ?? defaults.maxTokens,
		modelContextWindow: partial.modelContextWindow ?? defaults.modelContextWindow,
		autoCompact: partial.autoCompact ?? defaults.autoCompact ?? true,
		compactThreshold: partial.compactThreshold ?? defaults.compactThreshold ?? 0.8,
		stream: partial.stream ?? defaults.stream ?? false,
		allowAiStateTools: partial.allowAiStateTools ?? defaults.allowAiStateTools ?? false,
		llmStateConfirm: partial.llmStateConfirm ?? defaults.llmStateConfirm ?? false,
		textToolFallback: partial.textToolFallback ?? defaults.textToolFallback ?? true,
		memoryEnabled: partial.memoryEnabled ?? defaults.memoryEnabled ?? true,
		memoryInjectLimit: partial.memoryInjectLimit ?? defaults.memoryInjectLimit ?? 5,
		memoryAutoExtract: partial.memoryAutoExtract ?? defaults.memoryAutoExtract ?? false,
		modelServices: Array.isArray(partial.modelServices) ? [...partial.modelServices] : [],
		chatModelId: partial.chatModelId ?? '',
		chatModelEntryId: partial.chatModelEntryId ?? '',
		judgeModelId: partial.judgeModelId ?? '',
		judgeModelEntryId: partial.judgeModelEntryId ?? '',
		generatorModelId: partial.generatorModelId ?? '',
		generatorModelEntryId: partial.generatorModelEntryId ?? '',
		webSearch: search
	};
}
