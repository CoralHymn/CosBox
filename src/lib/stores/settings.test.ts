import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, normalizeProfile, type AppProfile } from './settings.svelte';

describe('normalizeProfile', () => {
	it('老存档缺少扩展提示词时补齐为 null', () => {
		const legacy: AppProfile = { name: '绫音', systemPrompt: '你是绫音' };
		expect(normalizeProfile(legacy)).toEqual({
			name: '绫音',
			systemPrompt: '你是绫音',
			characterPrompt: null,
			userPrompt: null,
			worldPrompt: null,
			stylePrompt: null
		});
	});

	it('空名字回退到默认角色名', () => {
		const profile: AppProfile = {
			name: '   ',
			systemPrompt: null,
			characterPrompt: '角色',
			userPrompt: null,
			worldPrompt: null,
			stylePrompt: null
		};
		expect(normalizeProfile(profile).name).toBe(DEFAULT_PROFILE.name);
	});

	it('保留已填写的扩展提示词', () => {
		const profile: AppProfile = {
			name: '小夜',
			systemPrompt: '规则',
			characterPrompt: '你叫小夜',
			userPrompt: '用户是同学',
			worldPrompt: '现代都市',
			stylePrompt: '鲁迅式白描'
		};
		expect(normalizeProfile(profile)).toEqual(profile);
	});
});
