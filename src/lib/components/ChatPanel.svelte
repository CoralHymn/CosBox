<script lang="ts">
	import type { ContextBundle } from '../context/pipeline';
	import type { CharacterState, ChatMessageView } from '../core/types';
	import { serializeDebugPrompt, type DebugPromptView } from '../llm/chat-service';
	import type { CompactionState } from '../llm/compaction';
	import type { LlmConfig, TokenUsage } from '../llm/types';
	import ChatInput from './ChatInput.svelte';
	import ContextPanel from './ContextPanel.svelte';
	import MessageBubble from './MessageBubble.svelte';
	import StatePreview from './StatePreview.svelte';

	interface Props {
		conversation: ChatMessageView[];
		characterState: CharacterState;
		config: LlmConfig;
		/** 最近一次请求的上下文包；null 表示尚未发送消息。 */
		context: ContextBundle | null;
		/** 最近一次请求的 token 用量。 */
		usage: TokenUsage | null;
		/** 最近一次请求使用的压缩状态。 */
		compaction: CompactionState | null;
		/** 自动压缩开关（配置持久化在设置页，此处只读展示）。 */
		autoCompact: boolean;
		/** 压缩触发阈值。 */
		compactThreshold: number;
		/** 正在执行手动压缩。 */
		compacting: boolean;
		onCompactNow: () => void;
		busy: boolean;
		searchSupported: boolean;
		searching: boolean;
		developerMode: boolean;
		debugPrompt: DebugPromptView | null;
		onSend: (content: string, options: { search: boolean }) => void;
	}

	let {
		conversation,
		characterState,
		config,
		context,
		usage,
		compaction,
		autoCompact,
		compactThreshold,
		compacting,
		onCompactNow,
		busy,
		searchSupported,
		searching,
		developerMode,
		debugPrompt,
		onSend
	}: Props = $props();
	let listEl = $state<HTMLDivElement | null>(null);
	let debugOpen = $state(false);
	let copyStatus = $state('');
	let copyTimer: number | undefined;

	$effect(() => {
		void conversation;
		if (listEl !== null) {
			listEl.scrollTop = listEl.scrollHeight;
		}
	});

	/** 弹窗打开时监听 Esc 关闭。 */
	$effect(() => {
		if (!debugOpen) {
			return;
		}
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				debugOpen = false;
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	/** 复制完整提示词到剪贴板（含 system 与工具调用）。 */
	async function copyDebug(): Promise<void> {
		if (debugPrompt === null) {
			return;
		}
		try {
			await navigator.clipboard.writeText(serializeDebugPrompt(debugPrompt));
			copyStatus = '已复制';
		} catch {
			copyStatus = '复制失败';
		}
		if (copyTimer !== undefined) {
			window.clearTimeout(copyTimer);
		}
		copyTimer = window.setTimeout(() => {
			copyStatus = '';
		}, 1500);
	}
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
			<div class="debug-bar">
				<button class="btn btn-small" onclick={() => (debugOpen = true)}>
					开发者：查看最近一次完整提示词
				</button>
			</div>
			{#if debugOpen}
				<div
					class="prompt-backdrop"
					role="presentation"
					onclick={(event) => {
						if (event.target === event.currentTarget) {
							debugOpen = false;
						}
					}}
				>
					<div class="prompt-modal" role="dialog" aria-label="最近一次发送给 AI 的完整提示词">
						<div class="prompt-modal-head">
							<span class="prompt-modal-title">最近一次发送给 AI 的完整提示词</span>
							<div class="row-actions">
								<button class="btn btn-small" onclick={copyDebug}>
									{copyStatus === '' ? '复制全部' : copyStatus}
								</button>
								<button class="btn btn-small" onclick={() => (debugOpen = false)}>关闭</button>
							</div>
						</div>
						<div class="prompt-modal-body">
							<p class="muted" style="margin: 0 0 4px;">system</p>
							<pre>{debugPrompt.systemMessage}</pre>
							{#each debugPrompt.messages as message, i (i)}
								<p class="muted" style="margin: 10px 0 4px;">[{message.role}]</p>
								<pre>{message.content}</pre>
								{#if message.toolCalls !== undefined && message.toolCalls.length > 0}
									<pre>{JSON.stringify(message.toolCalls, null, 2)}</pre>
								{/if}
							{/each}
						</div>
					</div>
				</div>
			{/if}
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
	<aside class="side-preview">
		<StatePreview {characterState} />
		<ContextPanel
			{config}
			{context}
			{usage}
			{compaction}
			{autoCompact}
			{compactThreshold}
			{compacting}
			{onCompactNow}
		/>
	</aside>
</div>
