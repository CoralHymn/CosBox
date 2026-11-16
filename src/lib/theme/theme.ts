/**
 * 主题系统：可高度自定义的颜色变量 + 背景图。
 * 颜色通过 CSS 变量（--bg、--panel、--accent 等）覆盖 :root；
 * 背景图以 data URL 存储（纯客户端，随设置持久化到 IndexedDB），
 * 透明度由 body::before 图层控制。
 */

/** 可自定义的主题颜色变量（键为 CSS 变量名去掉 `--` 前缀）。 */
export type ThemeColorKey =
	| 'bg'
	| 'bg-elevated'
	| 'panel'
	| 'panel-2'
	| 'border'
	| 'border-strong'
	| 'text'
	| 'text-dim'
	| 'text-faint'
	| 'accent'
	| 'accent-dim'
	| 'accent-2'
	| 'ok'
	| 'warn'
	| 'err';

/** 主题配置：预设 id + 颜色覆盖 + 背景图。 */
export interface ThemeConfig {
	/** 当前预设 id：'default' | 'claude' | 'discord' | 'verge' | 'custom'。 */
	presetId: string;
	/** 已应用的颜色值（键与 ThemeColorKey 一致，值为 CSS 颜色）。 */
	colors: Partial<Record<ThemeColorKey, string>>;
	/** 自定义背景图 data URL（base64）；空串表示未上传自定义背景图。 */
	backgroundImage: string;
	/** 官方背景图 id（OFFICIAL_BACKGROUNDS 中的一项）；空串表示未选择官方背景。 */
	officialBackgroundId: string;
	/** 背景图透明度，0-1（0 = 完全透明不显示，1 = 不透明）。 */
	backgroundOpacity: number;
	/** 背景图磨砂（模糊）程度，0-50 px；0 = 清晰。 */
	backgroundBlur: number;
}

/** 主题预设：一组完整颜色 + 展示名。 */
export interface ThemePreset {
	id: string;
	label: string;
	description: string;
	colors: Record<ThemeColorKey, string>;
}

/** 官方背景图：静态文件位于 static/backgrounds/（用户自创图片，无版权问题）。 */
export interface OfficialBackground {
	id: string;
	label: string;
	description: string;
	/** 小图预览路径（thumbs 下的压缩缩略图）。 */
	thumbnailPath: string;
	/** 全屏背景图 URL（构建后为 /backgrounds/xxx.webp）。 */
	fullPath: string;
}

/** 内置官方背景列表：官方背景与自定义上传互斥（官方 id 与 data URL 同时只保留一个）。 */
export const OFFICIAL_BACKGROUNDS: readonly OfficialBackground[] = [
	{
		id: 'lowpoly-planet',
		label: '低多边形星球',
		description: '深空悬浮的低多边形微缩世界：蓝海绿洲、小屋与飞行的飞机。',
		thumbnailPath: '/backgrounds/thumbs/lowpoly-planet.webp',
		fullPath: '/backgrounds/lowpoly-planet.webp'
	},
	{
		id: 'hourglass',
		label: '琥珀沙漏',
		description: '极简沙漏置于纯黑背景，琥珀色流沙与圆形光晕，静谧的时间意象。',
		thumbnailPath: '/backgrounds/thumbs/hourglass.webp',
		fullPath: '/backgrounds/hourglass.webp'
	},
	{
		id: 'dark-grid',
		label: '暗色网格',
		description: '深色细线方格铺满全屏，低调科技感，最不影响文字可读性。',
		thumbnailPath: '/backgrounds/thumbs/dark-grid.webp',
		fullPath: '/backgrounds/dark-grid.webp'
	},
	{
		id: 'red-spiral',
		label: '赤红螺旋',
		description: '纯黑底色上的鲜红几何螺旋，极简高饱和，冷静而富有张力。',
		thumbnailPath: '/backgrounds/thumbs/red-spiral.webp',
		fullPath: '/backgrounds/red-spiral.webp'
	},
	{
		id: 'dino-skeleton',
		label: '恐龙骨架',
		description: '深色底上的银灰几何恐龙骨架剪影，极简趣味图标风。',
		thumbnailPath: '/backgrounds/thumbs/dino-skeleton.webp',
		fullPath: '/backgrounds/dino-skeleton.webp'
	}
];

/** 按 id 查找官方背景；不存在返回 undefined。 */
export function findOfficialBackground(id: string): OfficialBackground | undefined {
	return OFFICIAL_BACKGROUNDS.find((bg) => bg.id === id);
}

/** 获取当前生效的背景图 URL（自定义 data URL 优先于官方背景）。 */
export function getEffectiveBackgroundUrl(theme: ThemeConfig): string {
	if (theme.backgroundImage.trim() !== '') {
		return theme.backgroundImage;
	}
	const official = findOfficialBackground(theme.officialBackgroundId);
	return official ? official.fullPath : '';
}

/**
 * CosBox 内置默认主题（The Verge 酸薄荷：近黑画布 + 酸薄荷 + 紫外紫，
 * 与 app.css :root 保持一致）。
 */
export const DEFAULT_THEME_COLORS: Record<ThemeColorKey, string> = {
	bg: '#131313',
	'bg-elevated': '#1a1a1a',
	panel: '#2d2d2d',
	'panel-2': '#232323',
	border: '#313131',
	'border-strong': '#4a4a4a',
	text: '#ffffff',
	'text-dim': '#949494',
	'text-faint': '#6b6b6b',
	accent: '#3cffd0',
	'accent-dim': 'rgba(60, 255, 208, 0.12)',
	'accent-2': '#5200ff',
	ok: '#3cffd0',
	warn: '#f5c542',
	err: '#ff5d5d'
};

/**
 * 内置预设（灵感来自 tmp 下的设计分析）：
 * - Claude：暖奶油画布 + 珊瑚橙 CTA + 深海军蓝表面；
 * - Discord：深靛蓝画布 + Blurple 主色 + 电光绿/品红点缀；
 * - The Verge：近黑画布 + 酸薄荷 + 紫外紫。
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
	{
		id: 'default',
		label: 'CosBox 深色（旧默认）',
		description: '旧版内置深色主题，蓝紫主色。',
		colors: {
			bg: '#0e1016',
			'bg-elevated': '#141821',
			panel: '#171b26',
			'panel-2': '#1d2230',
			border: '#2a3040',
			'border-strong': '#374055',
			text: '#e8eaf1',
			'text-dim': '#9aa3b8',
			'text-faint': '#6b7387',
			accent: '#7c9cff',
			'accent-dim': 'rgba(124, 156, 255, 0.14)',
			'accent-2': '#b18cff',
			ok: '#4ade80',
			warn: '#fbbf24',
			err: '#f87171'
		}
	},
	{
		id: 'claude',
		label: 'Claude 暖奶油',
		description: '暖奶油画布 + 珊瑚橙主色，明亮人文风。',
		colors: {
			bg: '#faf9f5',
			'bg-elevated': '#f5f0e8',
			panel: '#efe9de',
			'panel-2': '#e8e0d2',
			border: '#e6dfd8',
			'border-strong': '#d6cdc0',
			text: '#141413',
			'text-dim': '#3d3d3a',
			'text-faint': '#6c6a64',
			accent: '#cc785c',
			'accent-dim': 'rgba(204, 120, 92, 0.14)',
			'accent-2': '#5db8a6',
			ok: '#5db872',
			warn: '#d4a017',
			err: '#c64545'
		}
	},
	{
		id: 'discord',
		label: 'Discord 深靛蓝',
		description: '深靛蓝画布 + Blurple 主色，游戏感高饱和。',
		colors: {
			bg: '#0a0d3a',
			'bg-elevated': '#141852',
			panel: '#1e2353',
			'panel-2': '#23272a',
			border: '#2c3160',
			'border-strong': '#3a4077',
			text: '#ffffff',
			'text-dim': '#aeb3d8',
			'text-faint': '#7c82ad',
			accent: '#5865f2',
			'accent-dim': 'rgba(88, 101, 242, 0.16)',
			'accent-2': '#35ed7e',
			ok: '#35ed7e',
			warn: '#fbbf24',
			err: '#f87171'
		}
	},
	{
		id: 'verge',
		label: 'The Verge 酸薄荷',
		description: '近黑画布 + 酸薄荷与紫外紫，编辑部霓虹感。',
		colors: {
			bg: '#131313',
			'bg-elevated': '#1a1a1a',
			panel: '#2d2d2d',
			'panel-2': '#232323',
			border: '#313131',
			'border-strong': '#4a4a4a',
			text: '#ffffff',
			'text-dim': '#949494',
			'text-faint': '#6b6b6b',
			accent: '#3cffd0',
			'accent-dim': 'rgba(60, 255, 208, 0.12)',
			'accent-2': '#5200ff',
			ok: '#3cffd0',
			warn: '#f5c542',
			err: '#ff5d5d'
		}
	}
];

/** 默认主题配置：The Verge 酸薄荷 + 低多边形星球背景（首次使用即启用）。 */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
	presetId: 'verge',
	colors: {},
	backgroundImage: '',
	officialBackgroundId: 'lowpoly-planet',
	backgroundOpacity: 1,
	backgroundBlur: 0
};

/** 按预设 id 查找预设；不存在返回 undefined。 */
export function findThemePreset(id: string): ThemePreset | undefined {
	return THEME_PRESETS.find((preset) => preset.id === id);
}

/** 用预设完整颜色构造主题配置（保留背景图设置）。 */
export function themeFromPreset(
	presetId: string,
	base: ThemeConfig = DEFAULT_THEME_CONFIG
): ThemeConfig {
	const preset = findThemePreset(presetId);
	return {
		presetId,
		colors: preset ? { ...preset.colors } : {},
		backgroundImage: base.backgroundImage,
		officialBackgroundId: base.officialBackgroundId,
		backgroundOpacity: base.backgroundOpacity,
		backgroundBlur: base.backgroundBlur
	};
}

/** 计算主题对应的 CSS 变量映射（`--key` -> value，含背景图层变量）。 */
export function resolveThemeCss(theme: ThemeConfig): Record<string, string> {
	const merged: Record<string, string> = { ...DEFAULT_THEME_COLORS, ...theme.colors };
	const vars: Record<string, string> = {};
	for (const [key, value] of Object.entries(merged)) {
		vars[`--${key}`] = value;
	}
	if (getEffectiveBackgroundUrl(theme) !== '') {
		// 有背景图时让顶栏/导航/输入条/侧栏等结构面透明，背景图铺满全屏。
		vars['--bg-app-header'] = 'transparent';
		vars['--bg-app-panel'] = 'transparent';
		// 内容面（卡片/气泡/按钮/输入框等）改为半透明，让背景图大面积透出，
		// 同时保留底色可读性；颜色从当前主题色动态换算，适配深浅预设。
		vars['--bg-app-surface'] = hexToRgba(merged.panel ?? '', CONTENT_SURFACE_ALPHA);
		vars['--bg-app-surface-2'] = hexToRgba(merged['panel-2'] ?? '', CONTENT_SURFACE_ALPHA);
		vars['--bg-app-surface-3'] = hexToRgba(merged.bg ?? '', CONTENT_SURFACE_ALPHA);
	}
	return vars;
}

/** 把主题配置应用到文档（覆盖 :root CSS 变量 + 背景图层变量）。 */
export function applyThemeToDocument(theme: ThemeConfig): void {
	if (typeof document === 'undefined') {
		return;
	}
	const root = document.documentElement;
	for (const [key, value] of Object.entries(resolveThemeCss(theme))) {
		root.style.setProperty(key, value);
	}
	// 背景图与透明度直接写到专用图层元素的内联样式：
	// 超长 data URL 存 CSS 变量在部分浏览器会解析失败（表现为背景变黑）。
	const backdrop = document.querySelector<HTMLElement>('.theme-backdrop');
	const bgUrl = getEffectiveBackgroundUrl(theme);
	if (bgUrl !== '') {
		backdrop?.style.setProperty('background-image', `url("${bgUrl}")`);
		backdrop?.style.setProperty('opacity', String(clampOpacity(theme.backgroundOpacity)));
		const blur = clampBlur(theme.backgroundBlur);
		// 模糊时轻微放大，避免磨砂边缘出现透明留白。
		backdrop?.style.setProperty('filter', blur > 0 ? `blur(${blur}px)` : '');
		backdrop?.style.setProperty('transform', blur > 0 ? 'scale(1.04)' : '');
	} else {
		backdrop?.style.removeProperty('background-image');
		backdrop?.style.removeProperty('opacity');
		backdrop?.style.removeProperty('filter');
		backdrop?.style.removeProperty('transform');
		root.style.removeProperty('--bg-app-header');
		root.style.removeProperty('--bg-app-panel');
		root.style.removeProperty('--bg-app-surface');
		root.style.removeProperty('--bg-app-surface-2');
		root.style.removeProperty('--bg-app-surface-3');
	}
}

/** 规范化背景图透明度（0-1，非法值回退 1）。 */
export function clampOpacity(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}
	return Math.min(1, Math.max(0, value));
}

/** 规范化背景图磨砂程度（0-50 px，非法值回退 0）。 */
export function clampBlur(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(50, Math.max(0, Math.round(value)));
}

/** 有背景图时内容面（卡片/气泡/输入框等）的底色不透明度：0.25 让图片透出 75%。 */
const CONTENT_SURFACE_ALPHA = 0.25;

/** 把 #rrggbb / #rgb 转为半透明 rgba；非 hex（如自定义 rgba）退化为 transparent。 */
function hexToRgba(color: string, alpha: number): string {
	const trimmed = color.trim();
	const full = trimmed.match(/^#([0-9a-f]{6})$/i);
	if (full !== null) {
		const value = parseInt(full[1]!, 16);
		return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
	}
	const short = trimmed.match(/^#([0-9a-f]{3})$/i);
	if (short !== null) {
		const value = parseInt(short[1]!, 16);
		return `rgba(${((value >> 8) & 15) * 17}, ${((value >> 4) & 15) * 17}, ${(value & 15) * 17}, ${alpha})`;
	}
	return 'transparent';
}
