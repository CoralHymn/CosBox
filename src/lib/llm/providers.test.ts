import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../search/types';
import {
	applyProviderPreset,
	CUSTOM_PROVIDER_ID,
	findProviderPreset,
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
			expect(preset.baseUrl).toMatch(/^https?:\/\//);
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
});
