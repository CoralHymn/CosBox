<script lang="ts">
	import type { ChatMessageView } from '../core/types';
	import { formatWorldTime } from '../core/state';
	import { formatTimestamp } from '../utils/format';

	interface Props {
		message: ChatMessageView;
		/** 提供时该消息可编辑（user/assistant）；保存后由父级落库。 */
		onEdit?: (id: string, content: string) => Promise<void>;
		/** 生成中禁用编辑，避免与流式草稿冲突。 */
		disabled?: boolean;
		/** 提供时显示「重新生成」按钮（assistant 消息）：回溯到该回复之前重新生成。 */
		onRetry?: (id: string) => void;
		/** 提供时显示「LLM 状态确认」按钮（assistant 消息）：手动触发状态判断并补执行工具。 */
		onConfirmState?: (id: string) => void;
		/** 提供时在气泡下方显示分支切换 < >（存在与当前分支在该消息处岔开的备选分支）。 */
		branchNav?: {
			canPrev: boolean;
			canNext: boolean;
			onPrev: () => void;
			onNext: () => void;
		} | null;
	}

	let { message, onEdit, disabled = false, onRetry, onConfirmState, branchNav = null }: Props =
		$props();

	const roleLabel: Record<ChatMessageView['role'], string> = {
		user: '你',
		assistant: '角色',
		system: '系统'
	};

	const editable = $derived(
		onEdit !== undefined &&
			!disabled &&
			message.id !== 'stream-draft' &&
			(message.role === 'user' || message.role === 'assistant')
	);
	const actionable = $derived(
		!disabled && message.id !== 'stream-draft' && message.role === 'assistant'
	);
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let editEl = $state<HTMLDivElement | null>(null);

	/** 进入编辑态，草稿预填当前正文。 */
	function startEdit(): void {
		draft = message.content;
		editing = true;
	}

	/** 编辑态聚焦编辑区，让用户直接开始打字。 */
	$effect(() => {
		if (editing && editEl !== null) {
			// contenteditable 不会自动带入正文，进入编辑态时先把原文写入编辑区。
			// eslint-disable-next-line svelte/no-dom-manipulating -- contenteditable 无 Svelte 原生绑定，必须直接写 textContent
			editEl.textContent = message.content;
			editEl.focus();
		}
	});

	/** 从可编辑区同步草稿（contenteditable 无双向绑定，手动读取 textContent）。 */
	function onEditInput(): void {
		draft = editEl?.textContent ?? '';
	}

	/** Esc 取消；Ctrl/Cmd+Enter 保存。 */
	function onEditKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			editing = false;
		} else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			void saveEdit();
		}
	}

	/** 保存编辑：交给父级落库；失败时保持编辑态供用户修正。 */
	async function saveEdit(): Promise<void> {
		if (onEdit === undefined || saving) {
			return;
		}
		saving = true;
		try {
			await onEdit(message.id, draft);
			editing = false;
		} catch {
			// 父级已弹出错误提示，这里保持编辑态。
		} finally {
			saving = false;
		}
	}
</script>

<div
	class="message {message.role}"
	class:tool-note={message.role === 'system' && message.content.startsWith('【工具调用】')}
>
	<div class="message-meta">
		<span>{roleLabel[message.role]}</span>
		{#if message.worldTime !== undefined}
			<span class="world-time" title="该消息发生时的剧情时间"
				>{formatWorldTime(message.worldTime)}</span
			>
		{/if}
		<span>{formatTimestamp(message.timestamp)}</span>
	</div>
	{#if message.role === 'assistant' && message.thinking !== undefined && message.thinking.trim() !== ''}
		<details class="thinking">
			<summary>思考过程</summary>
			<pre>{message.thinking}</pre>
		</details>
	{/if}
	{#if editing}
		<!-- 直接在原文上编辑：contenteditable 高度与正文一致，切换编辑态零布局变动。 -->
		<div
			class="inline-edit"
			contenteditable="plaintext-only"
			role="textbox"
			tabindex="0"
			aria-label="编辑消息正文"
			bind:this={editEl}
			oninput={onEditInput}
			onkeydown={onEditKeydown}
		></div>
	{:else}
		{message.content}
	{/if}
	{#if editable || branchNav !== null}
		<!-- 悬浮消息时在底部显示操作图标；编辑态常驻显示保存/取消（对齐主流聊天客户端）。 -->
		<div class="message-actions" class:show={editing}>
			{#if editing}
				<button
					class="icon-btn"
					title="保存"
					aria-label="保存"
					onclick={saveEdit}
					disabled={saving || draft.trim() === ''}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				</button>
				<button class="icon-btn" title="取消" aria-label="取消" onclick={() => (editing = false)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			{:else}
				<button class="icon-btn" title="编辑消息" aria-label="编辑消息" onclick={startEdit}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
					</svg>
				</button>
				{#if actionable && onRetry !== undefined}
					<button
						class="icon-btn"
						title="重新生成：回溯到本条消息之前重新发送"
						aria-label="重新生成"
						onclick={() => onRetry(message.id)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M21 12a9 9 0 1 1-2.64-6.36" />
							<path d="M21 3v6h-6" />
						</svg>
					</button>
				{/if}
				{#if actionable && onConfirmState !== undefined}
					<button
						class="icon-btn"
						title="LLM 状态确认：让 AI 判断本轮是否需要更新状态并补执行工具"
						aria-label="LLM 状态确认"
						onclick={() => onConfirmState(message.id)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M9 18h6" />
							<path d="M10 22h4" />
							<path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
						</svg>
					</button>
				{/if}
			{/if}
		</div>
		{#if branchNav !== null}
			<div class="branch-nav" aria-label="切换分支">
				<button
					class="icon-btn"
					title="切换为更早的分支"
					aria-label="切换为更早的分支"
					disabled={!branchNav.canPrev}
					onclick={branchNav.onPrev}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="m15 18-6-6 6-6" />
					</svg>
				</button>
				<button
					class="icon-btn"
					title="切换为更新的分支"
					aria-label="切换为更新的分支"
					disabled={!branchNav.canNext}
					onclick={branchNav.onNext}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="m9 18 6-6-6-6" />
					</svg>
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.message {
		position: relative;
	}
	.message-actions {
		position: absolute;
		right: 8px;
		bottom: 4px;
		display: flex;
		gap: 4px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}
	.message:hover .message-actions,
	.message:focus-within .message-actions,
	.message-actions.show {
		opacity: 1;
		pointer-events: auto;
	}
	.branch-nav {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: 4px;
		display: flex;
		gap: 2px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}
	.message:hover .branch-nav,
	.message:focus-within .branch-nav {
		opacity: 1;
		pointer-events: auto;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 24px;
		width: 24px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-faint);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--bg);
		color: var(--text);
		border-color: var(--border);
	}
	.icon-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.message.user .icon-btn {
		color: rgba(14, 16, 22, 0.55);
	}
	.message.user .icon-btn:hover {
		background: rgba(0, 0, 0, 0.08);
		color: #0e1016;
		border-color: transparent;
	}
	.inline-edit {
		width: 100%;
		font: inherit;
		line-height: inherit;
		color: inherit;
		white-space: pre-wrap;
		word-break: break-word;
		min-height: 1.55em;
		outline: none;
		caret-color: var(--accent);
	}
	.inline-edit:focus {
		outline: 1px solid var(--accent);
		outline-offset: 3px;
		border-radius: 6px;
	}
</style>
