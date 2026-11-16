import { Bot, Cat, Drama, Flame, Flower, Moon, Shield, Swords } from '@lucide/svelte';
import type { AvatarIconName } from '../workspace/types';

/** 头像预设图标（选择后以 SVG 渲染，不再使用 emoji 字形）。 */
export const AVATAR_ICONS = {
	cat: Cat,
	drama: Drama,
	moon: Moon,
	flame: Flame,
	swords: Swords,
	flower: Flower,
	shield: Shield,
	bot: Bot
} satisfies Record<AvatarIconName, typeof Cat>;

/** 旧版 emoji 预设 → 图标名（兼容已持久化的头像）。 */
const LEGACY_GLYPH_ICONS: Record<string, AvatarIconName> = {
	'🐱': 'cat',
	'🦊': 'cat',
	'🌙': 'moon',
	'🔥': 'flame',
	'🎭': 'drama',
	'🌸': 'flower',
	'⚔': 'swords',
	'🤖': 'bot'
};

/** 把旧版 emoji 预设字形解析为图标名；非预设返回 null。 */
export function avatarIconForGlyph(glyph: string): AvatarIconName | null {
	return LEGACY_GLYPH_ICONS[glyph.replace(/\uFE0F/g, '')] ?? null;
}