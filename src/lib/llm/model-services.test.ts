import { describe, expect, it } from 'vitest';
import {
	bindingValue,
	ensureModelServiceBindings,
	findModelEntry,
	findModelService,
	modelEntryIdForRole,
	modelServiceIdForRole,
	normalizeModelEntry,
	normalizeModelService,
	parseBindingValue,
	resolveServiceConfig
} from './model-services';
import { DEFAULT_LLM_CONFIG } from './types';
import type { ModelService } from './types';

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

function service(overrides: Partial<ModelService> = {}): ModelService {
	return {
		id: 's1',
		label: '服务',
		provider: 'openai-compatible',
		providerId: 'deepseek',
		baseUrl: 'https://api.deepseek.com/v1',
		apiKey: 'k',
		models: [
			{ id: 'm1', model: 'deepseek-v4-flash', contextWindow: 256_000, maxTokens: 4096 },
			{ id: 'm2', model: 'deepseek-v4-pro', contextWindow: 256_000, maxTokens: 8192 }
		],
		createdAt: 1,
		...overrides
	};
}

describe('normalizeModelEntry', () => {
	it('补全 id、清理数值', () => {
		const entry = normalizeModelEntry({
			model: ' kimi-k3 ',
			contextWindow: 128_000.9,
			maxTokens: 0
		});
		expect(entry.id).not.toBe('');
		expect(entry.model).toBe('kimi-k3');
		expect(entry.contextWindow).toBe(128_000);
		expect(entry.maxTokens).toBeUndefined();
	});
});

describe('normalizeModelService', () => {
	it('保留多模型条目并清理输入', () => {
		const service = normalizeModelService({
			label: '  小模型  ',
			provider: 'openai-compatible',
			providerId: 'moonshot',
			baseUrl: 'https://api.moonshot.cn/v1/',
			apiKey: '  key  ',
			models: [
				{ model: 'kimi-k3', contextWindow: 128_000.9, maxTokens: 2048.9 },
				{ model: 'kimi-k2.5' }
			],
			notes: ' 备注 '
		});
		expect(service.id).not.toBe('');
		expect(service.label).toBe('小模型');
		expect(service.baseUrl).toBe('https://api.moonshot.cn/v1');
		expect(service.apiKey).toBe('key');
		expect(service.models).toHaveLength(2);
		expect(service.models[0]).toMatchObject({
			model: 'kimi-k3',
			contextWindow: 128_000,
			maxTokens: 2048
		});
		expect(service.models[1]).toMatchObject({ model: 'kimi-k2.5' });
		expect(service.notes).toBe('备注');
	});

	it('兼容旧草稿：顶层 model/contextWindow/maxTokens 转成单条模型条目', () => {
		const draft = {
			label: '',
			provider: 'openai-compatible' as const,
			providerId: 'custom',
			baseUrl: '',
			apiKey: '',
			models: [],
			model: 'deepseek-v4-flash',
			contextWindow: 256_000,
			maxTokens: 4096
		};
		const service = normalizeModelService(draft);
		expect(service.models).toHaveLength(1);
		expect(service.models[0]!.model).toBe('deepseek-v4-flash');
		expect(service.models[0]!.contextWindow).toBe(256_000);
		expect(service.models[0]!.maxTokens).toBe(4096);
	});

	it('demo 服务 providerId 归一到 custom', () => {
		const service = normalizeModelService({
			label: 'demo',
			provider: 'demo',
			providerId: 'whatever',
			baseUrl: '',
			apiKey: '',
			models: [{ model: 'demo' }]
		});
		expect(service.provider).toBe('demo');
		expect(service.providerId).toBe('custom');
	});

	it('useProxy 仅在开启时写入，缺省不落字段', () => {
		const relay = normalizeModelService({
			label: 'OpenCode',
			provider: 'openai-compatible',
			providerId: 'opencode-go',
			baseUrl: 'https://opencode.ai/zen/go/v1/',
			useProxy: true,
			apiKey: 'k',
			models: [{ model: 'kimi-k2.6' }]
		});
		expect(relay.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(relay.useProxy).toBe(true);
		const direct = normalizeModelService({
			label: 'DeepSeek',
			provider: 'openai-compatible',
			providerId: 'deepseek',
			baseUrl: 'https://api.deepseek.com/v1',
			apiKey: 'k',
			models: [{ model: 'deepseek-v4-flash' }]
		});
		expect(direct.useProxy).toBeUndefined();
	});

	it('旧草稿把通道藏在 baseUrl 前缀里，归一化时搬到 useProxy', () => {
		const upgraded = normalizeModelService({
			label: 'OpenCode',
			provider: 'openai-compatible',
			providerId: 'opencode-go',
			baseUrl: '/llm-proxy/zen/go/v1',
			apiKey: 'k',
			models: [{ model: 'kimi-k2.6' }]
		});
		expect(upgraded.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(upgraded.useProxy).toBe(true);
	});
});

describe('resolveServiceConfig', () => {
	it('按服务 + 模型条目合成请求配置', () => {
		const config = {
			...BASE,
			modelServices: [
				service({
					id: 'cheap',
					providerId: 'moonshot',
					baseUrl: 'https://api.moonshot.cn/v1',
					apiKey: 'cheap-key',
					models: [
						{ id: 'k3', model: 'kimi-k3', contextWindow: 128_000, maxTokens: 1024 },
						{ id: 'k2', model: 'kimi-k2.5' }
					]
				})
			],
			judgeModelId: 'cheap',
			judgeModelEntryId: 'k3'
		};
		const resolved = resolveServiceConfig(config, 'judge');
		expect(resolved.providerId).toBe('moonshot');
		expect(resolved.baseUrl).toBe('https://api.moonshot.cn/v1');
		expect(resolved.apiKey).toBe('cheap-key');
		expect(resolved.model).toBe('kimi-k3');
		expect(resolved.modelContextWindow).toBe(128_000);
		expect(resolved.maxTokens).toBe(1024);
		// 通道跟着服务走：服务没开就不因主配置开着而误转发。
		expect(resolved.useProxy).toBe(false);
	});

	it('服务标记了通道时按服务地址走内置转发', () => {
		const config = {
			...BASE,
			modelServices: [
				service({
					id: 'go',
					providerId: 'opencode-go',
					baseUrl: 'https://opencode.ai/zen/go/v1',
					useProxy: true,
					apiKey: 'k',
					models: [{ id: 'm', model: 'kimi-k2.6' }]
				})
			],
			chatModelId: 'go',
			chatModelEntryId: 'm'
		};
		const resolved = resolveServiceConfig(config, 'chat');
		expect(resolved.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(resolved.useProxy).toBe(true);
	});

	it('模型条目缺省时用服务第一条；条目字段缺省时回退主配置', () => {
		const config = {
			...BASE,
			modelServices: [
				service({
					id: 's',
					providerId: 'custom',
					baseUrl: '',
					apiKey: '',
					models: [{ id: 'only', model: 'm' }]
				})
			],
			chatModelId: 's',
			chatModelEntryId: ''
		};
		const resolved = resolveServiceConfig(config, 'chat');
		expect(resolved.model).toBe('m');
		expect(resolved.modelContextWindow).toBe(256_000);
		expect(resolved.maxTokens).toBe(4096);
	});

	it('角色未绑定或服务/条目缺失时回退主配置', () => {
		const unbound = resolveServiceConfig(BASE, 'generator');
		expect(unbound.model).toBe(BASE.model);
		expect(unbound.apiKey).toBe(BASE.apiKey);
		const missing = resolveServiceConfig({ ...BASE, chatModelId: 'missing' }, 'chat');
		expect(missing.model).toBe(BASE.model);
		const noEntry = resolveServiceConfig(
			{
				...BASE,
				modelServices: [service({ models: [] })],
				chatModelId: 's1'
			},
			'chat'
		);
		expect(noEntry.model).toBe(BASE.model);
	});
});

describe('ensureModelServiceBindings', () => {
	it('老存档无服务时生成「默认模型」并绑定三个角色与条目', () => {
		const migrated = ensureModelServiceBindings(BASE);
		expect(migrated.modelServices).toHaveLength(1);
		const service = migrated.modelServices![0]!;
		expect(service.id).toBe('default');
		expect(service.label).toBe('默认模型');
		expect(service.providerId).toBe('deepseek');
		expect(service.apiKey).toBe('main-key');
		expect(service.models[0]!.model).toBe('deepseek-v4-flash');
		expect(migrated.chatModelId).toBe('default');
		expect(migrated.chatModelEntryId).toBe(service.models[0]!.id);
		expect(migrated.judgeModelId).toBe('default');
		expect(migrated.generatorModelId).toBe('default');
	});

	it('已存服务的旧式 /llm-proxy 相对地址在自愈时升级', () => {
		const legacy = service({
			baseUrl: '/llm-proxy/zen/go/v1',
			models: [{ id: 'm', model: 'kimi-k2.6' }]
		});
		const migrated = ensureModelServiceBindings({
			...BASE,
			modelServices: [legacy],
			chatModelId: 's1'
		});
		const upgraded = migrated.modelServices![0]!;
		expect(upgraded.baseUrl).toBe('https://opencode.ai/zen/go/v1');
		expect(upgraded.useProxy).toBe(true);
		// 未命中旧格式的服务保持原样。
		expect(
			ensureModelServiceBindings({ ...BASE, modelServices: [service()] }).modelServices![0]!.baseUrl
		).toBe('https://api.deepseek.com/v1');
	});

	it('老格式服务（顶层 model）迁移为单条模型条目', () => {
		const legacy = {
			...service(),
			models: undefined,
			model: 'deepseek-v4-pro',
			contextWindow: 256_000,
			maxTokens: 8192
		} as unknown as ModelService;
		const migrated = ensureModelServiceBindings({
			...BASE,
			modelServices: [legacy],
			chatModelId: 's1'
		});
		expect(migrated.modelServices![0]!.models).toHaveLength(1);
		expect(migrated.modelServices![0]!.models[0]!.model).toBe('deepseek-v4-pro');
		expect(migrated.chatModelEntryId).toBe(migrated.modelServices![0]!.models[0]!.id);
	});

	it('角色条目 id 缺失或不存在时回退该服务第一条', () => {
		const migrated = ensureModelServiceBindings({
			...BASE,
			modelServices: [service()],
			chatModelId: 's1',
			chatModelEntryId: 'missing'
		});
		expect(migrated.chatModelEntryId).toBe('m1');
	});
});

describe('helpers', () => {
	it('modelServiceIdForRole / modelEntryIdForRole 按角色返回绑定 id', () => {
		const config = {
			...BASE,
			chatModelId: 'c',
			chatModelEntryId: 'cm',
			judgeModelId: 'j',
			judgeModelEntryId: 'jm',
			generatorModelId: 'g',
			generatorModelEntryId: 'gm'
		};
		expect(modelServiceIdForRole(config, 'chat')).toBe('c');
		expect(modelEntryIdForRole(config, 'chat')).toBe('cm');
		expect(modelServiceIdForRole(config, 'judge')).toBe('j');
		expect(modelEntryIdForRole(config, 'judge')).toBe('jm');
		expect(modelServiceIdForRole(config, 'generator')).toBe('g');
		expect(modelEntryIdForRole(config, 'generator')).toBe('gm');
	});

	it('findModelService / findModelEntry 查找与首条回退', () => {
		const modelService = service();
		const config = { ...BASE, modelServices: [modelService] };
		expect(findModelService(config, 's1')).toBe(modelService);
		expect(findModelService(config, 'nope')).toBeUndefined();
		expect(findModelEntry(modelService, 'm2')?.model).toBe('deepseek-v4-pro');
		expect(findModelEntry(modelService, 'missing')?.id).toBe('m1');
	});

	it('bindingValue / parseBindingValue 往返', () => {
		const value = bindingValue('s1', 'm2');
		expect(value).toBe('s1::m2');
		expect(parseBindingValue(value)).toEqual({ serviceId: 's1', entryId: 'm2' });
		expect(parseBindingValue('bad')).toBeNull();
		expect(parseBindingValue('a::')).toBeNull();
		expect(parseBindingValue('::b')).toBeNull();
	});
});
