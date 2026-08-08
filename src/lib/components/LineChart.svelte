<script lang="ts">
	/** 折线图数据序列：points 与同图最长序列按索引右对齐（缺位视为无数据）。 */
	export interface ChartSeries {
		label: string;
		/** 描边颜色（可用 CSS 变量，随主题变化）。 */
		color: string;
		points: number[];
	}

	interface Props {
		series: ChartSeries[];
		/** SVG 视口高度（宽度自适应容器）。 */
		height?: number;
		/** 数值格式化（图例与坐标提示用）。 */
		format?: (value: number) => string;
	}

	let { series, height = 120, format = (value) => `${Math.round(value)}` }: Props = $props();

	const VIEW_W = 600;
	const PAD_Y = 8;

	/** Catmull-Rom 转三次贝塞尔：平滑曲线（spline chart）。 */
	function splinePath(points: { x: number; y: number }[]): string {
		if (points.length === 0) {
			return '';
		}
		if (points.length === 1) {
			return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
		}
		let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
		for (let i = 0; i < points.length - 1; i += 1) {
			const p0 = points[i - 1] ?? points[i]!;
			const p1 = points[i]!;
			const p2 = points[i + 1]!;
			const p3 = points[i + 2] ?? p2;
			const c1x = p1.x + (p2.x - p0.x) / 6;
			const c1y = p1.y + (p2.y - p0.y) / 6;
			const c2x = p2.x - (p3.x - p1.x) / 6;
			const c2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
		}
		return d;
	}

	/** 计算坐标：所有序列共用同一 Y 轴范围（min..max，至少 0..1）。 */
	const view = $derived.by(() => {
		const all = series.flatMap((entry) => entry.points);
		const maxLen = series.reduce((max, entry) => Math.max(max, entry.points.length), 0);
		if (all.length === 0 || maxLen < 1) {
			return null;
		}
		const max = Math.max(...all, 0);
		const min = Math.min(...all, 0);
		const range = max - min > 0 ? max - min : 1;
		const step = maxLen > 1 ? VIEW_W / (maxLen - 1) : 0;
		const paths = series.map((entry) => {
			// 右对齐：短序列（如后加的指标）靠右绘制，与最新轮次对齐。
			const offset = maxLen - entry.points.length;
			const coords = entry.points.map((value, index) => ({
				x: maxLen > 1 ? (offset + index) * step : VIEW_W / 2,
				y: PAD_Y + (1 - (value - min) / range) * (height - PAD_Y * 2)
			}));
			return {
				label: entry.label,
				color: entry.color,
				d: splinePath(coords),
				last: coords[coords.length - 1],
				lastValue: entry.points[entry.points.length - 1]
			};
		});
		return { paths, max, min, maxLen };
	});
</script>

<div class="line-chart">
	{#if view === null}
		<div class="chart-empty" style="height: {height}px;">暂无数据</div>
	{:else}
		<div class="chart-body">
			<div class="chart-scale">
				<span>{format(view.max)}</span>
				<span>{format(view.min)}</span>
			</div>
			<svg
				viewBox="0 0 {VIEW_W} {height}"
				preserveAspectRatio="none"
				class="chart-svg"
				style="height: {height}px;"
				role="img"
				aria-label={series.map((entry) => entry.label).join('、')}
			>
				<line x1="0" y1={PAD_Y} x2={VIEW_W} y2={PAD_Y} class="grid" />
				<line x1="0" y1={height / 2} x2={VIEW_W} y2={height / 2} class="grid" />
				<line x1="0" y1={height - PAD_Y} x2={VIEW_W} y2={height - PAD_Y} class="grid" />
				{#each view.paths as path (path.label)}
					<path
						d={path.d}
						fill="none"
						stroke={path.color}
						stroke-width="2"
						stroke-linecap="round"
					/>
				{/each}
			</svg>
		</div>
		<div class="chart-legend">
			{#each view.paths as path (path.label)}
				<span class="legend-item">
					<span class="legend-dot" style="background: {path.color};"></span>
					{path.label}
					{#if path.lastValue !== undefined}
						<span class="legend-value">最新 {format(path.lastValue)}</span>
					{/if}
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.line-chart {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-faint);
		font-size: 13px;
		border: 1px dashed var(--border);
		border-radius: 8px;
	}
	/* 刻度列与图表同行排布（常规流式），不再绝对定位覆盖到卡片标题上。 */
	.chart-body {
		display: flex;
		align-items: stretch;
		gap: 8px;
	}
	.chart-scale {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-faint);
		text-align: right;
		min-width: 34px;
	}
	.chart-svg {
		flex: 1;
		min-width: 0;
		display: block;
	}
	.grid {
		stroke: var(--border);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		opacity: 0.7;
	}
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.legend-value {
		color: var(--text-faint);
	}
</style>
