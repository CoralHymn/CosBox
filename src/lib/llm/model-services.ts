import { newId } from '../utils/id';
import { CUSTOM_PROVIDER_ID } from './providers';
import type { LlmConfig, ModelRole, ModelService } from './types';

/** 模型服务角色的中文标签（设置页分配区展示）。 */
export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
	chat: '对话模型',
	judge: '状态判断模型',
	generator: '生成模型'
};

/** 模型服务草稿：编辑表单的输入（id 缺省时新建）。 */
export interface ModelServiceDraft {
	id?: string;
	label: string;
	provider: ModelService['provider'];
	providerId: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	contextWindow?: number;
	maxTokens?: number;
	notes?: string;
}

/** 归一化并校验一个模型服务草稿（缺省值补全、数值钳制）。 */
export function normalizeModelService(draft: ModelServiceDraft): ModelService {
	const now = Date.now();
	const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '');
	const label = draft.label.trim() || draft.model.trim() || '未命名服务';
	return {
		id: draft.id?.trim() !== '' && draft.id !== undefined ? draft.id : newId(),
		label: label.slice(0, 40),
		provider: draft.provider,
		providerId: draft.provider === 'demo' ? CUSTOM_PROVIDER_ID : draft.providerId.trim() || CUSTOM_PROVIDER_ID,
		baseUrl,
		apiKey: draft.apiKey.trim(),
		model: draft.model.trim() || 'gpt-4o-mini',
		...(draft.contextWindow !== undefined && draft.contextWindow > 0
			? { contextWindow: Math.floor(draft.contextWindow) }
			: {}),
		...(draft.maxTokens !== undefined && draft.maxTokens > 0
			? { maxTokens: Math.floor(draft.maxTokens) }
			: {}),
		...(draft.notes !== undefined && draft.notes.trim() !== ''
			? { notes: draft.notes.trim() }
			: {}),
		createdAt: now
	};
}

/** 取某个角色绑定的模型服务 id。 */
export function modelServiceIdForRole(config: LlmConfig, role: ModelRole): string {
	if (role === 'chat') {
		return config.chatModelId ?? '';
	}
	if (role === 'judge') {
		return config.judgeModelId ?? '';
	}
	return config.generatorModelId ?? '';
}

/** 按 id 查找已保存的服务；不存在返回 undefined。 */
export function findModelService(
	config: LlmConfig,
	id: string
): ModelService | undefined {
	return (config.modelServices ?? []).find((service) => service.id === id);
}

/**
 * 按角色解析出真正用于请求的配置：
 * 角色绑定的服务存在时，用该服务的 provider/key/model/窗口/maxTokens 覆盖主配置；
 * 未绑定或服务缺失时回退主配置（老存档兼容）。
 */
export function resolveServiceConfig(config: LlmConfig, role: ModelRole): LlmConfig {
	const service = findModelService(config, modelServiceIdForRole(config, role));
	if (service === undefined) {
		return config;
	}
	return {
		...config,
		provider: service.provider,
		providerId: service.providerId,
		baseUrl: service.baseUrl,
		apiKey: service.apiKey,
		model: service.model,
		modelContextWindow: service.contextWindow ?? config.modelContextWindow,
		maxTokens: service.maxTokens ?? config.maxTokens
	};
}

/**
 * 迁移/自愈：老存档没有 modelServices 时，用主配置生成一条「默认模型」服务，
 * 三个角色都指向它；角色 id 缺失时回退到第一条服务。返回新配置对象。
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
			apiKey: config.apiKey,
			model: config.model,
			...(config.modelContextWindow !== undefined
				? { contextWindow: config.modelContextWindow }
				: {}),
			...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
			createdAt: now
		});
	}
	const firstId = services[0]!.id;
	const resolveId = (id: string | undefined): string => {
		if (id !== undefined && services.some((service) => service.id === id)) {
			return id;
		}
		return firstId;
	};
	return {
		...config,
		modelServices: services,
		chatModelId: resolveId(config.chatModelId),
		judgeModelId: resolveId(config.judgeModelId),
		generatorModelId: resolveId(config.generatorModelId)
	};
}
