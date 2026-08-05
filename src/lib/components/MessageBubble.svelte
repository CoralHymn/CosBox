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
		{#if editable && !editing}
			<button class="btn btn-small edit-btn" title="编辑消息" onclick={startEdit}>编辑</button>
		{/if}
	</div>
	{#if message.role === 'assistant' && message.thinking !== undefined && message.thinking.trim() !== ''}
		<details class="thinking">
			<summary>思考过程</summary>
			<pre>{message.thinking}</pre>
		</details>
	{/if}
	{#if editing}
		<textarea
			class="input edit-textarea"
			bind:value={draft}
			rows={Math.max(3, Math.min(10, draft.split('\n').length + 1))}></textarea>
		<div class="row-actions edit-actions">
			<button class="btn btn-small" onclick={saveEdit} disabled={saving || draft.trim() === ''}>
				保存
			</button>
			<button class="btn btn-small" onclick={() => (editing = false)}>取消</button>
		</div>
	{:else}
		{message.content}
	{/if}
</div>

<style>
	.edit-textarea {
		width: 100%;
		min-height: 64px;
		resize: vertical;
		font: inherit;
	}
	.edit-actions {
		margin-top: 6px;
		gap: 6px;
	}
</style>
