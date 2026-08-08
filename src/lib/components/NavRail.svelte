<script lang="ts">
	import type { TabId } from '../stores/ui.svelte';

	interface Props {
		active: TabId;
		onSelect: (tab: TabId) => void;
	}

	let { active, onSelect }: Props = $props();

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
</nav>
