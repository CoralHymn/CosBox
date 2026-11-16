import {
	Activity,
	BookOpen,
	Brain,
	CalendarDays,
	ChevronDown,
	Copy,
	Download,
	FileText,
	GitBranch,
	Layers,
	LogOut,
	MapPin,
	MessageCircle,
	Minus,
	Package,
	Pencil,
	Settings,
	Shirt,
	Square,
	Trash2,
	User,
	X
} from '@lucide/svelte';

/** 工作区相关控件使用的图标（@lucide/svelte，24x24 描边，颜色随文字色）。 */
export const ICONS = {
	/** 多工作区（图层堆叠）。 */
	layers: Layers,
	/** 退出到工作区选择。 */
	'log-out': LogOut,
	/** 重命名。 */
	pencil: Pencil,
	/** 复制工作区。 */
	copy: Copy,
	/** 导出 .cbox。 */
	download: Download,
	/** 删除工作区。 */
	'trash-2': Trash2,
	/** 窗口最小化。 */
	minus: Minus,
	/** 窗口最大化。 */
	square: Square,
	/** 窗口关闭。 */
	x: X,
	/** 对话。 */
	'message-circle': MessageCircle,
	/** 角色状态。 */
	user: User,
	/** 地点。 */
	'map-pin': MapPin,
	/** 衣柜。 */
	shirt: Shirt,
	/** 日程。 */
	'calendar-days': CalendarDays,
	/** 版本。 */
	'git-branch': GitBranch,
	/** 世界书。 */
	'book-open': BookOpen,
	/** 记忆。 */
	brain: Brain,
	/** 监控。 */
	activity: Activity,
	/** 导入导出。 */
	package: Package,
	/** 提示词。 */
	'file-text': FileText,
	/** 设置。 */
	settings: Settings,
	/** 下拉箭头。 */
	'chevron-down': ChevronDown
} as const;

/** 图标名称。 */
export type IconName = keyof typeof ICONS;