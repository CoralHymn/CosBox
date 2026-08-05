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
	}

	let { message, onEdit, disabled = false }: Props = $props();

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
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);

	/** 进入编辑态，草稿预填当前正文。 */
	function startEdit(): void {
		draft = message.content;
		editing = true;
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
		<textarea
			class="inline-edit"
			bind:value={draft}
			rows={Math.max(3, Math.min(10, draft.split('\n').length + 1))}></textarea>
		<div class="edit-actions">
			<button class="btn btn-small" onclick={saveEdit} disabled={saving || draft.trim() === ''}>
				保存
			</button>
			<button class="btn btn-small" onclick={() => (editing = false)}>取消</button>
		</div>
	{:else}
		{message.content}
		{#if editable}
			<!-- 悬浮消息时在底部显示操作图标（对齐主流聊天客户端）。 -->
			<div class="message-actions">
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
	.message:focus-within .message-actions {
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
		background: transparent;
		border: none;
		padding: 0;
		resize: vertical;
		white-space: pre-wrap;
	}
	.inline-edit:focus {
		outline: 1px solid var(--accent);
		outline-offset: 3px;
		border-radius: 6px;
	}
	.edit-actions {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
</style>
