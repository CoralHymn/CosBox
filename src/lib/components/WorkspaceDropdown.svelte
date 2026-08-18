<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import WorkspaceAvatar from './WorkspaceAvatar.svelte';

	interface Props {
		workspaces: WorkspaceMeta[];
		currentId: string | null;
		busy?: boolean;
		/** 切换到指定工作区（面板自动关闭由宿主感知）。 */
		onSwitch: (id: string) => void;
		onCreate: (name: string) => Promise<void>;
		onDuplicate: (id: string) => void;
		onDelete: (id: string) => void;
		onEditAvatar: (meta: WorkspaceMeta) => void;
		/** 打开全量管理弹层（重命名/导出/导入等）。 */
		onOpenManager: () => void;
		onClose: () => void;
	}

	let {
		workspaces,
		currentId,
		busy = false,
		onSwitch,
		onCreate,
		onDuplicate,
		onDelete,
		onEditAvatar,
		onOpenManager,
		onClose
	}: Props = $props();

	let keyword = $state('');
	/** 「新建」内联输入是否展开。 */
	let creating = $state(false);
	let createName = $state('');

	const filtered = $derived(
		keyword.trim() === ''
			? workspaces
			: workspaces.filter((meta) => meta.name.includes(keyword.trim()))
	);

	$effect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	async function submitCreate(): Promise<void> {
		const name = createName.trim();
		if (name === '' || busy) {
			return;
		}
		await onCreate(name);
		createName = '';
		creating = false;
	}
</script>

<!-- 透明遮罩捕获面板外点击（不影响标题栏拖动区之外的交互）。 -->
<div class="wsdd-mask" role="presentation" onclick={onClose}></div>
<div class="wsdd" role="dialog" aria-label="切换工作区">
	<div class="wsdd-head">
		<span class="wsdd-title">工作区</span>
		<input
			class="input wsdd-search"
			placeholder="搜索工作区…"
			bind:value={keyword}
			aria-label="搜索工作区"
		/>
	</div>
	<div class="wsdd-list">
		{#each filtered as meta (meta.id)}
			<div
				class="wsdd-row"
				class:current={meta.id === currentId}
				role="button"
				tabindex="0"
				onclick={() => {
					if (meta.id !== currentId) {
						onSwitch(meta.id);
					}
					onClose();
				}}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						if (meta.id !== currentId) {
							onSwitch(meta.id);
						}
						onClose();
					}
				}}
			>
				<button
					class="wsdd-avatar"
					title="编辑头像"
					aria-label={`编辑「${meta.name}」的头像`}
					onclick={(event) => {
						event.stopPropagation();
						onEditAvatar(meta);
					}}
				>
					<WorkspaceAvatar {meta} size={34} />
					<span class="wsdd-avatar-edit">✎</span>
				</button>
				<div class="wsdd-main">
					<div class="wsdd-name">
						{meta.name}
						{#if meta.id === currentId}
							<span class="wsdd-cur-tag">当前</span>
						{/if}
					</div>
					{#if meta.lastMessagePreview !== undefined}
						<div class="wsdd-preview">{meta.lastMessagePreview}</div>
					{/if}
				</div>
				{#if meta.id !== currentId}
					<div class="wsdd-actions">
						<button
							class="wsdd-mini"
							title="复制工作区"
							aria-label={`复制「${meta.name}」`}
							disabled={busy}
							onclick={(event) => {
								event.stopPropagation();
								onDuplicate(meta.id);
							}}>⧉</button
						>
						<button
							class="wsdd-mini wsdd-mini-danger"
							title="删除工作区"
							aria-label={`删除「${meta.name}」`}
							disabled={busy}
							onclick={(event) => {
								event.stopPropagation();
								onDelete(meta.id);
							}}>✕</button
						>
					</div>
				{/if}
			</div>
		{:else}
			<p class="wsdd-empty">没有匹配的工作区</p>
		{/each}
	</div>
	<div class="wsdd-foot">
		{#if creating}
			<input
				class="input wsdd-create-input"
				placeholder="新工作区名称…"
				bind:value={createName}
				aria-label="新工作区名称"
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						void submitCreate();
					}
				}}
			/>
			<button class="btn btn-small btn-primary" disabled={busy} onclick={() => void submitCreate()}>
				创建
			</button>
		{:else}
			<button class="btn btn-small" onclick={onOpenManager}>管理全部…</button>
			<button class="btn btn-small btn-primary" onclick={() => (creating = true)}>＋ 新建</button>
		{/if}
	</div>
</div>

<style>
	.wsdd-mask {
		position: fixed;
		inset: 0;
		z-index: 95;
	}
	.wsdd {
		position: absolute;
		top: calc(100% + 6px);
		left: 96px;
		width: 380px;
		max-height: 460px;
		background: var(--panel);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		z-index: 96;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.wsdd-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 8px;
	}
	.wsdd-title {
		font-size: 13px;
		font-weight: 700;
		flex: none;
	}
	.wsdd-search {
		flex: 1;
		min-width: 0;
		padding: 6px 10px;
		font-size: 12px;
	}
	.wsdd-list {
		flex: 1;
		overflow-y: auto;
		padding: 2px 8px 8px;
	}
	.wsdd-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px;
		border: 1px solid transparent;
		border-radius: 10px;
		cursor: pointer;
	}
	.wsdd-row:hover {
		background: var(--panel-2);
	}
	.wsdd-row.current {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.wsdd-avatar {
		position: relative;
		flex: none;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	.wsdd-avatar-edit {
		position: absolute;
		inset: 0;
		border-radius: 22%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 12px;
		display: none;
		align-items: center;
		justify-content: center;
	}
	.wsdd-avatar:hover .wsdd-avatar-edit {
		display: flex;
	}
	.wsdd-main {
		flex: 1;
		min-width: 0;
	}
	.wsdd-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.wsdd-cur-tag {
		font-size: 10px;
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: 999px;
		padding: 0 6px;
	}
	.wsdd-preview {
		font-size: 11.5px;
		color: var(--text-dim);
		margin-top: 1px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wsdd-actions {
		display: none;
		gap: 4px;
		flex: none;
	}
	.wsdd-row:hover .wsdd-actions {
		display: flex;
	}
	.wsdd-mini {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--panel);
		color: var(--text-dim);
		font-size: 11px;
		cursor: pointer;
	}
	.wsdd-mini:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.wsdd-mini-danger:hover {
		color: var(--err);
		border-color: var(--err);
	}
	.wsdd-empty {
		padding: 16px;
		text-align: center;
		color: var(--text-faint);
		font-size: 12px;
	}
	.wsdd-foot {
		display: flex;
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid var(--border);
	}
	.wsdd-foot .btn {
		flex: 1;
	}
	.wsdd-create-input {
		flex: 2;
		min-width: 0;
	}
</style>
