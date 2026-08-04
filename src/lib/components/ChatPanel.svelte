<script lang="ts">
	import type { CharacterState, ChatMessageView } from '../core/types';
	import type { DebugPromptView } from '../llm/chat-service';
	import ChatInput from './ChatInput.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import StatePreview from './StatePreview.svelte';

	interface Props {
		conversation: ChatMessageView[];
		characterState: CharacterState;
		busy: boolean;
		searchSupported: boolean;
		searching: boolean;
		developerMode: boolean;
		debugPrompt: DebugPromptView | null;
		onSend: (content: string, options: { search: boolean }) => void;
	}

	let { conversation, characterState, busy, searchSupported, searching, developerMode, debugPrompt, onSend }: Props =
		$props();
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
		{#if developerMode && debugPrompt !== null}
			<details class="debug-prompt">
				<summary>开发者：最近一次发送给 AI 的完整提示词</summary>
				<p class="muted" style="margin: 6px 0 2px;">system</p>
				<pre>{debugPrompt.systemMessage}</pre>
				{#each debugPrompt.messages as message, i (i)}
					<p class="muted" style="margin: 8px 0 2px;">[{message.role}]</p>
					<pre>{message.content}</pre>
					{#if message.toolCalls !== undefined && message.toolCalls.length > 0}
						<pre>{JSON.stringify(message.toolCalls, null, 2)}</pre>
					{/if}
				{/each}
			</details>
		{/if}
		<ChatInput
			disabled={busy}
			{searchSupported}
			{searching}
			places={characterState.places}
			wardrobe={characterState.outfit.wardrobe}
			{onSend}
		/>
	</div>
	<StatePreview {characterState} />
</div>
