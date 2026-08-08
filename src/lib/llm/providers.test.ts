import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import {
	applyProviderPreset,
	CUSTOM_PROVIDER_ID,
	findProviderPreset,
	isDeepSeekModel,
	LLM_PROVIDER_PRESETS,
	normalizeLlmConfig
} from './providers';
import { DEFAULT_LLM_CONFIG } from './types';

describe('LLM_PROVIDER_PRESETS', () => {
	it('每个预设字段完整且 id 唯一', () => {
		const ids = new Set<string>();
		for (const preset of LLM_PROVIDER_PRESETS) {
			expect(preset.id.trim()).not.toBe('');
			expect(preset.label.trim()).not.toBe('');
			// 允许绝对端点，或 /llm-proxy/ 相对路径（无浏览器 CORS 的服务走开发代理）。
			expect(preset.baseUrl).toMatch(/^(https?:\/\/|\/llm-proxy\/)/);
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
		// OpenCode 系走 /llm-proxy 相对路径：opencode.ai 不支持浏览器 CORS，
		// 由 vite.config.ts 的开发/预览代理转发（见 providers.ts 注释）。
		expect(findProviderPreset('opencode-go')?.baseUrl).toBe('/llm-proxy/zen/go/v1');
		expect(findProviderPreset('opencode-go')?.models).toContain('kimi-k2.6');
		expect(findProviderPreset('opencode-zen')?.baseUrl).toBe('/llm-proxy/zen/v1');
		expect(findProviderPreset('glm-coding')?.baseUrl).toBe(
			'https://open.bigmodel.cn/api/coding/paas/v4'
		);
		expect(findProviderPreset('minimax')?.baseUrl).toBe('https://api.minimax.io/v1');
		expect(findProviderPreset('cerebras')?.baseUrl).toBe('https://api.cerebras.ai/v1');
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
		expect(result.webSearch).toEqual(DEFAULT_LLM_CONFIG.webSearch);
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

	it('保留 stream，缺省回退 false', () => {
		expect(normalizeLlmConfig({ stream: true }).stream).toBe(true);
		expect(normalizeLlmConfig({}).stream).toBe(false);
	});

	it('保留模型服务列表与三角色绑定，缺省时为空', () => {
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
			chatModelId: 's1',
			chatModelEntryId: 'm1',
			judgeModelId: 's1',
			judgeModelEntryId: 'm1',
			generatorModelId: 's1',
			generatorModelEntryId: 'm1'
		});
		expect(result.modelServices).toEqual([service]);
		expect(result.chatModelId).toBe('s1');
		expect(result.chatModelEntryId).toBe('m1');
		expect(result.judgeModelId).toBe('s1');
		expect(result.generatorModelId).toBe('s1');
		const empty = normalizeLlmConfig({});
		expect(empty.modelServices).toEqual([]);
		expect(empty.chatModelId).toBe('');
		expect(empty.chatModelEntryId).toBe('');
	});
});
