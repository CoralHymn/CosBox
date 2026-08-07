<script lang="ts">
	import type { ContextBundle } from '../context/pipeline';
	import type { CompactionState } from '../llm/compaction';
	import {
		estimateCost,
		estimateMessagesTokens,
		findModelInfo,
		resolveContextWindow
	} from '../llm/model-info';
	import type { LlmConfig, TokenUsage } from '../llm/types';

	interface Props {
		config: LlmConfig;
		/** 最近一次请求的上下文包；null 表示尚未发送消息。 */
		context: ContextBundle | null;
		/** 最近一次请求的 token 用量（API 返回或本地估算）。 */
		usage: TokenUsage | null;
		/** 应用重启后从本地恢复的上次请求摘要；context 为 null 但仍有用量数据时展示。 */
		restored?: { keptRecent: number } | null;
		/** 最近一次请求使用的压缩状态；null = 未压缩。 */
		compaction: CompactionState | null;
		/** 自动压缩开关（只读展示，配置在设置页）。 */
		autoCompact: boolean;
		/** 压缩触发阈值（只读展示）。 */
		compactThreshold: number;
		/** 正在执行手动压缩。 */
		compacting: boolean;
		onCompactNow: () => void;
	}

	let {
		config,
		context,
		usage,
		restored = null,
		compaction,
		autoCompact,
		compactThreshold,
		compacting,
		onCompactNow
	}: Props = $props();

	/** 实际发送给模型的完整消息数组（系统消息 + 处理后的历史）。 */
	const sentMessages = $derived(
		context === null
			? []
			: [{ role: 'system' as const, content: context.systemMessage }, ...context.messages]
	);

	/** 上下文窗口：优先服务端/配置值，其次本地目录。 */
	const contextWindow = $derived(resolveContextWindow(config.modelContextWindow, config.model));

	/** 输入 token：优先 API usage，缺省时用本地启发式估算。 */
	const promptTokens = $derived(
		usage?.promptTokens ?? (context === null ? 0 : estimateMessagesTokens(sentMessages))
	);
	const outputTokens = $derived(usage?.completionTokens ?? 0);
	const cachedTokens = $derived(usage?.cachedTokens ?? 0);
	const totalTokens = $derived(promptTokens + outputTokens);
	const percent = $derived(
		contextWindow === null ? null : Math.min(100, (totalTokens / contextWindow) * 100)
	);
	const cost = $derived(
		context === null
			? null
			: estimateCost(
					{ promptTokens, completionTokens: outputTokens, cachedTokens },
					findModelInfo(config.model)
				)
	);
	const barClass = $derived(
		percent === null ? '' : percent >= 90 ? 'err' : percent >= 70 ? 'warn' : ''
	);
	/** 摘要之外原样保留的最近消息数（从上次请求的历史中数出）。 */
	const keptRecent = $derived(
		context === null
			? restored?.keptRecent ?? 0
			: context.history.filter((message) => message.id !== 'context-summary').length
	);
	const statusText = $derived.by(() => {
		if (compaction !== null) {
			return `已压缩：早期对话已总结为摘要，最近 ${keptRecent} 条完整保留。`;
		}
		if (autoCompact === false) {
			return '已关闭自动压缩：完整发送全部历史。';
		}
		return `未达触发阈值（${Math.round(compactThreshold * 100)}%），完整发送全部历史。`;
	});
</script>

<div class="context-panel">
	<p class="card-title">上下文用量（估算）</p>
	{#if context === null && restored === null}
		<p class="muted" style="margin: 0;">发送一条消息后显示本次请求的 token 用量与费用。</p>
	{:else}
		<div class="ctx-row">
			<span class="k">上下文长度</span>
			<span>{percent === null ? '窗口未知' : `${percent.toFixed(1)}%`}</span>
		</div>
		<div class="ctx-bar">
			<div class="ctx-fill {barClass}" style:width="{percent ?? 0}%"></div>
		</div>
		<div class="ctx-row">
			<span class="k">输入 / 已缓存</span>
			<span>{promptTokens.toLocaleString()} / {cachedTokens.toLocaleString()}</span>
		</div>
		<div class="ctx-row">
			<span class="k">输出</span>
			<span>{outputTokens.toLocaleString()}</span>
		</div>
		<div class="ctx-row">
			<span class="k">费用（USD）</span>
			<span>{cost === null ? '—' : `$${cost.toFixed(4)}`}</span>
		</div>
		<p class="muted" style="margin: 8px 0 0;">
			模型 {config.model} · 窗口 {contextWindow === null ? '未知' : contextWindow.toLocaleString()}
		</p>
		<div class="ctx-compress">
			<p class="muted" style="margin: 0;">{statusText}</p>
			<button
				class="btn btn-small"
				onclick={onCompactNow}
				disabled={compacting || context === null}
			>
				{compacting ? '压缩中…' : '立即压缩'}
			</button>
		</div>
		<p class="muted" style="margin: 8px 0 0;">
			压缩由模型生成延续摘要（保留角色关系、关键事件等细节），只影响发送给 AI 的内容，
			聊天记录与快照不受影响。
		</p>
	{/if}
</div>
