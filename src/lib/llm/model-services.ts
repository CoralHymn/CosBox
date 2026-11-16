import { newId } from '../utils/id';
import { CUSTOM_PROVIDER_ID, upgradeLegacyProxyBaseUrl } from './providers';
import type { LlmConfig, ModelEntry, ModelService } from './types';

/** 模型服务角色的中文标签（设置页分配区展示）。 */
export const AGENT_MODEL_LABEL = '智能体';

/** 模型条目草稿：编辑表单里的一行模型。 */
export interface ModelEntryDraft {
	id?: string;
	model: string;
	contextWindow?: number;
	maxTokens?: number;
}

/** 模型服务草稿：编辑表单的输入（id 缺省时新建）。 */
export interface ModelServiceDraft {
	id?: string;
	label: string;
	provider: ModelService['provider'];
	providerId: string;
	baseUrl: string;
	useProxy?: boolean;
	apiKey: string;
	models: ModelEntryDraft[];
	notes?: string;
}

/** 归一化一个模型条目（去空白、数值钳制、id 缺省生成）。 */
export function normalizeModelEntry(draft: ModelEntryDraft): ModelEntry {
	return {
		id: draft.id?.trim() !== '' && draft.id !== undefined ? draft.id : newId(),
		model: draft.model.trim() || 'gpt-4o-mini',
		...(draft.contextWindow !== undefined && draft.contextWindow > 0
			? { contextWindow: Math.floor(draft.contextWindow) }
			: {}),
		...(draft.maxTokens !== undefined && draft.maxTokens > 0
			? { maxTokens: Math.floor(draft.maxTokens) }
			: {})
	};
}

/**
 * 归一化并校验一个模型服务草稿（缺省值补全、数值钳制）。
 * 兼容旧草稿：仍可能带顶层 model/contextWindow/maxTokens，会自动转成单条模型条目。
 */
export function normalizeModelService(draft: ModelServiceDraft): ModelService {
	const now = Date.now();
	const endpoint = upgradeLegacyProxyBaseUrl(
		draft.baseUrl.trim().replace(/\/+$/, ''),
		draft.useProxy
	);
	const legacyModel = (draft as unknown as { model?: string }).model?.trim() ?? '';
	const label = draft.label.trim() || legacyModel || '未命名服务';
	const models = draft.models.map(normalizeModelEntry);
	if (models.length === 0 && legacyModel !== '') {
		models.push({
			id: 'm-default',
			model: legacyModel,
			...((draft as unknown as { contextWindow?: number }).contextWindow !== undefined
				? {
						contextWindow: Math.floor(
							(draft as unknown as { contextWindow?: number }).contextWindow as number
						)
					}
				: {}),
			...((draft as unknown as { maxTokens?: number }).maxTokens !== undefined
				? {
						maxTokens: Math.floor((draft as unknown as { maxTokens?: number }).maxTokens as number)
					}
				: {})
		});
	}
	return {
		id: draft.id?.trim() !== '' && draft.id !== undefined ? draft.id : newId(),
		label: label.slice(0, 40),
		provider: draft.provider,
		providerId:
			draft.provider === 'demo'
				? CUSTOM_PROVIDER_ID
				: draft.providerId.trim() || CUSTOM_PROVIDER_ID,
		baseUrl: endpoint.baseUrl,
		...(endpoint.useProxy ? { useProxy: true } : {}),
		apiKey: draft.apiKey.trim(),
		models,
		...(draft.notes !== undefined && draft.notes.trim() !== ''
			? { notes: draft.notes.trim() }
			: {}),
		createdAt: now
	};
}

/** 在服务下按 id 查模型条目；缺省返回第一条。 */
export function findModelEntry(service: ModelService, entryId: string): ModelEntry | undefined {
	const entries = service.models ?? [];
	const hit = entries.find((entry) => entry.id === entryId);
	return hit ?? entries[0];
}

/** 按 id 查找已保存的服务；不存在返回 undefined。 */
export function findModelService(config: LlmConfig, id: string): ModelService | undefined {
	return (config.modelServices ?? []).find((service) => service.id === id);
}

/**
 * 解析智能体真正用于请求的配置：
 * 绑定的服务存在时，用该服务 provider/key 与绑定的模型条目（model/窗口/maxTokens）覆盖主配置；
 * 未绑定或服务缺失时回退主配置（老存档兼容）。
 */
export function resolveServiceConfig(config: LlmConfig): LlmConfig {
	const service = findModelService(config, config.agentModelId ?? '');
	if (service === undefined) {
		return config;
	}
	const entry = findModelEntry(service, config.agentModelEntryId ?? '');
	if (entry === undefined) {
		return config;
	}
	return {
		...config,
		provider: service.provider,
		providerId: service.providerId,
		baseUrl: service.baseUrl,
		useProxy: service.useProxy ?? false,
		apiKey: service.apiKey,
		model: entry.model,
		modelContextWindow: entry.contextWindow ?? config.modelContextWindow,
		maxTokens: entry.maxTokens ?? config.maxTokens
	};
}

/**
 * 迁移/自愈：老存档没有 modelServices 时，用主配置生成一条「默认模型」服务，
 * 智能体指向它；绑定 id 缺失时回退到第一条服务。返回新配置对象。
 */
export function ensureModelServiceBindings(config: LlmConfig): LlmConfig {
	const services = [...(config.modelServices ?? [])];
	if (services.length === 0) {
		const now = Date.now();
		services.push({
			id: 'default',
			label: '默认模型',
			provider: config.provider,
			providerId: config.providerId,
			baseUrl: config.baseUrl,
			useProxy: config.useProxy,
			apiKey: config.apiKey,
			models: [
				{
					id: 'm-default',
					model: config.model,
					...(config.modelContextWindow !== undefined
						? { contextWindow: config.modelContextWindow }
						: {}),
					...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {})
				}
			],
			createdAt: now
		});
	}
	// 老格式服务迁移：通道信息从 baseUrl 前缀搬到 useProxy（D112）；
	// 顶层 model/contextWindow/maxTokens 转成单条模型条目。
	const migratedServices = services.map((item) => {
		const endpoint = upgradeLegacyProxyBaseUrl(item.baseUrl, item.useProxy);
		const service: ModelService = {
			...item,
			baseUrl: endpoint.baseUrl,
			...(endpoint.useProxy ? { useProxy: true } : {})
		};
		if ((service.models ?? []).length > 0) {
			return service;
		}
		const legacy = service as ModelService & {
			model?: string;
			contextWindow?: number;
			maxTokens?: number;
		};
		return {
			...service,
			models: [
				{
					id: 'm-default',
					model: legacy.model ?? config.model,
					...(legacy.contextWindow !== undefined ? { contextWindow: legacy.contextWindow } : {}),
					...(legacy.maxTokens !== undefined ? { maxTokens: legacy.maxTokens } : {})
				}
			]
		};
	});
	const firstId = services[0]!.id;
	const firstEntryId = migratedServices[0]?.models[0]?.id ?? '';
	const resolveId = (id: string | undefined): string => {
		if (id !== undefined && services.some((service) => service.id === id)) {
			return id;
		}
		return firstId;
	};
	const resolveEntryId = (serviceId: string, entryId: string | undefined): string => {
		const service = migratedServices.find((item) => item.id === serviceId);
		if (
			entryId !== undefined &&
			service !== undefined &&
			service.models.some((entry) => entry.id === entryId)
		) {
			return entryId;
		}
		return service?.models[0]?.id ?? firstEntryId;
	};
	const agentService = resolveId(config.agentModelId);
	return {
		...config,
		modelServices: migratedServices,
		agentModelId: agentService,
		agentModelEntryId: resolveEntryId(agentService, config.agentModelEntryId)
	};
}

/** 角色绑定下拉的选项值：`服务id::模型条目id`（便于一键切换模型）。 */
export function bindingValue(serviceId: string, entryId: string): string {
	return `${serviceId}::${entryId}`;
}

/** 解析绑定下拉值；非法格式返回 null。 */
export function parseBindingValue(value: string): { serviceId: string; entryId: string } | null {
	const separator = value.indexOf('::');
	if (separator <= 0 || separator === value.length - 2) {
		return null;
	}
	return {
		serviceId: value.slice(0, separator),
		entryId: value.slice(separator + 2)
	};
}
