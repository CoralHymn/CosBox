<script lang="ts">
	import type { DemoDockModel } from '../workspace/demo';

	interface Props {
		model: DemoDockModel;
	}

	let { model }: Props = $props();

	const total = $derived(model.chips.length);
	const doneCount = $derived(model.done.filter(Boolean).length);
	const progress = $derived(total === 0 ? 0 : Math.round((doneCount / total) * 100));
</script>

<div class="dock" class:done={model.completed}>
	<div class="dock-head">
		<div class="brand">
			<span class="pulse" aria-hidden="true"></span>
			<span class="label">演示剧本</span>
			<span class="sep">·</span>
			<span class="scene">校庆前夜</span>
		</div>
		<div class="head-right">
			<span class="counter">{doneCount} / {total}</span>
			<button class="skip" onclick={model.onSkip} aria-label="跳过演示">跳过</button>
		</div>
	</div>

	<div class="rail" aria-hidden="true">
		<span class="rail-fill" style="width: {progress}%"></span>
	</div>

	{#if model.note !== ''}
		{#key model.note}
			<p class="note">
				<span class="note-dot" aria-hidden="true"></span>
				{model.note}
			</p>
		{/key}
	{/if}

	{#if !model.completed}
		<div class="chips">
			{#each model.chips as chip, index (chip.text)}
				{@const isDone = model.done[index] === true}
				{@const isActive = index === model.activeIndex}
				<button
					class="chip"
					class:done={isDone}
					class:active={isActive}
					disabled={model.busy || isDone}
					style="--i: {index}"
					onclick={() => model.onPick(chip.text)}
				>
					{#if isDone}
						<span class="check" aria-hidden="true">✓</span>
					{:else}
						<span class="step-index" aria-hidden="true">{index + 1}</span>
					{/if}
					<span>{chip.label}</span>
				</button>
			{/each}
		</div>

		<div class="actions">
			{#if model.autoRunning}
				<button class="auto stop" onclick={model.onStopAuto}>
					<span class="rec" aria-hidden="true"></span>停止自动演示
				</button>
			{:else}
				<button class="auto" onclick={model.onAuto} disabled={model.busy}>
					<span class="play" aria-hidden="true">▶</span>自动演示（约 20 秒）
				</button>
			{/if}
			<span class="tip">点一句试试，状态会跟着变</span>
		</div>
	{:else}
		<div class="finish">
			<p class="finish-title">四步走完，时间线上已经留下 8 个节点</p>
			<div class="actions">
				<button class="primary" onclick={model.onVersions}>
					<span>看时间线 / 回到换装前</span>
					<span aria-hidden="true">→</span>
				</button>
				<button class="auto" onclick={model.onOwnStory}>写我自己的故事</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.dock {
		position: relative;
		margin: 0 18px 10px;
		padding: 13px 15px 12px;
		border: 1px solid rgba(60, 255, 208, 0.22);
		border-radius: 14px;
		background:
			linear-gradient(150deg, rgba(60, 255, 208, 0.07), rgba(82, 0, 255, 0.06)),
			rgba(20, 20, 23, 0.92);
		box-shadow:
			0 10px 36px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		animation: dock-in 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		overflow: hidden;
	}
	.dock::before {
		content: '';
		position: absolute;
		inset: -40% -10% auto;
		height: 160%;
		background: conic-gradient(from 180deg, transparent, rgba(60, 255, 208, 0.08), transparent 40%);
		animation: sweep 8s linear infinite;
		pointer-events: none;
	}
	.dock.done {
		border-color: rgba(60, 255, 208, 0.42);
		animation: dock-in 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both, glow 2.4s ease-in-out infinite;
	}

	.dock-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		letter-spacing: 0.04em;
	}
	.label {
		color: var(--accent);
		font-weight: 600;
	}
	.sep,
	.scene {
		color: var(--text-dim);
	}
	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 0 rgba(60, 255, 208, 0.5);
		animation: ping 2s ease-out infinite;
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.counter {
		color: var(--text-faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.skip {
		padding: 3px 8px;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--text-faint);
		font-size: 11px;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}
	.skip:hover {
		color: var(--text-dim);
		border-color: rgba(255, 255, 255, 0.12);
	}

	.rail {
		position: relative;
		height: 2px;
		margin: 10px 0 0;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}
	.rail-fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--accent), #8ef7e2);
		box-shadow: 0 0 12px rgba(60, 255, 208, 0.5);
		transition: width 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 10px 0 0;
		color: var(--text-dim);
		font-size: 12px;
		animation: note-in 360ms ease-out both;
	}
	.note-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 10px rgba(60, 255, 208, 0.7);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 11px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 12px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.04);
		color: var(--text);
		font-size: 12.5px;
		transition:
			transform 160ms ease,
			border-color 160ms ease,
			background 160ms ease;
		animation: chip-in 420ms calc(120ms + var(--i) * 70ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.chip:hover:not(:disabled) {
		transform: translateY(-2px);
		border-color: rgba(60, 255, 208, 0.5);
		background: rgba(60, 255, 208, 0.1);
	}
	.chip.active {
		border-color: rgba(60, 255, 208, 0.65);
		background: rgba(60, 255, 208, 0.12);
		animation:
			chip-in 420ms calc(120ms + var(--i) * 70ms) cubic-bezier(0.2, 0.8, 0.2, 1) both,
			chip-pulse 2s 900ms ease-out infinite;
	}
	.chip.done {
		opacity: 0.48;
		color: var(--text-dim);
	}
	.step-index {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-dim);
		font-size: 10px;
	}
	.chip.active .step-index {
		background: var(--accent);
		color: #08201b;
		font-weight: 700;
	}
	.check {
		color: var(--accent);
		font-size: 11px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 11px;
	}
	.auto {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 6px 12px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: transparent;
		color: var(--text-dim);
		font-size: 12px;
		transition:
			color 160ms ease,
			border-color 160ms ease;
	}
	.auto:hover:not(:disabled) {
		color: var(--text);
		border-color: rgba(255, 255, 255, 0.28);
	}
	.auto.stop {
		color: var(--err);
		border-color: rgba(255, 93, 93, 0.4);
	}
	.play {
		font-size: 9px;
		color: var(--accent);
	}
	.rec {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--err);
		animation: blink 1s steps(2, end) infinite;
	}
	.tip {
		color: var(--text-faint);
		font-size: 11px;
	}

	.finish-title {
		margin: 11px 0 0;
		color: var(--text);
		font-size: 13px;
	}
	.primary {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #08201b;
		font-size: 12.5px;
		font-weight: 650;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease;
	}
	.primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 24px rgba(60, 255, 208, 0.25);
	}

	@keyframes dock-in {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes chip-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes note-in {
		from {
			opacity: 0;
			transform: translateX(-6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes ping {
		0% {
			box-shadow: 0 0 0 0 rgba(60, 255, 208, 0.5);
		}
		70% {
			box-shadow: 0 0 0 7px rgba(60, 255, 208, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(60, 255, 208, 0);
		}
	}
	@keyframes chip-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(60, 255, 208, 0.32);
		}
		60% {
			box-shadow: 0 0 0 8px rgba(60, 255, 208, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(60, 255, 208, 0);
		}
	}
	@keyframes glow {
		0%,
		100% {
			box-shadow:
				0 10px 36px rgba(0, 0, 0, 0.35),
				0 0 0 0 rgba(60, 255, 208, 0);
		}
		50% {
			box-shadow:
				0 10px 36px rgba(0, 0, 0, 0.35),
				0 0 26px 0 rgba(60, 255, 208, 0.16);
		}
	}
	@keyframes sweep {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes blink {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0.25;
		}
	}

	@media (max-width: 768px) {
		.dock {
			margin: 0 10px 8px;
			padding: 12px 12px 11px;
		}
		.tip {
			display: none;
		}
		.chip {
			padding: 7px 11px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dock,
		.dock.done,
		.chip,
		.chip.active,
		.note,
		.pulse,
		.rec,
		.dock::before {
			animation: none !important;
		}
		.rail-fill {
			transition: none;
		}
	}
</style>
