<script lang="ts">
	import type { ContextBundle } from '../context/pipeline';
	import type {
		BranchSummary,
		CharacterState,
		ChatMessageView,
		MessageSegment,
		SnapshotNode
	} from '../core/types';
	import { formatWorldTime } from '../core/state';
	import {
		serializeDebugPrompt,
		type DebugPromptView,
		type PromptPreviewResult
	} from '../llm/chat-service';
	import type { CompactionState } from '../llm/compaction';
	import type { DecisionDebugView } from '../llm/state-decision';
	import type { LlmConfig, TokenUsage } from '../llm/types';
	import type { DemoDockModel } from '../workspace/demo';
	import DemoDock from './DemoDock.svelte';
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
		/** 应用重启后从本地恢复的上次请求摘要；context 为 null 但仍有用量数据时展示。 */
		restored?: { keptRecent: number } | null;
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
		/** 最近一次决策模型判断的调试视图（开发者模式查看）。 */
		decisionDebug?: DecisionDebugView | null;
		/** 输入预览：返回「当前输入框内容点击发送会发送给 AI 什么」。 */
		onPreview: (draft: string) => PromptPreviewResult;
		onSend: (content: string, options: { search: boolean }) => void;
		/** 编辑已有消息正文（user/assistant），保存后原地改写快照。 */
		onEditMessage?: (id: string, content: string) => Promise<void>;
		/** 最近消息日志（从最近一次用户发言开始，流式实时追加）。 */
		recentLog: string;
		/** 导出最近日志。 */
		onExportLog: () => void;
		/** 流式分段草稿：正在生成、尚未落快照的 assistant 分段；null 表示未在生成。 */
		streamingSegments: MessageSegment[] | null;
		/** 后处理阶段文案（补调重试/状态确认等）；非 null 时气泡下方显示状态条。 */
		streamingPhase: string | null;
		/** 全部分支 tip（用于消息气泡下方的分支切换）。 */
		branches: BranchSummary[];
		/** 全部快照节点（用于计算分支备选路径）。 */
		snapshots: SnapshotNode[];
		/** 当前 head 快照 id。 */
		headId: string | null;
		/** 是否允许 AI 状态工具：决定「状态补执行」按钮是否可用。 */
		allowStateTools: boolean;
		/** 重新生成：回溯到该 assistant 消息之前重新发送。 */
		onRetry: (id: string) => void;
		/** 手动触发决策模型状态补执行（判断 + 补执行工具）。 */
		onConfirmState: (id: string) => void;
		/** 切换到指定分支 tip。 */
		onSwitchBranch: (tipId: string) => void;
		/** 打断生成（busy 时发送按钮变为「停止」）。 */
		onStop: () => void;
		/** 首访演示 Dock；null 表示不在演示工作区。 */
		demo?: DemoDockModel | null;
		/** 演示状态脉冲：每次状态变化递增，触发预览卡片高亮。 */
		pulse?: number;
	}

	let {
		conversation,
		characterState,
		config,
		context,
		usage,
		restored = null,
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
		decisionDebug,
		onPreview,
		onSend,
		onEditMessage,
		recentLog,
		onExportLog,
		streamingSegments,
		streamingPhase,
		branches,
		snapshots,
		headId,
		allowStateTools,
		onRetry,
		onConfirmState,
		onSwitchBranch,
		onStop,
		demo = null,
		pulse = 0
	}: Props = $props();
	let listEl = $state<HTMLDivElement | null>(null);
	/** 输入框当前草稿（供预览）。 */
	let draftText = $state('');
	/** 提示词弹窗内容：最近一次请求或输入预览。 */
	let modal = $state<
		| { title: string; view: DebugPromptView; note?: string }
		| { title: string; notice: string }
		| { title: string; decision: DecisionDebugView }
		| null
	>(null);
	let copyStatus = $state('');
	let copyTimer: number | undefined;

	/** 快照 id -> 节点（O(1) 查找；每个气泡的 branchNavFor 不再 O(n) 扫描全表）。 */
	const nodeById = $derived.by(() => {
		const byId: Record<string, SnapshotNode> = {};
		for (const node of snapshots) {
			byId[node.id] = node;
		}
		return byId;
	});

	/** 消息 id -> 可切换的备选分支（与该分支在该消息位置岔开，不含当前 head）。 */
	const branchAlts = $derived.by(() => {
		const result: Record<string, { tipId: string; timestamp: number }[]> = {};
		const currentIds = conversation.map((message) => message.id);
		const currentRoles = conversation.map((message) => message.role);
		for (const branch of branches) {
			if (branch.tipId === headId) {
				continue;
			}
			// 沿 parentId 回溯该分支的消息 id 链（根 -> tip），避免引入可变 Map。
			const ids: string[] = [];
			let cursor: string | null = branch.tipId;
			let guard = 0;
			while (cursor !== null && guard <= snapshots.length) {
				guard += 1;
				const current: SnapshotNode | undefined = nodeById[cursor];
				if (current === undefined) {
					break;
				}
				if (current.delta !== null && current.delta.kind === 'message') {
					ids.push(current.id);
				}
				cursor = current.parentId;
			}
			ids.reverse();
			let diverge = 0;
			while (
				diverge < currentIds.length &&
				diverge < ids.length &&
				currentIds[diverge] === ids[diverge]
			) {
				diverge += 1;
			}
			if (diverge >= currentIds.length && diverge >= ids.length) {
				continue;
			}
			let attachIndex = diverge < currentIds.length ? diverge : currentIds.length - 1;
			// 分支切换挂在用户气泡：若岔开位置是 assistant（重试场景），
			// 挂到其前面的用户消息，让用户能在「重发的那条消息」下方切换。
			while (attachIndex > 0 && currentRoles[attachIndex] !== 'user') {
				attachIndex -= 1;
			}
			if (attachIndex < 0 || currentRoles[attachIndex] !== 'user') {
				continue;
			}
			const currentId = currentIds[attachIndex]!;
			const list = result[currentId] ?? [];
			list.push({ tipId: branch.tipId, timestamp: branch.lastTimestamp });
			result[currentId] = list;
		}
		return result;
	});

	/** 指定消息的分支切换状态（< > 循环切换同一位置的所有备选分支）。 */
	function branchNavFor(messageId: string): {
		canPrev: boolean;
		canNext: boolean;
		onPrev: () => void;
		onNext: () => void;
	} | null {
		const entries = [...(branchAlts[messageId] ?? [])];
		if (headId !== null) {
			const headTimestamp = nodeById[headId]?.timestamp ?? Number.MAX_SAFE_INTEGER;
			entries.push({ tipId: headId, timestamp: headTimestamp });
		}
		entries.sort((a, b) => a.timestamp - b.timestamp);
		if (entries.length <= 1) {
			return null;
		}
		const currentIndex = entries.findIndex((entry) => entry.tipId === headId);
		if (currentIndex === -1) {
			return null;
		}
		const prev = entries[(currentIndex - 1 + entries.length) % entries.length]!;
		const next = entries[(currentIndex + 1) % entries.length]!;
		return {
			canPrev: true,
			canNext: true,
			onPrev: () => onSwitchBranch(prev.tipId),
			onNext: () => onSwitchBranch(next.tipId)
		};
	}

	$effect(() => {
		void conversation;
		void streamingSegments;
		void streamingPhase;
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

	/** 打开「决策模型判断」调试视图。 */
	function openDecisionDebug(): void {
		if (decisionDebug != null) {
			modal = { title: '最近一次决策模型判断', decision: decisionDebug };
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
		{#if conversation.length === 0 && streamingSegments === null}
			<div class="empty-chat">
				<div>
					<p style="font-size: 15px; margin: 0 0 6px;">开始一段新的故事吧</p>
					<p class="muted">每一次消息与状态变更都会记录为快照，可随时回到任意时刻。</p>
				</div>
			</div>
		{:else}
			<div class="messages" bind:this={listEl}>
				{#each conversation as message (message.id)}
					<MessageBubble
						{message}
						onEdit={onEditMessage}
						disabled={busy}
						{onRetry}
						onConfirmState={allowStateTools ? onConfirmState : undefined}
						branchNav={branchNavFor(message.id)}
					/>
				{/each}
				{#if streamingSegments !== null}
					<MessageBubble
						message={{
							id: 'stream-draft',
							role: 'assistant',
							content: streamingSegments
								.filter((segment) => segment.kind === 'text')
								.map((segment) => segment.content)
								.join('\n'),
							timestamp: Date.now(),
							...(streamingSegments.length > 0 ? { segments: streamingSegments } : {})
						}}
					/>
				{/if}
				{#if streamingPhase !== null}
					<!-- 正文已输出后的后处理状态条：补调重试/状态判断/确认不再是黑盒停顿。 -->
					<div class="phase-bar" role="status">
						<span class="phase-dot"></span>
						{streamingPhase}
					</div>
				{/if}
			</div>
		{/if}
		{#if developerMode}
			<div class="debug-bar">
				{#if debugPrompt !== null}
					<button class="btn btn-small" onclick={openRecent}>
						开发者：查看最近一次完整提示词
					</button>
				{/if}
				{#if decisionDebug !== null}
					<button class="btn btn-small" onclick={openDecisionDebug}>
						开发者：查看上次状态决策
					</button>
				{/if}
				{#if recentLog.trim() !== ''}
					<button class="btn btn-small" onclick={onExportLog}>
						导出最近日志（{recentLog.split('\n\n').length} 段
						{#if streamingSegments !== null}，记录中{/if}）
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
							{#if 'decision' in modal}
								<p class="muted" style="margin: 0 0 4px;">
									判断结果：{modal.decision.needsTool ? '需要补执行' : '无需变更'}
								</p>
								<p class="muted" style="margin: 0 0 4px;">
									来源：{modal.decision.source === 'jev'
										? 'Jev 决策模型'
										: modal.decision.source === 'unconfigured'
											? '未配置（保守补执行）'
											: '请求失败（保守补执行）'}
									{#if modal.decision.probability !== null}
										· 概率 {Math.round(modal.decision.probability * 100)}%
									{/if}
									· 阈值 {Math.round(modal.decision.threshold * 100)}%
								</p>
								{#if modal.decision.error !== undefined}
									<p class="muted" style="margin: 0 0 4px;">{modal.decision.error}</p>
								{/if}
								<p class="muted" style="margin: 10px 0 4px;">System One 端点：</p>
								<pre>{modal.decision.request.url}</pre>
								<p class="muted" style="margin: 10px 0 4px;">发送给决策模型的问题：</p>
								<pre>{JSON.stringify(modal.decision.request.body, null, 2)}</pre>
								<p class="muted" style="margin: 10px 0 4px;">状态与最近一轮对话：</p>
								<pre>{modal.decision.state}</pre>
								{#if modal.decision.response !== undefined}
									<p class="muted" style="margin: 10px 0 4px;">决策模型响应：</p>
									<pre>{JSON.stringify(modal.decision.response, null, 2)}</pre>
								{/if}
								{#if modal.decision.confirmation !== undefined}
									<p class="muted" style="margin: 12px 0 4px;">确认阶段的工具调用：</p>
									<pre>{JSON.stringify(modal.decision.confirmation.toolCalls, null, 2)}</pre>
									<p class="muted" style="margin: 10px 0 4px;">工具执行结果：</p>
									{#each modal.decision.confirmation.executed as tool (tool.id)}
										<pre>[{tool.name}] {tool.output}</pre>
									{/each}
									<p class="muted" style="margin: 10px 0 4px;">确认阶段完整消息（含工具反馈）：</p>
									{#each modal.decision.confirmation.messages as message, i (i)}
										<p class="muted" style="margin: 6px 0 2px;">[{message.role}]</p>
										<pre>{message.content}</pre>
									{/each}
								{/if}
							{:else if 'view' in modal}
								{#if modal.view.request !== undefined}
									<p class="muted" style="margin: 0 0 4px;">
										请求参数：model={modal.view.request.model}，max_tokens=
										{modal.view.request.maxTokens}，stream={modal.view.request.stream
											? '开'
											: '关'}，状态工具={modal.view.request.toolsEnabled ? '开' : '关'}
									</p>
									{#if modal.view.request.reasoningSummary !== undefined}
										<p class="muted" style="margin: 0 0 4px;">
											{modal.view.request.reasoningSummary}
										</p>
									{/if}
								{/if}
								{#if modal.view.lastResponse !== undefined}
									<p class="muted" style="margin: 0 0 4px;">
										最近响应：finish_reason={modal.view.lastResponse.finishReason ?? '未知'}， 正文={modal
											.view.lastResponse.hasContent
											? '有'
											: '空'}，工具调用=
										{modal.view.lastResponse.hasToolCalls ? '有' : '无'}，思考=
										{modal.view.lastResponse.thinkingChars} 字
									</p>
								{/if}
								<p class="muted" style="margin: 0 0 4px;">system</p>
								<pre>{modal.view.systemMessage}</pre>
								{#each modal.view.messages as message, i (i)}
									{#if !(i === 0 && message.role === 'system' && message.content === modal.view.systemMessage)}
										<p class="muted" style="margin: 10px 0 4px;">
											[{message.role}]{#if message.worldTime !== undefined}（{formatWorldTime(
													message.worldTime
												)}）{/if}
										</p>
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
		{#if demo !== null}
			<DemoDock model={demo} />
		{/if}
		<ChatInput
			disabled={busy}
			{busy}
			{searchSupported}
			{searching}
			places={characterState.places}
			wardrobe={characterState.outfit.wardrobe}
			onTextChange={(text) => (draftText = text)}
			{onSend}
			{onStop}
		/>
	</div>
	<aside class="side-preview">
		<StatePreview {characterState} {pulse} />
		<ContextPanel
			{config}
			{context}
			{usage}
			{restored}
			{compaction}
			{autoCompact}
			{compactThreshold}
			{compacting}
			{onCompactNow}
		/>
	</aside>
</div>
