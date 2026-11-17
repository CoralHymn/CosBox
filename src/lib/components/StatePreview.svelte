<script lang="ts">
	import { describeCurrentActivity, formatWorldTime } from '../core/state';
	import { formatAttributes, formatOutfit, summarizeSchedule } from '../context/state-summary';
	import type { CharacterState } from '../core/types';
	import { getEditionRules, stateSummaryOptionsFor } from '../platform/edition';

	interface Props {
		characterState: CharacterState;
		/** 演示脉冲：每次状态变化递增，重播一次高亮。 */
		pulse?: number;
	}

	let { characterState, pulse = 0 }: Props = $props();

	/** 预览与系统提示使用同一套版本规则，Web 版不显示私密槽位。 */
	const summaryOptions = stateSummaryOptionsFor(getEditionRules());
</script>

<div class="state-preview" class:pulsing={pulse > 0} data-demo-tour="state">
	{#key pulse}
		<span class="pulse-flash" aria-hidden="true"></span>
	{/key}
	<p class="card-title">实时状态预览</p>
	<p class="preview-line">
		<span class="k">时间</span><span
			>{formatWorldTime(characterState.schedule.time)}（{describeCurrentActivity(
				characterState.schedule
			)}）</span
		>
	</p>
	<p class="preview-line">
		<span class="k">地点</span><span
			>{characterState.location.category
				? `${characterState.location.category} > ${characterState.location.name}`
				: characterState.location.name}</span
		>
	</p>
	<p class="preview-line">
		<span class="k">穿着</span><span>{formatOutfit(characterState.outfit, summaryOptions)}</span>
	</p>
	<p class="preview-line">
		<span class="k">属性</span><span>{formatAttributes(characterState.attributes)}</span>
	</p>
	<p class="preview-line">
		<span class="k">日程</span><span>{summarizeSchedule(characterState.schedule)}</span>
	</p>
</div>

<style>
	.state-preview {
		position: relative;
	}
	.pulse-flash {
		position: absolute;
		inset: -8px -10px;
		border-radius: 12px;
		pointer-events: none;
		animation: state-flash 900ms ease-out both;
	}
	@keyframes state-flash {
		0% {
			background: rgba(60, 255, 208, 0.16);
			box-shadow: 0 0 0 1px rgba(60, 255, 208, 0.55);
			opacity: 0;
		}
		22% {
			opacity: 1;
		}
		100% {
			background: transparent;
			box-shadow: 0 0 0 1px rgba(60, 255, 208, 0);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse-flash {
			animation: none;
		}
	}
</style>
