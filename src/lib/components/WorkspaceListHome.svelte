<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import WorkspaceAvatar from './WorkspaceAvatar.svelte';

	interface Props {
		workspaces: WorkspaceMeta[];
		/** 正在进入/切换中：禁用列表项。 */
		busy?: boolean;
		onEnter: (id: string) => void;
		/** 打开工作区管理弹层（新建/导入/重命名等全量管理）。 */
		onOpenManager: () => void;
		/** 点击列表项头像：打开头像编辑器。 */
		onEditAvatar: (meta: WorkspaceMeta) => void;
	}

	let { workspaces, busy = false, onEnter, onOpenManager, onEditAvatar }: Props = $props();

	let keyword = $state('');

	const filtered = $derived(
		keyword.trim() === ''
			? workspaces
			: workspaces.filter((meta) => meta.name.includes(keyword.trim()))
	);

	/** 列表项时间：今天显示 HH:mm，昨天显示「昨天」，更早显示 MM/DD。 */
	function formatWhen(t: number | undefined): string {
		if (t === undefined) {
			return '';
		}
		const date = new Date(t);
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		if (t >= startOfToday) {
			const pad = (value: number): string => `${value}`.padStart(2, '0');
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		if (t >= startOfToday - 86400000) {
			return '昨天';
		}
		const pad = (value: number): string => `${value}`.padStart(2, '0');
		return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
	}
</script>

<div class="ws-home">
	<div class="ws-home-head">
		<div class="ws-home-title">
			<span class="brand-mark" aria-hidden="true"></span>
			<span>CosBox</span>
		</div>
		<button
			class="ws-home-add"
			title="新建/导入工作区"
			aria-label="管理工作区"
			onclick={onOpenManager}>＋</button
		>
	</div>
	<div class="ws-home-search">
		<input class="input" placeholder="搜索工作区…" bind:value={keyword} aria-label="搜索工作区" />
	</div>
	<div class="ws-home-list">
		{#each filtered as meta (meta.id)}
			<div class="ws-home-item" class:busy>
				<button
					class="ws-home-avatar"
					aria-label={`编辑「${meta.name}」的头像`}
					onclick={() => onEditAvatar(meta)}
				>
					<WorkspaceAvatar {meta} size={48} />
				</button>
				<button class="ws-home-main" disabled={busy} onclick={() => onEnter(meta.id)}>
					<span class="ws-home-row1">
						<span class="ws-home-name">{meta.name}</span>
						<span class="ws-home-time">{formatWhen(meta.lastMessageAt)}</span>
					</span>
					<span class="ws-home-preview">
						{meta.lastMessagePreview ?? '开始一段新的故事吧'}
					</span>
				</button>
			</div>
		{:else}
			<p class="empty-hint">没有匹配的工作区，点右上角「＋」新建或导入。</p>
		{/each}
	</div>
</div>

<style>
	.ws-home {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.ws-home-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 16px 10px;
		padding-top: calc(16px + env(safe-area-inset-top, 0px));
	}
	.ws-home-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 19px;
		font-weight: 700;
		color: var(--text);
	}
	.ws-home-add {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text);
		font-size: 18px;
		cursor: pointer;
	}
	.ws-home-search {
		padding: 0 16px 10px;
	}
	.ws-home-search .input {
		width: 100%;
	}
	.ws-home-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 8px;
		-webkit-overflow-scrolling: touch;
	}
	.ws-home-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 10px;
		border-radius: 12px;
	}
	.ws-home-item:active {
		background: var(--accent-dim);
	}
	.ws-home-avatar {
		flex: none;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	.ws-home-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.ws-home-main:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.ws-home-row1 {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: baseline;
	}
	.ws-home-name {
		font-size: 15.5px;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ws-home-time {
		font-size: 11px;
		color: var(--text-faint);
		flex: none;
	}
	.ws-home-preview {
		font-size: 13px;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
