import { normalizeLlmConfig } from '../llm/providers';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
import { defaultSystemPrompt } from '../context/pipeline';
import type { KvRepository } from '../db/kv-repo';

/** 应用级角色档案：名字 + 自定义系统提示。 */
export interface AppProfile {
	name: string;
	systemPrompt: string | null;
}

const LLM_KEY = 'settings.llm';
const PROFILE_KEY = 'settings.profile';
const DEVELOPER_KEY = 'settings.developer';

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
	let loaded = $state(false);

	/** 从 kv 加载设置；首次使用默认值。 */
	async function load(): Promise<void> {
		const [savedConfig, savedProfile, savedDeveloper] = await Promise.all([
			kv.get<LlmConfig>(LLM_KEY),
			kv.get<AppProfile>(PROFILE_KEY),
			kv.get<boolean>(DEVELOPER_KEY)
		]);
		if (savedConfig) {
			config = normalizeLlmConfig(savedConfig);
		}
		if (savedProfile) {
			profile = savedProfile;
		}
		developerMode = savedDeveloper === true;
		loaded = true;
	}

	/** 保存 LLM 配置并立即生效。 */
	async function saveConfig(next: LlmConfig): Promise<void> {
		const normalized = normalizeLlmConfig(next);
		config = normalized;
		await kv.set(LLM_KEY, normalized);
	}

	/** 保存角色档案。 */
	async function saveProfile(next: AppProfile): Promise<void> {
		profile = next;
		await kv.set(PROFILE_KEY, next);
	}

	/** 角色档案恢复默认（仅影响角色档案，不动 LLM 配置）。 */
	async function resetProfile(): Promise<void> {
		profile = { ...DEFAULT_PROFILE };
		await kv.set(PROFILE_KEY, profile);
	}

	/** 切换开发者功能开关。 */
	async function saveDeveloperMode(enabled: boolean): Promise<void> {
		developerMode = enabled;
		await kv.set(DEVELOPER_KEY, enabled);
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
		get loaded() {
			return loaded;
		},
		load,
		saveConfig,
		saveProfile,
		resetProfile,
		saveDeveloperMode
	};
}
