import { SvelteSet } from 'svelte/reactivity';
import { ensureModelServiceBindings } from '../llm/model-services';
import { normalizeLlmConfig } from '../llm/providers';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
import { defaultSystemPrompt } from '../context/pipeline';
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from '../sync/types';
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from '../theme/theme';
import type { KvRepository } from '../db/kv-repo';

/** 应用级角色档案：名字 + 自定义系统提示。 */
export interface AppProfile {
	name: string;
	systemPrompt: string | null;
}

const LLM_KEY = 'settings.llm';
const PROFILE_KEY = 'settings.profile';
const DEVELOPER_KEY = 'settings.developer';
const SYNC_KEY = 'settings.sync';
const THEME_KEY = 'settings.theme';

/** 默认角色档案：与内置角色「绫音」及默认系统提示模板一致。 */
const DEFAULT_PROFILE: AppProfile = {
	name: '绫音',
	systemPrompt: defaultSystemPrompt('绫音')
};

/** 设置 store：LLM 配置与角色档案的持久化封装。 */
export function createSettingsStore(kv: KvRepository) {
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
			kv.get<AppProfile>(PROFILE_KEY),
			kv.get<boolean>(DEVELOPER_KEY),
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
			profile = savedProfile;
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

	/** 保存 LLM 配置并立即生效。 */
	async function saveConfig(next: LlmConfig): Promise<void> {
		const normalized = normalizeLlmConfig(next);
		config = normalized;
		await kv.set(LLM_KEY, normalized);
		emit();
	}

	/** 保存角色档案。 */
	async function saveProfile(next: AppProfile): Promise<void> {
		profile = next;
		await kv.set(PROFILE_KEY, next);
		emit();
	}

	/** 角色档案恢复默认（仅影响角色档案，不动 LLM 配置）。 */
	async function resetProfile(): Promise<void> {
		profile = { ...DEFAULT_PROFILE };
		await kv.set(PROFILE_KEY, profile);
		emit();
	}

	/** 切换开发者功能开关。 */
	async function saveDeveloperMode(enabled: boolean): Promise<void> {
		developerMode = enabled;
		await kv.set(DEVELOPER_KEY, enabled);
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
		saveConfig,
		saveProfile,
		resetProfile,
		saveDeveloperMode,
		saveSync,
		saveTheme,
		subscribe
	};
}
