<script lang="ts">
	import type { CharacterState, ChatMessageView } from '../core/types';
	import ChatInput from './ChatInput.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import StatePreview from './StatePreview.svelte';

	interface Props {
		conversation: ChatMessageView[];
		characterState: CharacterState;
		busy: boolean;
		onSend: (content: string) => void;
	}

	let { conversation, characterState, busy, onSend }: Props = $props();
	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void conversation;
		if (listEl !== null) {
			listEl.scrollTop = listEl.scrollHeight;
		}
	});
</script>

<div class="chat-layout">
	<div class="chat-panel">
		{#if conversation.length === 0}
			<div class="empty-chat">
				<div>
					<p style="font-size: 15px; margin: 0 0 6px;">开始一段新的故事吧</p>
					<p class="muted">每一次消息与状态变更都会记录为快照，可随时回到任意时刻。</p>
				</div>
			</div>
		{:else}
			<div class="messages" bind:this={listEl}>
				{#each conversation as message (message.id)}
					<MessageBubble {message} />
				{/each}
			</div>
		{/if}
		<ChatInput disabled={busy} onSend={onSend} />
	</div>
	<StatePreview {characterState} />
</div>
