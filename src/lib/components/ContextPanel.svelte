<script lang="ts">
	import type { ContextBundle } from '../context/pipeline';
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
		/** 发送给模型的历史消息条数上限（压缩开关）。 */
		historyMaxMessages: number;
		onHistoryMaxChange: (max: number) => void;
	}

	let { config, context, usage, historyMaxMessages, onHistoryMaxChange }: Props = $props();

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
</script>

<div class="context-panel">
	<p class="card-title">上下文用量（估算）</p>
	{#if context === null}
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
			<label for="ctx-history-max">发送给模型的历史消息数</label>
			<select
				id="ctx-history-max"
				class="select"
				value={historyMaxMessages}
				onchange={(event) =>
					onHistoryMaxChange(Number((event.currentTarget as HTMLSelectElement).value))}
			>
				<option value={5}>5 条（激进压缩）</option>
				<option value={10}>10 条（压缩）</option>
				<option value={20}>20 条（完整）</option>
			</select>
			{#if context.compressedCount > 0}
				<p class="muted" style="margin: 6px 0 0;">
					上次请求已省略 {context.compressedCount} 条早期消息。
				</p>
			{/if}
		</div>
		<p class="muted" style="margin: 8px 0 0;">
			压缩只影响发送给 AI 的上下文，聊天记录与快照不受影响。
		</p>
	{/if}
</div>
