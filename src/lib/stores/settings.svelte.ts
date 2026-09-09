import { SvelteSet } from 'svelte/reactivity';
import { ensureModelServiceBindings } from '../llm/model-services';
import { normalizeLlmConfig } from '../llm/providers';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
import { defaultSystemPrompt } from '../context/pipeline';
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from '../sync/types';
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from '../theme/theme';
import type { KvRepository } from '../db/kv-repo';
import type { ScopedKv } from '../db/scoped-kv';

/** 应用级角色档案：名字 + 五段提示词配置。 */
export interface AppProfile {
	name: string;
	/**
	 * 系统提示词：回复规则 / 破甲词；空值表示使用内置默认模板。
	 * 原「角色档案 → 系统提示」字段迁移到这里，沿用同一持久化键。
	 */
	systemPrompt: string | null;
	/** 人物提示词：AI 扮演的角色身份与性格。 */
	characterPrompt?: string | null;
	/** 用户提示词：AI 对用户的认知。 */
	userPrompt?: string | null;
	/** 世界观提示词：故事发生的世界设定。 */
	worldPrompt?: string | null;
	/** 风格提示词：期望的文风（如鲁迅、余华的风格）。 */
	stylePrompt?: string | null;
}

/** 应用级键：模型服务 / 同步设置 / 主题（不随工作区切换）。 */
const LLM_KEY = 'settings.llm';
const SYNC_KEY = 'settings.sync';
const THEME_KEY = 'settings.theme';
/** 工作区级键（经 scopedKv 自动带 `ws:{id}:` 前缀）：角色档案与开发者开关。 */
const PROFILE_KEY = 'settings.profile';
const DEVELOPER_KEY = 'settings.developer';

/** 默认角色档案：与内置角色「绫音」及默认系统提示模板一致。 */
export const DEFAULT_PROFILE: AppProfile = {
	name: '绫音',
	systemPrompt: defaultSystemPrompt('绫音'),
	characterPrompt: null,
	userPrompt: null,
	worldPrompt: null,
	stylePrompt: null
};

/** 把任意存档档案规整为完整 AppProfile（老存档自动补齐新字段）。 */
export function normalizeProfile(profile: AppProfile): AppProfile {
	return {
		name: profile.name?.trim() || DEFAULT_PROFILE.name,
		systemPrompt: profile.systemPrompt ?? null,
		characterPrompt: profile.characterPrompt ?? null,
		userPrompt: profile.userPrompt ?? null,
		worldPrompt: profile.worldPrompt ?? null,
		stylePrompt: profile.stylePrompt ?? null
	};
}

/**
 * 设置 store：LLM 配置与角色档案的持久化封装。
 * LLM / 同步 / 主题是应用级设置（全局 kv）；
 * 角色档案与开发者开关是工作区级设置（作用域 kv），切换工作区后调用
 * `reloadWorkspaceScoped()` 重读。
 */
export function createSettingsStore(kv: KvRepository, scopedKv: ScopedKv) {
	let config = $state<LlmConfig>({ ...DEFAULT_LLM_CONFIG });
	let profile = $state<AppProfile>({ ...DEFAULT_PROFILE });
	let developerMode = $state(false);
	let sync = $state<SyncSettings>({ ...DEFAULT_SYNC_SETTINGS });
	let theme = $state<ThemeConfig>({ ...DEFAULT_THEME_CONFIG });
	let loaded = $state(false);
	const listeners = new SvelteSet<() => void>();

	function emit(): void {
		for (const listener of listeners) {
			listener();
		}
	}

	/** 从 kv 加载设置；首次使用默认值。 */
	async function load(): Promise<void> {
		const [savedConfig, savedProfile, savedDeveloper, savedSync, savedTheme] = await Promise.all([
			kv.get<LlmConfig>(LLM_KEY),
			scopedKv.get<AppProfile>(PROFILE_KEY),
			scopedKv.get<boolean>(DEVELOPER_KEY),
			kv.get<SyncSettings>(SYNC_KEY),
			kv.get<ThemeConfig>(THEME_KEY)
		]);
		if (savedConfig) {
			const normalized = normalizeLlmConfig(savedConfig);
			// 老存档迁移：无模型服务列表时用主配置生成「默认模型」服务并绑定三个角色；
			// 迁移结果与存档不同则写回，保证后续保存不丢角色绑定。
			const migrated = ensureModelServiceBindings(normalized);
			config = migrated;
			if (JSON.stringify(migrated) !== JSON.stringify(normalized)) {
				await kv.set(LLM_KEY, migrated);
			}
		}
		if (savedProfile) {
			profile = normalizeProfile(savedProfile);
		}
		developerMode = savedDeveloper === true;
		if (savedSync) {
			sync = { ...DEFAULT_SYNC_SETTINGS, ...savedSync };
		}
		if (savedTheme) {
			theme = { ...DEFAULT_THEME_CONFIG, ...savedTheme };
		}
		loaded = true;
	}

	/** 切换工作区后重读工作区级设置（档案与开发者开关）。 */
	async function reloadWorkspaceScoped(): Promise<void> {
		const [savedProfile, savedDeveloper] = await Promise.all([
			scopedKv.get<AppProfile>(PROFILE_KEY),
			scopedKv.get<boolean>(DEVELOPER_KEY)
		]);
		profile = savedProfile ? normalizeProfile(savedProfile) : { ...DEFAULT_PROFILE };
		developerMode = savedDeveloper === true;
		emit();
	}

	/** 保存 LLM 配置并立即生效。 */
	async function saveConfig(next: LlmConfig): Promise<void> {
		const normalized = normalizeLlmConfig(next);
		config = normalized;
		await kv.set(LLM_KEY, normalized);
		emit();
	}

	/** 保存角色档案（当前工作区）。 */
	async function saveProfile(next: AppProfile): Promise<void> {
		const normalized = normalizeProfile(next);
		profile = normalized;
		await scopedKv.set(PROFILE_KEY, normalized);
		emit();
	}

	/** 角色档案恢复默认（仅影响角色档案，不动 LLM 配置）。 */
	async function resetProfile(): Promise<void> {
		profile = { ...DEFAULT_PROFILE };
		await scopedKv.set(PROFILE_KEY, profile);
		emit();
	}

	/** 切换开发者功能开关（当前工作区）。 */
	async function saveDeveloperMode(enabled: boolean): Promise<void> {
		developerMode = enabled;
		await scopedKv.set(DEVELOPER_KEY, enabled);
		emit();
	}

	/** 保存远程同步设置（服务器地址 + 密钥，密钥不随工作区同步）。 */
	async function saveSync(next: SyncSettings): Promise<void> {
		const plain = { ...DEFAULT_SYNC_SETTINGS, ...next };
		sync = plain;
		await kv.set(SYNC_KEY, plain);
		emit();
	}

	/** 保存主题（颜色/背景图/透明度），修改即时生效。 */
	async function saveTheme(next: ThemeConfig): Promise<void> {
		const plain: ThemeConfig = {
			presetId: next.presetId,
			colors: { ...next.colors },
			backgroundImage: next.backgroundImage,
			officialBackgroundId: next.officialBackgroundId,
			backgroundOpacity: next.backgroundOpacity,
			backgroundBlur: next.backgroundBlur
		};
		theme = plain;
		await kv.set(THEME_KEY, plain);
		emit();
	}

	/** 订阅设置变化（同步推送用）。 */
	function subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	return {
		get config() {
			return config;
		},
		get profile() {
			return profile;
		},
		get developerMode() {
			return developerMode;
		},
		get sync() {
			return sync;
		},
		get theme() {
			return theme;
		},
		get loaded() {
			return loaded;
		},
		load,
		reloadWorkspaceScoped,
		saveConfig,
		saveProfile,
		resetProfile,
		saveDeveloperMode,
		saveSync,
		saveTheme,
		subscribe
	};
}
