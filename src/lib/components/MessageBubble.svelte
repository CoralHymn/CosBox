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
	/** 消息重试挂在用户气泡：回溯到该条用户消息并重新生成其回复。 */
	const canRetry = $derived(
		!disabled && message.id !== 'stream-draft' && message.role === 'user' && onRetry !== undefined
	);
	/** 手动状态确认挂在 AI 气泡。 */
	const canConfirm = $derived(
		!disabled &&
			message.id !== 'stream-draft' &&
			message.role === 'assistant' &&
			onConfirmState !== undefined
	);
	const showControls = $derived(
		!disabled &&
			message.id !== 'stream-draft' &&
			(editable || branchNav !== null || canRetry || canConfirm)
	);
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let editEl = $state<HTMLTextAreaElement | null>(null);

	/** 进入编辑态，草稿预填当前正文。 */
	function startEdit(): void {
		draft = message.content;
		editing = true;
	}

	/** 编辑态聚焦并让 textarea 高度跟随内容（draft 由 bind:value 双向绑定维护）。 */
	$effect(() => {
		if (editing && editEl !== null) {
			editEl.focus();
			autoResize();
		}
	});

	/** 输入时自动撑高编辑区，让多行正文可见。 */
	function onEditInput(): void {
		autoResize();
	}

	/** 高度跟随内容：先复位再取 scrollHeight。 */
	function autoResize(): void {
		if (editEl === null) {
			return;
		}
		editEl.style.height = 'auto';
		editEl.style.height = `${editEl.scrollHeight}px`;
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
			// draft 由 bind:value 维护，读 JS 变量即可，无 DOM 时序问题。
			const next = draft.trim();
			if (next === '') {
				return;
			}
			await onEdit(message.id, next);
			editing = false;
		} catch {
			// 父级已弹出错误提示，这里保持编辑态。
		} finally {
			saving = false;
		}
	}
</script>

<div class="message-row {message.role}">
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
			<details class="thinking" open={message.id === 'stream-draft'}>
				<summary>思考过程</summary>
				<pre>{message.thinking}</pre>
			</details>
		{/if}
		{#if editing}
			<!-- 用 textarea + bind:value 双向绑定，draft 始终与输入同步，
			     保存直接读 JS 变量，不受 DOM/输入事件时序影响。 -->
			<textarea
				class="inline-edit"
				bind:value={draft}
				bind:this={editEl}
				aria-label="编辑消息正文"
				oninput={onEditInput}
				onkeydown={onEditKeydown}
			></textarea>
		{:else}
			{#if message.content !== ''}
				{message.content}
			{:else if message.id === 'stream-draft'}
				<span class="stream-wait" aria-label="AI 正在思考">
					<span class="dot"></span>思考中…
				</span>
			{:else if message.role === 'assistant'}
				<span class="muted">（无正文，仅思考过程）</span>
			{/if}
		{/if}
	</div>
	{#if showControls}
		<!-- 操作条位于气泡下方：编辑/重试（用户）/状态确认（AI）/分支切换（用户）悬浮显示。 -->
		<div class="message-controls" class:show={editing}>
			{#if branchNav !== null && !editing}
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
			<span class="controls-spacer"></span>
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
				{#if canRetry && onRetry !== undefined}
					<button
						class="icon-btn"
						title="重新生成：回溯到本条消息并重新生成回复"
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
				{#if canConfirm && onConfirmState !== undefined}
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
	{/if}
</div>

<style>
	.message-row {
		position: relative;
		display: flex;
		flex-direction: column;
		max-width: min(640px, 78%);
	}
	.message-row.user {
		align-self: flex-end;
		align-items: flex-end;
	}
	.message-row.assistant {
		align-self: flex-start;
		align-items: flex-start;
	}
	.message-row.system {
		align-self: center;
		align-items: center;
		max-width: 90%;
	}
	.message-row .message {
		max-width: 100%;
	}
	.message-controls {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-top: 4px;
		min-height: 24px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}
	.message-row:hover .message-controls,
	.message-row:focus-within .message-controls,
	.message-controls.show {
		opacity: 1;
		pointer-events: auto;
	}
	.controls-spacer {
		flex: 1;
	}
	.branch-nav {
		display: flex;
		gap: 2px;
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
	.inline-edit {
		width: 100%;
		font: inherit;
		line-height: 1.55;
		color: inherit;
		white-space: pre-wrap;
		word-break: break-word;
		min-height: 1.55em;
		outline: none;
		caret-color: var(--accent);
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		resize: none;
		overflow: hidden;
	}
	.inline-edit:focus {
		outline: 1px solid var(--accent);
		outline-offset: 3px;
		border-radius: 6px;
	}
	.stream-wait {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--text-faint);
		font-size: 13px;
	}
	.stream-wait .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: stream-pulse 1.1s ease-in-out infinite;
	}
	@keyframes stream-pulse {
		0%,
		100% {
			opacity: 0.25;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
