<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import type { TabId } from '../stores/ui.svelte';
	import Icon from './Icon.svelte';
	import WorkspaceAvatar from './WorkspaceAvatar.svelte';
	import type { IconName } from './icons';

	interface Props {
		/** 当前激活的功能标签（高亮用）。 */
		active: TabId;
		/** 当前工作区（抽屉头部展示）。 */
		workspace: Pick<WorkspaceMeta, 'name' | 'avatar'>;
		onSelect: (tab: TabId) => void;
		onClose: () => void;
	}

	let { active, workspace, onSelect, onClose }: Props = $props();

	/** 除「对话」外的功能标签，按微信「我」页式分组收纳。 */
	const groups: { label: string; items: { id: TabId; label: string; icon: IconName }[] }[] = [
		{
			label: '角色与世界',
			items: [
				{ id: 'state', label: '状态', icon: 'user' },
				{ id: 'locations', label: '地点', icon: 'map-pin' },
				{ id: 'wardrobe', label: '衣柜', icon: 'shirt' },
				{ id: 'schedule', label: '日程', icon: 'calendar-days' },
				{ id: 'world', label: '世界书', icon: 'book-open' }
			]
		},
		{
			label: '内容与记忆',
			items: [
				{ id: 'memory', label: '记忆', icon: 'brain' },
				{ id: 'prompts', label: '提示词', icon: 'file-text' },
				{ id: 'versions', label: '版本', icon: 'git-branch' }
			]
		},
		{
			label: '系统',
			items: [
				{ id: 'monitor', label: '监控', icon: 'activity' },
				{ id: 'transfer', label: '导入导出', icon: 'package' },
				{ id: 'settings', label: '设置', icon: 'settings' }
			]
		}
	];

	$effect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div class="feature-mask" role="presentation" onclick={onClose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<aside class="feature-drawer" role="dialog" aria-label="功能菜单">
	<div class="feature-drawer-head">
		<WorkspaceAvatar meta={workspace} size={30} />
		<span class="feature-drawer-name">{workspace.name}</span>
		<button class="feature-drawer-close" aria-label="关闭功能菜单" onclick={onClose}>✕</button>
	</div>
	<div class="feature-drawer-body">
		{#each groups as group (group.label)}
			<div class="feature-group">{group.label}</div>
			{#each group.items as item (item.id)}
				<button
					class="feature-item"
					class:active={item.id === active}
					onclick={() => onSelect(item.id)}
				>
					<span class="feature-item-ico"><Icon name={item.icon} size={14} /></span>
					<span>{item.label}</span>
				</button>
			{/each}
		{/each}
	</div>
</aside>

<style>
	.feature-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 75;
	}
	.feature-drawer {
		position: fixed;
		top: 0;
		bottom: 0;
		right: 0;
		width: min(280px, calc(100vw - 48px));
		background: var(--panel);
		border-left: 1px solid var(--border-strong);
		z-index: 80;
		display: flex;
		flex-direction: column;
		padding-top: env(safe-area-inset-top, 0px);
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	.feature-drawer-head {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 13px 12px;
		border-bottom: 1px solid var(--border);
	}
	.feature-drawer-name {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		font-weight: 700;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.feature-drawer-close {
		border: none;
		background: none;
		color: var(--text-dim);
		font-size: 15px;
		cursor: pointer;
		padding: 4px;
	}
	.feature-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 10px;
		-webkit-overflow-scrolling: touch;
	}
	.feature-group {
		font-size: 11px;
		color: var(--text-faint);
		padding: 10px 8px 4px;
	}
	.feature-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px;
		border-radius: 10px;
		border: none;
		background: none;
		color: var(--text);
		font-size: 13.5px;
		cursor: pointer;
		text-align: left;
	}
	.feature-item.active {
		background: var(--accent-dim);
		color: var(--accent);
	}
	.feature-item-ico {
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: 8px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
