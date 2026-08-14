<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		workspaceName: string;
		/** 顶栏状态信息（时间 / 模型 / 快照 / 思考中）——桌面端合并进标题栏。 */
		timeText: string;
		providerLabel: string;
		snapshotCount: number;
		busy?: boolean;
		onOpenWorkspace: () => void;
		onExitToLanding: () => void;
	}

	let {
		workspaceName,
		timeText,
		providerLabel,
		snapshotCount,
		busy = false,
		onOpenWorkspace,
		onExitToLanding
	}: Props = $props();

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
		<span class="brand-mark">C</span>
		<span>CosBox</span>
	</div>
	<button class="titlebar-ws" title="管理工作区" onclick={onOpenWorkspace}>
		<span class="titlebar-ws-icon"><Icon name="layers" size={15} /></span>
		<span class="titlebar-ws-name">{workspaceName || '未选择工作区'}</span>
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
</div>
