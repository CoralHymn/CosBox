import { normalizeLlmConfig } from '../llm/providers';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
import type { KvRepository } from '../db/kv-repo';

/** 应用级角色档案：名字 + 自定义系统提示。 */
export interface AppProfile {
	name: string;
	systemPrompt: string | null;
}

const LLM_KEY = 'settings.llm';
const PROFILE_KEY = 'settings.profile';

/** 设置 store：LLM 配置与角色档案的持久化封装。 */
export function createSettingsStore(kv: KvRepository) {
	let config = $state<LlmConfig>({ ...DEFAULT_LLM_CONFIG });
	let profile = $state<AppProfile>({ name: '', systemPrompt: null });
	let loaded = $state(false);

	/** 从 kv 加载设置；首次使用默认值。 */
	async function load(): Promise<void> {
		const [savedConfig, savedProfile] = await Promise.all([
			kv.get<LlmConfig>(LLM_KEY),
			kv.get<AppProfile>(PROFILE_KEY)
		]);
		if (savedConfig) {
			config = normalizeLlmConfig(savedConfig);
		}
		if (savedProfile) {
			profile = savedProfile;
		}
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

	return {
		get config() {
			return config;
		},
		get profile() {
			return profile;
		},
		get loaded() {
			return loaded;
		},
		load,
		saveConfig,
		saveProfile
	};
}
