<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import Icon from './Icon.svelte';
	import WorkspaceAvatar from './WorkspaceAvatar.svelte';
	import WorkspaceDropdown from './WorkspaceDropdown.svelte';

	interface Props {
		/** 全部工作区（下拉面板列表）。 */
		workspaces: WorkspaceMeta[];
		/** 当前工作区 id（下拉面板高亮与头像展示）。 */
		currentWorkspaceId: string | null;
		/** 顶栏状态信息（时间 / 模型 / 快照 / 思考中）——桌面端合并进标题栏。 */
		timeText: string;
		providerLabel: string;
		snapshotCount: number;
		busy?: boolean;
		onSwitchWorkspace: (id: string) => void;
		onCreateWorkspace: (name: string) => Promise<void>;
		onDuplicateWorkspace: (id: string) => void;
		onDeleteWorkspace: (id: string) => void;
		onEditAvatar: (meta: WorkspaceMeta) => void;
		onOpenWorkspace: () => void;
		onExitToLanding: () => void;
	}

	let {
		workspaces,
		currentWorkspaceId,
		timeText,
		providerLabel,
		snapshotCount,
		busy = false,
		onSwitchWorkspace,
		onCreateWorkspace,
		onDuplicateWorkspace,
		onDeleteWorkspace,
		onEditAvatar,
		onOpenWorkspace,
		onExitToLanding
	}: Props = $props();

	/** 工作区切换下拉面板是否展开。 */
	let dropdownOpen = $state(false);

	const currentMeta = $derived(workspaces.find((meta) => meta.id === currentWorkspaceId) ?? null);
	const workspaceName = $derived(currentMeta?.name ?? '未选择工作区');

	/** 窗口控制经 Tauri 动态引入；非 Tauri 环境下本组件不会被渲染，兜底静默失败。 */
	async function withWindow(
		action: (window: import('@tauri-apps/api/window').Window) => Promise<void>
	): Promise<void> {
		try {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			await action(getCurrentWindow());
		} catch {
			// 忽略：仅影响窗口控制，不阻断应用。
		}
	}

	function minimize(): void {
		void withWindow((win) => win.minimize());
	}

	function toggleMaximize(): void {
		void withWindow((win) => win.toggleMaximize());
	}

	function close(): void {
		void withWindow((win) => win.close());
	}
</script>

<!-- 自定义标题栏（仅 Tauri 桌面版渲染）：替换系统标题栏，类似 VSCode。
     data-tauri-drag-region 区域可拖动窗口；按钮不带该属性，点击正常响应。 -->
<div class="titlebar" data-tauri-drag-region>
	<div class="titlebar-brand" data-tauri-drag-region>
		<span class="brand-mark" aria-hidden="true"></span>
		<span>CosBox</span>
	</div>
	<button
		class="titlebar-ws"
		title="切换工作区"
		aria-label="切换工作区"
		onclick={() => (dropdownOpen = !dropdownOpen)}
	>
		{#if currentMeta !== null}
			<WorkspaceAvatar meta={currentMeta} size={16} />
		{:else}
			<span class="titlebar-ws-icon"><Icon name="layers" size={15} /></span>
		{/if}
		<span class="titlebar-ws-name">{workspaceName}</span>
		<span class="titlebar-caret"><Icon name="chevron-down" size={11} /></span>
	</button>
	<button
		class="titlebar-exit"
		title="退出到工作区选择"
		aria-label="退出到工作区选择"
		onclick={onExitToLanding}
	>
		<Icon name="log-out" size={14} />
	</button>
	<div class="titlebar-spacer" data-tauri-drag-region></div>
	<span class="chip titlebar-chip"><span class="dot"></span>{timeText}</span>
	<span class="chip ok titlebar-chip"><span class="dot"></span>{providerLabel}</span>
	<span class="chip titlebar-chip"><span class="dot"></span>{snapshotCount} 快照</span>
	{#if busy}
		<span class="chip busy titlebar-chip"><span class="dot"></span>思考中…</span>
	{/if}
	<div class="titlebar-controls">
		<button class="titlebar-control" aria-label="最小化" title="最小化" onclick={minimize}>
			<Icon name="minus" size={14} />
		</button>
		<button
			class="titlebar-control"
			aria-label="最大化/还原"
			title="最大化/还原"
			onclick={toggleMaximize}
		>
			<Icon name="square" size={13} />
		</button>
		<button class="titlebar-control titlebar-close" aria-label="关闭" title="关闭" onclick={close}>
			<Icon name="x" size={15} />
		</button>
	</div>

	{#if dropdownOpen}
		<WorkspaceDropdown
			{workspaces}
			currentId={currentWorkspaceId}
			{busy}
			onSwitch={(id) => {
				dropdownOpen = false;
				onSwitchWorkspace(id);
			}}
			onCreate={async (name) => {
				await onCreateWorkspace(name);
				dropdownOpen = false;
			}}
			onDuplicate={async (id) => {
				onDuplicateWorkspace(id);
				dropdownOpen = false;
			}}
			onDelete={(id) => {
				dropdownOpen = false;
				onDeleteWorkspace(id);
			}}
			onEditAvatar={(meta) => {
				dropdownOpen = false;
				onEditAvatar(meta);
			}}
			onOpenManager={() => {
				dropdownOpen = false;
				onOpenWorkspace();
			}}
			onClose={() => (dropdownOpen = false)}
		/>
	{/if}
</div>

<style>
	/* 下拉面板以标题栏为定位基准。 */
	.titlebar {
		position: relative;
	}
</style>
