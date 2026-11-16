import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import {
	applyProviderPreset,
	CUSTOM_PROVIDER_ID,
	findProviderPreset,
	isDeepSeekModel,
	LLM_PROVIDER_PRESETS,
	normalizeLlmConfig,
	upgradeLegacyProxyBaseUrl
} from './providers';
import { DEFAULT_LLM_CONFIG } from './types';

describe('LLM_PROVIDER_PRESETS', () => {
	it('每个预设字段完整且 id 唯一', () => {
		const ids = new Set<string>();
		for (const preset of LLM_PROVIDER_PRESETS) {
			expect(preset.id.trim()).not.toBe('');
			expect(preset.label.trim()).not.toBe('');
			// baseUrl 一律是真实绝对端点；是否经内置通道转发由 useProxy 表达（D112）。
			expect(preset.baseUrl).toMatch(/^https?:\/\//);
			// 通道只改写 https 端点：标了 useProxy 却是 http 的预设会被静默直连。
			if (preset.useProxy === true) {
				expect(preset.baseUrl.startsWith('https://')).toBe(true);
			}
			expect(preset.defaultModel.trim()).not.toBe('');
			expect(preset.models.length).toBeGreaterThan(0);
			expect(ids.has(preset.id)).toBe(false);
			ids.add(preset.id);
		}
	});

	it('预设 baseUrl 不以斜杠结尾', () => {
		for (const preset of LLM_PROVIDER_PRESETS) {
			expect(preset.baseUrl.endsWith('/')).toBe(false);
		}
	});

	it('默认模型都在候选模型列表内', () => {
		for (const preset of LLM_PROVIDER_PRESETS) {
			expect(preset.models).toContain(preset.defaultModel);
		}
	});

	it('包含订阅/网关类预设（OpenCode GO、GLM Coding Plan 等）', () => {
		// opencode.ai 禁浏览器 CORS 直连：地址存真实的 https 端点，
		// 由 useProxy 决定是否经内置通道转发（见 providers.ts 注释与 D112）。
		expect(findProviderPreset('opencode-go')?.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(findProviderPreset('opencode-go')?.useProxy).toBe(true);
		expect(findProviderPreset('opencode-go')?.models).toContain('kimi-k2.6');
		expect(findProviderPreset('opencode-zen')?.baseUrl).toBe('https://opencode.ai/zen/v1');
		expect(findProviderPreset('opencode-zen')?.useProxy).toBe(true);
		expect(findProviderPreset('glm-coding')?.baseUrl).toBe(
			'https://open.bigmodel.cn/api/coding/paas/v4'
		);
		expect(findProviderPreset('minimax')?.baseUrl).toBe('https://api.minimax.io/v1');
		expect(findProviderPreset('cerebras')?.baseUrl).toBe('https://api.cerebras.ai/v1');
	});

	it('Command Code GOAT 直连，不走内置通道', () => {
		// 实测 api.commandcode.ai 预检返回 204 + Access-Control-Allow-Origin: *，
		// 与 opencode.ai 相反，因此这个预设必须保持不标 useProxy。
		const preset = findProviderPreset('command-code');
		expect(preset?.label).toBe('Command Code GOAT（订阅）');
		expect(preset?.baseUrl).toBe('https://api.commandcode.ai/provider/v1');
		expect(preset?.useProxy).toBeUndefined();
		expect(preset?.requiresApiKey).toBe(true);
		// 默认模型按用户要求选便宜的 mimo，不要退回按 token 计费的 GPT 系。
		expect(preset?.defaultModel).toBe('xiaomi/mimo-v2.5');
		expect(preset?.models).toContain(preset?.defaultModel);
		// 模型 id 必须是 /models 返回的带 org 前缀形式。
		expect(preset?.models).toContain('deepseek/deepseek-v4-pro');
		expect(preset?.models).toContain('zai-org/GLM-5.2');
	});
});

describe('findProviderPreset', () => {
	it('按 id 命中预设', () => {
		expect(findProviderPreset('deepseek')?.label).toBe('DeepSeek');
	});

	it('未知 id（含自定义）返回 undefined', () => {
		expect(findProviderPreset('custom')).toBeUndefined();
		expect(findProviderPreset('not-exist')).toBeUndefined();
	});
});

describe('applyProviderPreset', () => {
	it('填充预设字段并保留已有 apiKey', () => {
		const preset = findProviderPreset('qwen')!;
		const result = applyProviderPreset({ ...DEFAULT_LLM_CONFIG, apiKey: 'keep-me' }, preset);
		expect(result.provider).toBe('openai-compatible');
		expect(result.providerId).toBe('qwen');
		expect(result.baseUrl).toBe(preset.baseUrl);
		expect(result.model).toBe(preset.defaultModel);
		expect(result.apiKey).toBe('keep-me');
		expect(result.useProxy).toBe(false);
		expect(result.webSearch).toEqual(DEFAULT_LLM_CONFIG.webSearch);
	});

	it('需要转发时把预设的 useProxy 带进配置', () => {
		const preset = findProviderPreset('opencode-go')!;
		const result = applyProviderPreset({ ...DEFAULT_LLM_CONFIG }, preset);
		expect(result.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(result.useProxy).toBe(true);
	});
});

describe('upgradeLegacyProxyBaseUrl', () => {
	it('把通道藏在 baseUrl 里的旧存档升级成绝对端点 + useProxy', () => {
		expect(upgradeLegacyProxyBaseUrl('/llm-proxy/zen/go/v1')).toEqual({
			baseUrl: 'https://opencode.ai/zen/go/v1',
			useProxy: true
		});
		expect(upgradeLegacyProxyBaseUrl('/llm-proxy/zen/v1', false)).toEqual({
			baseUrl: 'https://opencode.ai/zen/v1',
			useProxy: true
		});
	});

	it('已是绝对端点时保持不变，useProxy 缺省视为关闭', () => {
		expect(upgradeLegacyProxyBaseUrl('https://api.deepseek.com/v1')).toEqual({
			baseUrl: 'https://api.deepseek.com/v1',
			useProxy: false
		});
		expect(upgradeLegacyProxyBaseUrl('https://opencode.ai/zen/go/v1', true)).toEqual({
			baseUrl: 'https://opencode.ai/zen/go/v1',
			useProxy: true
		});
	});
});

describe('isDeepSeekModel', () => {
	it('providerId 或模型名命中 DeepSeek 时返回 true', () => {
		expect(isDeepSeekModel({ providerId: 'deepseek', model: 'deepseek-v4-flash' })).toBe(true);
		expect(isDeepSeekModel({ providerId: 'custom', model: 'deepseek-v4-pro' })).toBe(true);
		expect(isDeepSeekModel({ providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3' })).toBe(
			true
		);
	});

	it('非 DeepSeek 配置返回 false', () => {
		expect(isDeepSeekModel({ providerId: 'custom', model: 'gpt-4o-mini' })).toBe(false);
		expect(isDeepSeekModel({ providerId: 'openai', model: 'gpt-5.6-terra' })).toBe(false);
	});
});

describe('normalizeLlmConfig', () => {
	it('空输入回退到默认值（兼容旧版本存储）', () => {
		const result = normalizeLlmConfig({});
		expect(result.provider).toBe(DEFAULT_LLM_CONFIG.provider);
		expect(result.providerId).toBe(CUSTOM_PROVIDER_ID);
		expect(result.baseUrl).toBe(DEFAULT_LLM_CONFIG.baseUrl);
		expect(result.model).toBe(DEFAULT_LLM_CONFIG.model);
		expect(result.webSearch).toEqual(DEFAULT_LLM_CONFIG.webSearch);
	});

	it('保留显式提供的字段', () => {
		const result = normalizeLlmConfig({
			provider: 'openai-compatible',
			providerId: 'deepseek',
			baseUrl: 'https://api.deepseek.com/v1',
			apiKey: 'k',
			model: 'deepseek-chat',
			temperature: 0.3,
			maxTokens: 2048,
			webSearch: {
				enabled: true,
				provider: 'serper',
				apiKey: 's',
				maxResults: 8
			}
		});
		expect(result.provider).toBe('openai-compatible');
		expect(result.providerId).toBe('deepseek');
		expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
		expect(result.temperature).toBe(0.3);
		expect(result.maxTokens).toBe(2048);
		expect(result.webSearch).toEqual({
			enabled: true,
			provider: 'serper',
			apiKey: 's',
			maxResults: 8
		});
	});

	it('webSearch 部分缺省时逐字段回退默认值', () => {
		const result = normalizeLlmConfig({ webSearch: { enabled: true } });
		expect(result.webSearch.enabled).toBe(true);
		expect(result.webSearch.provider).toBe(DEFAULT_WEB_SEARCH_CONFIG.provider);
		expect(result.webSearch.apiKey).toBe(DEFAULT_WEB_SEARCH_CONFIG.apiKey);
		expect(result.webSearch.maxResults).toBe(DEFAULT_WEB_SEARCH_CONFIG.maxResults);
	});

	it('保留 modelContextWindow，缺省时为 undefined', () => {
		const result = normalizeLlmConfig({ modelContextWindow: 65_536 });
		expect(result.modelContextWindow).toBe(65_536);
		expect(normalizeLlmConfig({}).modelContextWindow).toBeUndefined();
	});

	it('保留 autoCompact 与 compactThreshold，缺省回退默认', () => {
		const result = normalizeLlmConfig({ autoCompact: false, compactThreshold: 0.6 });
		expect(result.autoCompact).toBe(false);
		expect(result.compactThreshold).toBe(0.6);
		expect(normalizeLlmConfig({}).autoCompact).toBe(true);
		expect(normalizeLlmConfig({}).compactThreshold).toBe(0.8);
	});

	it('保留 stream，缺省回退 true', () => {
		expect(normalizeLlmConfig({ stream: true }).stream).toBe(true);
		expect(normalizeLlmConfig({}).stream).toBe(true);
		expect(normalizeLlmConfig({ stream: false }).stream).toBe(false);
	});

	it('允许 AI 自主修改状态缺省开启', () => {
		expect(normalizeLlmConfig({}).allowAiStateTools).toBe(true);
		expect(normalizeLlmConfig({ allowAiStateTools: false }).allowAiStateTools).toBe(false);
	});

	it('保留模型服务列表与智能体绑定，缺省时为空', () => {
		const service = {
			id: 's1',
			label: '服务',
			provider: 'openai-compatible' as const,
			providerId: 'deepseek',
			baseUrl: 'https://api.deepseek.com/v1',
			apiKey: 'k',
			models: [{ id: 'm1', model: 'deepseek-v4-flash' }],
			createdAt: 1
		};
		const result = normalizeLlmConfig({
			modelServices: [service],
			agentModelId: 's1',
			agentModelEntryId: 'm1'
		});
		expect(result.modelServices).toEqual([service]);
		expect(result.agentModelId).toBe('s1');
		expect(result.agentModelEntryId).toBe('m1');
		const empty = normalizeLlmConfig({});
		expect(empty.modelServices).toEqual([]);
		expect(empty.agentModelId).toBe('');
		expect(empty.agentModelEntryId).toBe('');
	});

	it('旧存档三角色绑定迁移为智能体', () => {
		const result = normalizeLlmConfig({
			chatModelId: 's1',
			chatModelEntryId: 'm1',
			judgeModelId: 'j',
			generatorModelId: 'g'
		});
		expect(result.agentModelId).toBe('s1');
		expect(result.agentModelEntryId).toBe('m1');
	});

	it('llmStateConfirm 迁移为决策模型补执行开关', () => {
		expect(normalizeLlmConfig({ llmStateConfirm: true }).decisionConfirm).toBe(true);
		expect(normalizeLlmConfig({}).decisionConfirm).toBe(false);
	});

	it('useProxy 缺省为关闭，旧式 /llm-proxy 相对地址自动升级', () => {
		expect(normalizeLlmConfig({ baseUrl: 'https://api.deepseek.com/v1' }).useProxy).toBe(false);
		expect(
			normalizeLlmConfig({ baseUrl: 'https://opencode.ai/zen/v1', useProxy: true }).useProxy
		).toBe(true);
		const legacy = normalizeLlmConfig({ baseUrl: '/llm-proxy/zen/go/v1' });
		expect(legacy.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(legacy.useProxy).toBe(true);
	});
});
