<script lang="ts">
	import type { ChatMessageView } from '../core/types';
	import { formatTimestamp } from '../utils/format';

	interface Props {
		message: ChatMessageView;
	}

	let { message }: Props = $props();

	const roleLabel: Record<ChatMessageView['role'], string> = {
		user: '你',
		assistant: '角色',
		system: '系统'
	};
</script>

<div
	class="message {message.role}"
	class:tool-note={message.role === 'system' && message.content.startsWith('【工具调用】')}
>
	<div class="message-meta">
		<span>{roleLabel[message.role]}</span>
		<span>{formatTimestamp(message.timestamp)}</span>
	</div>
	{#if message.role === 'assistant' && message.thinking !== undefined && message.thinking.trim() !== ''}
		<details class="thinking">
			<summary>思考过程</summary>
			<pre>{message.thinking}</pre>
		</details>
	{/if}
	{message.content}
</div>
