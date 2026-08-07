import { describe, expect, it } from 'vitest';
import {
	ensureModelServiceBindings,
	findModelService,
	modelServiceIdForRole,
	normalizeModelService,
	resolveServiceConfig
} from './model-services';
import { DEFAULT_LLM_CONFIG } from './types';

const BASE = {
	...DEFAULT_LLM_CONFIG,
	provider: 'openai-compatible' as const,
	providerId: 'deepseek',
	baseUrl: 'https://api.deepseek.com/v1',
	apiKey: 'main-key',
	model: 'deepseek-v4-flash',
	maxTokens: 4096,
	modelContextWindow: 256_000
};

describe('normalizeModelService', () => {
	it('补全缺省字段并清理输入', () => {
		const service = normalizeModelService({
			label: '  小模型  ',
			provider: 'openai-compatible',
			providerId: 'moonshot',
			baseUrl: 'https://api.moonshot.cn/v1/',
			apiKey: '  key  ',
			model: ' kimi-k3 ',
			contextWindow: 128_000.9,
			maxTokens: 2048.9,
			notes: ' 备注 '
		});
		expect(service.id).not.toBe('');
		expect(service.label).toBe('小模型');
		expect(service.baseUrl).toBe('https://api.moonshot.cn/v1');
		expect(service.apiKey).toBe('key');
		expect(service.model).toBe('kimi-k3');
		expect(service.contextWindow).toBe(128_000);
		expect(service.maxTokens).toBe(2048);
		expect(service.notes).toBe('备注');
	});

	it('demo 服务 providerId 归一到 custom，空模型/名称有兜底', () => {
		const service = normalizeModelService({
			label: '',
			provider: 'demo',
			providerId: 'whatever',
			baseUrl: '',
			apiKey: '',
			model: '',
			contextWindow: undefined,
			maxTokens: undefined
		});
		expect(service.provider).toBe('demo');
		expect(service.providerId).toBe('custom');
		expect(service.model).not.toBe('');
		expect(service.label).not.toBe('');
	});

	it('非法数值被忽略', () => {
		const service = normalizeModelService({
			label: 'x',
			provider: 'openai-compatible',
			providerId: 'custom',
			baseUrl: '',
			apiKey: '',
			model: 'm',
			contextWindow: -1,
			maxTokens: 0
		});
		expect(service.contextWindow).toBeUndefined();
		expect(service.maxTokens).toBeUndefined();
	});
});

describe('resolveServiceConfig', () => {
	it('角色命中服务时用服务覆盖 provider/key/model/窗口/maxTokens', () => {
		const config = {
			...BASE,
			modelServices: [
				{
					id: 'cheap',
					label: '小模型',
					provider: 'openai-compatible' as const,
					providerId: 'moonshot',
					baseUrl: 'https://api.moonshot.cn/v1',
					apiKey: 'cheap-key',
					model: 'kimi-k3',
					contextWindow: 128_000,
					maxTokens: 1024,
					createdAt: 1
				}
			],
			judgeModelId: 'cheap'
		};
		const resolved = resolveServiceConfig(config, 'judge');
		expect(resolved.providerId).toBe('moonshot');
		expect(resolved.baseUrl).toBe('https://api.moonshot.cn/v1');
		expect(resolved.apiKey).toBe('cheap-key');
		expect(resolved.model).toBe('kimi-k3');
		expect(resolved.modelContextWindow).toBe(128_000);
		expect(resolved.maxTokens).toBe(1024);
	});

	it('服务缺省 contextWindow/maxTokens 时回退主配置', () => {
		const config = {
			...BASE,
			modelServices: [
				{
					id: 's',
					label: 's',
					provider: 'openai-compatible' as const,
					providerId: 'custom',
					baseUrl: '',
					apiKey: '',
					model: 'm',
					createdAt: 1
				}
			],
			chatModelId: 's'
		};
		const resolved = resolveServiceConfig(config, 'chat');
		expect(resolved.modelContextWindow).toBe(256_000);
		expect(resolved.maxTokens).toBe(4096);
	});

	it('角色未绑定或服务缺失时回退主配置', () => {
		const unbound = resolveServiceConfig(BASE, 'generator');
		expect(unbound.model).toBe(BASE.model);
		expect(unbound.apiKey).toBe(BASE.apiKey);
		expect(unbound.baseUrl).toBe(BASE.baseUrl);
		const missing = resolveServiceConfig({ ...BASE, chatModelId: 'missing' }, 'chat');
		expect(missing.model).toBe(BASE.model);
		expect(missing.apiKey).toBe(BASE.apiKey);
	});
});

describe('ensureModelServiceBindings', () => {
	it('老存档无服务时生成「默认模型」并绑定三个角色', () => {
		const migrated = ensureModelServiceBindings(BASE);
		expect(migrated.modelServices).toHaveLength(1);
		const service = migrated.modelServices![0]!;
		expect(service.id).toBe('default');
		expect(service.label).toBe('默认模型');
		expect(service.providerId).toBe('deepseek');
		expect(service.apiKey).toBe('main-key');
		expect(service.model).toBe('deepseek-v4-flash');
		expect(migrated.chatModelId).toBe('default');
		expect(migrated.judgeModelId).toBe('default');
		expect(migrated.generatorModelId).toBe('default');
	});

	it('角色 id 缺失或指向不存在服务时回退第一条', () => {
		const config = {
			...BASE,
			modelServices: [
				{
					id: 'a',
					label: 'A',
					provider: 'openai-compatible' as const,
					providerId: 'custom',
					baseUrl: '',
					apiKey: '',
					model: 'a',
					createdAt: 1
				}
			],
			chatModelId: 'missing',
			judgeModelId: 'a',
			generatorModelId: ''
		};
		const migrated = ensureModelServiceBindings(config);
		expect(migrated.chatModelId).toBe('a');
		expect(migrated.judgeModelId).toBe('a');
		expect(migrated.generatorModelId).toBe('a');
		expect(migrated.modelServices).toHaveLength(1);
	});
});

describe('helpers', () => {
	it('modelServiceIdForRole 按角色返回绑定 id', () => {
		const config = { ...BASE, chatModelId: 'c', judgeModelId: 'j', generatorModelId: 'g' };
		expect(modelServiceIdForRole(config, 'chat')).toBe('c');
		expect(modelServiceIdForRole(config, 'judge')).toBe('j');
		expect(modelServiceIdForRole(config, 'generator')).toBe('g');
	});

	it('findModelService 按 id 查找', () => {
		const service = {
			id: 's',
			label: 'S',
			provider: 'openai-compatible' as const,
			providerId: 'custom',
			baseUrl: '',
			apiKey: '',
			model: 'm',
			createdAt: 1
		};
		const config = { ...BASE, modelServices: [service] };
		expect(findModelService(config, 's')).toBe(service);
		expect(findModelService(config, 'nope')).toBeUndefined();
	});
});
