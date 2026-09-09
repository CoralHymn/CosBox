<script lang="ts">
	import LineChart, { type ChartSeries } from './LineChart.svelte';
	import type { MetricEvent, TurnSample } from '../stores/metrics.svelte';

	interface Props {
		counters: Record<string, number>;
		turns: TurnSample[];
		events: MetricEvent[];
		onReset: () => void;
	}

	let { counters, turns, events, onReset }: Props = $props();

	/** 指标事件名的中文标签；未收录的事件名原样展示。 */
	const METRIC_LABELS: Record<string, string> = {
		'tool_call.structured': '结构化工具调用（JSON）',
		'tool_call.structured_text': '文本解析产生的工具执行',
		'tool_call.text_fallback.main': '文本兜底 · 主循环解析',
		'tool_call.text_fallback.retry': '文本兜底 · 补调重试采纳',
		'tool_call.text_fallback.confirmation': '文本兜底 · 状态确认采纳',
		'tool_call.host_infer': '宿主推断调用（advance_time）',
		'tool.execution_error': '工具执行失败',
		'retry.planned.triggered': '补调（思考意图）触发',
		'retry.planned.adopted': '补调（思考意图）采纳',
		'retry.time_claim.triggered': '补调（时间描述）触发',
		'retry.time_claim.adopted': '补调（时间描述）采纳',
		'retry.malformed.triggered': '补发（无效调用）触发',
		'retry.malformed.adopted': '补发（无效调用）采纳',
		'retry.thinking_only.triggered': '只思考重试触发',
		'retry.thinking_only.adopted': '只思考重试采纳',
		'retry.thinking_loop.triggered': '思考循环重试触发',
		'retry.thinking_loop.adopted': '思考循环重试采纳',
		'retry.plain_text.triggered': '纯文本兜底重试触发',
		'retry.plain_text.adopted': '纯文本兜底重试采纳',
		'malformed.tool_call.detected': '检测到无效 tool_calls',
		'loop.thinking_aborted': '思考循环中断',
		'judge.triggered': '状态判断触发',
		'judge.needs_tool': '状态判断：需要同步',
		'judge.no_change': '状态判断：无需变更',
		'reply.empty': '空回复',
		'reply.finish_length': '正文被 Max Tokens 截断',
		'compaction.triggered': '上下文压缩触发'
	};

	function labelOf(name: string): string {
		return METRIC_LABELS[name] ?? name;
	}

	/** 计数卡按标签排序，文本兜底相关指标置顶（最需要盯的调试指标）。 */
	const counterList = $derived(
		Object.entries(counters).sort(([a], [b]) => {
			const aFallback = a.includes('text_fallback') ? 0 : 1;
			const bFallback = b.includes('text_fallback') ? 0 : 1;
			if (aFallback !== bFallback) {
				return aFallback - bFallback;
			}
			return labelOf(a).localeCompare(labelOf(b), 'zh');
		})
	);

	const tokenSeries = $derived<ChartSeries[]>([
		{
			label: '提示词 tokens',
			color: 'var(--accent)',
			points: turns.map((turn) => turn.promptTokens)
		},
		{
			label: '补全 tokens',
			color: 'var(--accent-2)',
			points: turns.map((turn) => turn.completionTokens)
		}
	]);

	const latencySeries = $derived<ChartSeries[]>([
		{
			label: '响应耗时（秒，含补调/状态确认后处理）',
			color: 'var(--warn)',
			points: turns.map((turn) => turn.latencyMs / 1000)
		}
	]);

	const toolSeries = $derived<ChartSeries[]>([
		{ label: '工具调用数', color: 'var(--ok)', points: turns.map((turn) => turn.toolCalls) },
		{ label: '补调/重试次数', color: 'var(--accent)', points: turns.map((turn) => turn.retries) },
		{
			label: '文本兜底采纳数',
			color: 'var(--err)',
			points: turns.map((turn) => turn.textFallbacks)
		}
	]);

	/** 事件流水倒序展示最近 60 条。 */
	const recentEvents = $derived([...events].reverse().slice(0, 60));

	function formatTime(t: number): string {
		const date = new Date(t);
		const pad = (value: number): string => `${value}`.padStart(2, '0');
		return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	}
</script>

<div class="panel">
	<div class="panel-head">
		<div>
			<h2 class="panel-title">监控</h2>
			<p class="panel-sub">
				记录工具调用、补调重试与文本兜底等运行指标。「文本兜底」相关计数若持续飙升，
				说明模型在主流程偷懒不发结构化 tool_calls，可到「设置 → AI 行为」关闭
				「文本形式工具调用双通道」强制只走 JSON。
			</p>
		</div>
		<button class="btn btn-small" onclick={onReset}>清空数据</button>
	</div>

	<div class="card">
		<h3 class="card-title">累计计数</h3>
		{#if counterList.length === 0}
			<p class="muted">还没有产生任何指标事件。</p>
		{:else}
			<div class="counter-grid">
				{#each counterList as [name, value] (name)}
					<div class="counter-item" class:counter-alert={name.includes('text_fallback')}>
						<span class="counter-value">{value}</span>
						<span class="counter-label" title={name}>{labelOf(name)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="card">
		<h3 class="card-title">Token 消耗（按轮次）</h3>
		<LineChart series={tokenSeries} />
	</div>

	<div class="card">
		<h3 class="card-title">响应耗时（按轮次）</h3>
		<LineChart series={latencySeries} format={(value) => `${value.toFixed(1)}s`} />
	</div>

	<div class="card">
		<h3 class="card-title">工具调用与兜底（按轮次）</h3>
		<LineChart series={toolSeries} />
	</div>

	<div class="card">
		<h3 class="card-title">最近事件</h3>
		{#if recentEvents.length === 0}
			<p class="muted">暂无事件。</p>
		{:else}
			<ul class="event-list">
				{#each recentEvents as event, i (`${event.t}-${i}`)}
					<li>
						<span class="event-time">{formatTime(event.t)}</span>
						<span class="event-name" class:event-alert={event.name.includes('text_fallback')}
							>{labelOf(event.name)}</span
						>
						<span class="muted event-key">{event.name}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.counter-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 8px;
	}
	.counter-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--panel-2);
		border: 1px solid var(--border);
	}
	.counter-item.counter-alert {
		border-color: var(--accent);
	}
	.counter-value {
		font-size: 18px;
		font-weight: 600;
	}
	.counter-label {
		font-size: 12px;
		color: var(--text-dim);
	}
	.event-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}
	.event-list li {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.event-time {
		color: var(--text-faint);
		font-size: 12px;
		flex-shrink: 0;
	}
	.event-name.event-alert {
		color: var(--accent);
	}
	.event-key {
		font-size: 11px;
	}
</style>
