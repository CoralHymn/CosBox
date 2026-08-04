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

<div class="message {message.role}">
	<div class="message-meta">
		<span>{roleLabel[message.role]}</span>
		<span>{formatTimestamp(message.timestamp)}</span>
	</div>
	{message.content}
</div>
