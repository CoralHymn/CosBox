<script lang="ts">
	import { describeCurrentActivity, formatWorldTime } from '../core/state';
	import { formatAttributes, formatOutfit, summarizeSchedule } from '../context/state-summary';
	import type { CharacterState } from '../core/types';
	import { getEditionRules, stateSummaryOptionsFor } from '../platform/edition';

	interface Props {
		characterState: CharacterState;
	}

	let { characterState }: Props = $props();

	/** 预览与系统提示使用同一套版本规则，Web 版不显示私密槽位。 */
	const summaryOptions = stateSummaryOptionsFor(getEditionRules());
</script>

<div class="state-preview">
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
