/** 头像预设图标名。 */
export const AVATAR_ICON_NAMES = [
	'cat',
	'drama',
	'moon',
	'flame',
	'swords',
	'flower',
	'shield',
	'bot'
] as const;
export type AvatarIconName = (typeof AVATAR_ICON_NAMES)[number];

/** 工作区头像：色板 + 首字/图标，或上传的自定义图片（data URL）。 */
export type WorkspaceAvatar =
	| { kind: 'glyph'; color: string; glyph: string }
	| { kind: 'icon'; color: string; icon: AvatarIconName }
	| { kind: 'image'; image: string };

/** 工作区元信息：注册表中的轻量条目（完整数据分散在各业务表与作用域 kv 中）。 */
export interface WorkspaceMeta {
	id: string;
	name: string;
	createdAt: number;
	/** 最近一次进入/切换时间（列表排序用）。 */
	updatedAt: number;
	/** 自定义头像；缺省时 UI 用名称首字 + 派生色兜底。 */
	avatar?: WorkspaceAvatar;
	/** 最近一条非系统消息预览（移动端会话列表/桌面端切换器下拉展示）。 */
	lastMessagePreview?: string;
	/** 最近一条非系统消息的时间戳。 */
	lastMessageAt?: number;
}
