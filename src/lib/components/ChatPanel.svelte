<script lang="ts">
	import type { ContextBundle } from '../context/pipeline';
	import type { CharacterState, ChatMessageView } from '../core/types';
	import {
		serializeDebugPrompt,
		type DebugPromptView,
		type PromptPreviewResult
	} from '../llm/chat-service';
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
		/** 输入预览：返回「当前输入框内容点击发送会发送给 AI 什么」。 */
		onPreview: (draft: string) => PromptPreviewResult;
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
		onPreview,
		onSend
	}: Props = $props();
	let listEl = $state<HTMLDivElement | null>(null);
	/** 输入框当前草稿（供预览）。 */
	let draftText = $state('');
	/** 提示词弹窗内容：最近一次请求或输入预览。 */
	let modal = $state<
		| { title: string; view: DebugPromptView; note?: string }
		| { title: string; notice: string }
		| null
	>(null);
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
		if (modal === null) {
			return;
		}
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				modal = null;
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	/** 打开「最近一次发送给 AI 的完整提示词」。 */
	function openRecent(): void {
		if (debugPrompt !== null) {
			modal = { title: '最近一次发送给 AI 的完整提示词', view: debugPrompt };
		}
	}

	/** 打开「输入预览」：按当前草稿组装完整提示词（不发送、不落快照）。 */
	function openPreview(): void {
		const result = onPreview(draftText);
		if (result.kind === 'prompt') {
			modal = {
				title: '输入预览：点击发送将发送给 AI 的内容',
				view: result.debug,
				note: result.note
			};
		} else {
			modal = { title: '输入预览', notice: result.text };
		}
	}

	/** 复制完整提示词到剪贴板（含 system 与工具调用）。 */
	async function copyModal(): Promise<void> {
		if (modal === null || !('view' in modal)) {
			return;
		}
		try {
			await navigator.clipboard.writeText(serializeDebugPrompt(modal.view));
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
		{#if developerMode}
			<div class="debug-bar">
				{#if debugPrompt !== null}
					<button class="btn btn-small" onclick={openRecent}>
						开发者：查看最近一次完整提示词
					</button>
				{/if}
				<button class="btn btn-small" onclick={openPreview}> 开发者：预览输入框提示词 </button>
			</div>
			{#if modal !== null}
				<div
					class="prompt-backdrop"
					role="presentation"
					onclick={(event) => {
						if (event.target === event.currentTarget) {
							modal = null;
						}
					}}
				>
					<div class="prompt-modal" role="dialog" aria-label={modal.title}>
						<div class="prompt-modal-head">
							<span class="prompt-modal-title">{modal.title}</span>
							<div class="row-actions">
								{#if 'view' in modal}
									<button class="btn btn-small" onclick={copyModal}>
										{copyStatus === '' ? '复制全部' : copyStatus}
									</button>
								{/if}
								<button class="btn btn-small" onclick={() => (modal = null)}>关闭</button>
							</div>
						</div>
						<div class="prompt-modal-body">
							{#if 'view' in modal}
								<p class="muted" style="margin: 0 0 4px;">system</p>
								<pre>{modal.view.systemMessage}</pre>
								{#each modal.view.messages as message, i (i)}
									{#if !(i === 0 && message.role === 'system' && message.content === modal.view.systemMessage)}
										<p class="muted" style="margin: 10px 0 4px;">[{message.role}]</p>
										<pre>{message.content}</pre>
										{#if message.toolCalls !== undefined && message.toolCalls.length > 0}
											<pre>{JSON.stringify(message.toolCalls, null, 2)}</pre>
										{/if}
									{/if}
								{/each}
								{#if modal.note !== undefined}
									<p class="muted" style="margin: 12px 0 0; white-space: pre-wrap;">
										{modal.note}
									</p>
								{/if}
							{:else}
								<pre>{modal.notice}</pre>
							{/if}
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
			onTextChange={(text) => (draftText = text)}
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
