<script lang="ts">
	import type { DemoTourStep } from '../workspace/demo';

	interface Props {
		steps: readonly DemoTourStep[];
		index: number;
		onNext: () => void;
		onPrev: () => void;
		onSkip: () => void;
	}

	let { steps, index, onNext, onPrev, onSkip }: Props = $props();

	interface Rect {
		left: number;
		top: number;
		width: number;
		height: number;
	}

	let rect = $state<Rect | null>(null);
	let card = $state({ left: 0, top: 0, width: 330 });
	const step = $derived(steps[index] ?? steps[0]!);
	const isLast = $derived(index >= steps.length - 1);

	/** 目标站定后把镜头框住它；元素尚未渲染时（如刚切到版本页）连续重试。 */
	$effect(() => {
		const current = steps[index] ?? steps[0]!;
		let scrolled = false;

		const measure = (): void => {
			const element = document.querySelector(current.target);
			const box = element?.getBoundingClientRect();
			if (box === undefined || box.width <= 0 || box.height <= 0) {
				return;
			}
			rect = { left: box.left, top: box.top, width: box.width, height: box.height };
			const width = window.innerWidth < 768 ? window.innerWidth - 32 : 336;
			const height = 214;
			let left = box.right + 22;
			let top = Math.max(16, Math.min(box.top, window.innerHeight - height - 16));
			if (window.innerWidth < 768) {
				left = 16;
				top = window.innerHeight - height - 20;
			} else if (left + width > window.innerWidth - 16) {
				left = box.left - width - 22;
				if (left < 16) {
					left = 16;
					top = box.bottom + 18;
					if (top + height > window.innerHeight - 16) {
						top = Math.max(16, box.top - height - 18);
					}
				}
			}
			card = { left, top, width };
			if (!scrolled) {
				// 目标可能是刚切出来的面板：只滚一次，避免反复打断用户。
				scrolled = true;
				element!.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
			}
		};

		measure();
		// 切标签后目标会挂载/挪位，持续跟踪一小段时间（导览期间常驻）。
		const timer = window.setInterval(measure, 220);
		window.addEventListener('resize', measure);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener('resize', measure);
		};
	});

	function handleKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onSkip();
		} else if (event.key === 'ArrowRight' || event.key === 'Enter') {
			onNext();
		} else if (event.key === 'ArrowLeft') {
			onPrev();
		}
	}
</script>

<svelte:window onkeydown={handleKey} />

<div class="tour" role="dialog" aria-label="功能导览">
	{#if rect !== null}
		<div
			class="lens"
			style="left: {rect.left - 8}px; top: {rect.top - 8}px; width: {rect.width + 16}px; height: {rect.height + 16}px;"
			aria-hidden="true"
		></div>
	{/if}

	<div class="tip" style="left: {card.left}px; top: {card.top}px; width: {card.width}px;">
		<div class="tip-head">
			<span class="kicker">{step.kicker}</span>
			<span class="count">{index + 1} / {steps.length}</span>
		</div>
		<h3>{step.title}</h3>
		<p>{step.text}</p>
		<div class="tip-foot">
			<div class="dots" aria-hidden="true">
				{#each steps as tourStep, dot (dot)}
					<span class:on={dot === index} title={tourStep.kicker}></span>
				{/each}
			</div>
			<div class="tip-actions">
				<button class="skip" onclick={onSkip}>跳过导览</button>
				{#if index > 0}
					<button class="ghost" onclick={onPrev}>上一步</button>
				{/if}
				<button class="primary" onclick={onNext}>{isLast ? '进入剧本' : '下一步'}</button>
			</div>
		</div>
	</div>
</div>

<style>
	.tour {
		position: fixed;
		inset: 0;
		z-index: 55;
		animation: tour-in 260ms ease-out both;
	}
	.lens {
		position: fixed;
		border: 1px solid rgba(60, 255, 208, 0.85);
		border-radius: 14px;
		box-shadow:
			0 0 0 9999px rgba(6, 8, 10, 0.66),
			0 0 28px rgba(60, 255, 208, 0.35),
			inset 0 0 18px rgba(60, 255, 208, 0.08);
		transition:
			left 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
			width 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
			height 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
		animation: lens-pop 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		pointer-events: none;
	}
	.lens::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: radial-gradient(circle at 50% 50%, rgba(60, 255, 208, 0.1), transparent 68%);
		animation: lens-breathe 2.6s ease-in-out infinite;
	}

	.tip {
		position: fixed;
		padding: 16px 18px 14px;
		border: 1px solid rgba(60, 255, 208, 0.26);
		border-radius: 14px;
		background: linear-gradient(160deg, rgba(26, 27, 31, 0.98), rgba(15, 16, 19, 0.98));
		box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
		transition:
			left 460ms cubic-bezier(0.2, 0.8, 0.2, 1),
			top 460ms cubic-bezier(0.2, 0.8, 0.2, 1);
		animation: tip-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.tip-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.kicker {
		color: var(--accent);
		font-size: 11px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.count {
		color: var(--text-faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	h3 {
		margin: 0 0 7px;
		font-size: 16px;
		font-weight: 650;
	}
	p {
		margin: 0 0 14px;
		color: var(--text-dim);
		font-size: 12.5px;
		line-height: 1.65;
	}
	.tip-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.dots {
		display: flex;
		gap: 5px;
	}
	.dots span {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.18);
		transition: background 180ms ease;
	}
	.dots span.on {
		background: var(--accent);
		box-shadow: 0 0 8px rgba(60, 255, 208, 0.6);
	}
	.tip-actions {
		display: flex;
		gap: 8px;
	}
	.primary,
	.ghost {
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 12px;
		transition:
			transform 150ms ease,
			border-color 150ms ease,
			box-shadow 150ms ease;
	}
	.primary {
		border: 0;
		background: var(--accent);
		color: #08201b;
		font-weight: 650;
	}
	.primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 22px rgba(60, 255, 208, 0.28);
	}
	.ghost {
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: transparent;
		color: var(--text-dim);
	}
	.ghost:hover {
		color: var(--text);
		border-color: rgba(255, 255, 255, 0.3);
	}
	.skip {
		padding: 4px 6px;
		border: 0;
		background: transparent;
		color: var(--text-faint);
		font-size: 11px;
	}
	.skip:hover {
		color: var(--text-dim);
	}

	@keyframes tour-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes lens-pop {
		from {
			transform: scale(1.12);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@keyframes lens-breathe {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}
	@keyframes tip-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (max-width: 768px) {
		.tip {
			left: 16px !important;
			width: calc(100vw - 32px) !important;
		}
		.tip-actions {
			gap: 6px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tour,
		.lens,
		.lens::after,
		.tip {
			animation: none !important;
			transition: none !important;
		}
	}
</style>