<script lang="ts">
	import type { TabId } from '../stores/ui.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		active: TabId;
		onSelect: (tab: TabId) => void;
		/** 当前工作区名（底部切换器展示）。 */
		workspaceName: string;
		/** 打开工作区管理弹层。 */
		onOpenWorkspace: () => void;
		/** 退出到工作区选择初始界面。 */
		onExitToLanding: () => void;
		/** Tauri 桌面版：工作区切换在自定义标题栏里，隐藏底部切换区。 */
		hideWorkspace?: boolean;
	}

	let {
		active,
		onSelect,
		workspaceName,
		onOpenWorkspace,
		onExitToLanding,
		hideWorkspace = false
	}: Props = $props();

	const tabs: { id: TabId; label: string; icon: string }[] = [
		{ id: 'chat', label: '对话', icon: '💬' },
		{ id: 'state', label: '状态', icon: '🧍' },
		{ id: 'locations', label: '地点', icon: '📍' },
		{ id: 'wardrobe', label: '衣柜', icon: '👗' },
		{ id: 'schedule', label: '日程', icon: '🗓️' },
		{ id: 'versions', label: '版本', icon: '🌳' },
		{ id: 'world', label: '世界书', icon: '📖' },
		{ id: 'memory', label: '记忆', icon: '🧠' },
		{ id: 'monitor', label: '监控', icon: '📈' },
		{ id: 'transfer', label: '导入导出', icon: '📦' },
		{ id: 'settings', label: '设置', icon: '⚙️' }
	];
</script>

<nav class="nav-rail">
	{#each tabs as tab (tab.id)}
		<button class="nav-item" class:active={tab.id === active} onclick={() => onSelect(tab.id)}>
			<span class="nav-icon">{tab.icon}</span>
			<span>{tab.label}</span>
		</button>
	{/each}
	{#if !hideWorkspace}
		<!-- 工作区切换固定在工具区最下方（Web / 移动端；桌面版在自定义标题栏）。 -->
		<div class="nav-workspace">
			<button class="nav-workspace-switch" title="管理工作区" onclick={onOpenWorkspace}>
				<span class="nav-icon"><Icon name="layers" size={15} /></span>
				<span class="nav-workspace-name">{workspaceName}</span>
				<span class="nav-workspace-caret">▾</span>
			</button>
			<button
				class="nav-workspace-exit"
				title="退出到工作区选择"
				aria-label="退出到工作区选择"
				onclick={onExitToLanding}
			>
				<Icon name="log-out" size={14} />
			</button>
		</div>
	{/if}
</nav>
