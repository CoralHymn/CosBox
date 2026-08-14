/**
 * 工作区相关控件使用的内联 SVG 图标（Lucide 风格 24x24 描边路径，
 * 取自 icon-sets.iconify.design，stroke 使用 currentColor 随文字颜色）。
 */
export const ICON_PATHS = {
	/** 多工作区（图层堆叠）。 */
	layers:
		'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
	/** 退出到工作区选择。 */
	'log-out':
		'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
	/** 重命名。 */
	pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
	/** 复制工作区。 */
	copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	/** 导出 .cbox。 */
	download:
		'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
	/** 删除工作区。 */
	'trash-2':
		'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
	/** 窗口最小化。 */
	minus: '<path d="M5 12h14"/>',
	/** 窗口最大化。 */
	square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
	/** 窗口关闭。 */
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
} as const;

/** 图标名称。 */
export type IconName = keyof typeof ICON_PATHS;
