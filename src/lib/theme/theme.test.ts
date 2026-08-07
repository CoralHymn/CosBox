import { describe, expect, it } from 'vitest';
import {
	applyThemeToDocument,
	clampOpacity,
	DEFAULT_THEME_COLORS,
	DEFAULT_THEME_CONFIG,
	findThemePreset,
	resolveThemeCss,
	THEME_PRESETS,
	themeFromPreset,
	type ThemeColorKey,
	type ThemeConfig
} from './theme';

const COLOR_KEYS: readonly ThemeColorKey[] = [
	'bg',
	'bg-elevated',
	'panel',
	'panel-2',
	'border',
	'border-strong',
	'text',
	'text-dim',
	'text-faint',
	'accent',
	'accent-dim',
	'accent-2',
	'ok',
	'warn',
	'err'
];

describe('THEME_PRESETS', () => {
	it('每个预设字段完整、id 唯一且颜色键齐全', () => {
		const ids = new Set<string>();
		for (const preset of THEME_PRESETS) {
			expect(preset.id.trim()).not.toBe('');
			expect(preset.label.trim()).not.toBe('');
			expect(ids.has(preset.id)).toBe(false);
			ids.add(preset.id);
			for (const key of COLOR_KEYS) {
				expect(preset.colors[key]).toBeTruthy();
			}
		}
	});

	it('默认预设与 DEFAULT_THEME_COLORS 一致', () => {
		expect(findThemePreset('default')?.colors).toEqual(DEFAULT_THEME_COLORS);
	});
});

describe('findThemePreset', () => {
	it('按 id 命中预设', () => {
		expect(findThemePreset('claude')?.label).toContain('Claude');
		expect(findThemePreset('discord')?.label).toContain('Discord');
		expect(findThemePreset('verge')?.label).toContain('Verge');
	});

	it('未知 id（含 custom）返回 undefined', () => {
		expect(findThemePreset('custom')).toBeUndefined();
		expect(findThemePreset('nope')).toBeUndefined();
	});
});

describe('themeFromPreset', () => {
	it('用预设完整颜色构造主题并保留背景图设置', () => {
		const base: ThemeConfig = {
			presetId: 'custom',
			colors: {},
			backgroundImage: 'data:image/png;base64,xxx',
			backgroundOpacity: 0.5
		};
		const result = themeFromPreset('verge', base);
		expect(result.presetId).toBe('verge');
		expect(result.colors.accent).toBe('#3cffd0');
		expect(result.backgroundImage).toBe(base.backgroundImage);
		expect(result.backgroundOpacity).toBe(0.5);
	});

	it('未知预设回退空颜色（不炸）', () => {
		const result = themeFromPreset('ghost');
		expect(result.colors).toEqual({});
	});
});

describe('clampOpacity', () => {
	it('限制在 0-1 并处理非法值', () => {
		expect(clampOpacity(0)).toBe(0);
		expect(clampOpacity(0.37)).toBe(0.37);
		expect(clampOpacity(1.5)).toBe(1);
		expect(clampOpacity(-1)).toBe(0);
		expect(clampOpacity(Number.NaN)).toBe(1);
	});
});

describe('resolveThemeCss / applyThemeToDocument', () => {
	it('解析 CSS 变量：合并默认值 + 覆盖色 + 背景图与透明度', () => {
		const vars = resolveThemeCss({
			presetId: 'custom',
			colors: { bg: '#123456', accent: '#abcdef' },
			backgroundImage: 'data:image/png;base64,abc',
			backgroundOpacity: 0.4
		});
		expect(vars['--bg']).toBe('#123456');
		expect(vars['--accent']).toBe('#abcdef');
		expect(vars['--panel']).toBe(DEFAULT_THEME_COLORS.panel);
		expect(vars['--bg-image']).toBe('url("data:image/png;base64,abc")');
		expect(vars['--bg-image-opacity']).toBe('0.4');
	});

	it('无背景图时不输出背景图变量', () => {
		const vars = resolveThemeCss({ ...DEFAULT_THEME_CONFIG, colors: { bg: '#000000' } });
		expect(vars['--bg-image']).toBeUndefined();
		expect(vars['--bg-image-opacity']).toBeUndefined();
		expect(vars['--bg']).toBe('#000000');
	});

	it('无 document 环境下 applyThemeToDocument 安全跳过（node 测试环境）', () => {
		expect(() =>
			applyThemeToDocument({ ...DEFAULT_THEME_CONFIG, colors: { bg: '#000000' } })
		).not.toThrow();
	});
});
