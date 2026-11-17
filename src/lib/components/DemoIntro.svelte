<script lang="ts">
	interface Props {
		onStart: () => void;
		onSkip: () => void;
	}

	let { onStart, onSkip }: Props = $props();

	const features = [
		{ title: '状态驱动', text: '时间、地点、穿着写进系统提示，模型不会演着演着忘设定' },
		{ title: '快照时间线', text: '每条消息与状态变更都是一个节点，可以回到任意一刻' },
		{ title: '长期记忆', text: '重要约定自动沉淀，压缩对话也不丢' }
	];
</script>

<div class="intro" role="dialog" aria-label="CosBox 演示介绍">
	<div class="grid" aria-hidden="true"></div>
	<div class="orb orb-a" aria-hidden="true"></div>
	<div class="orb orb-b" aria-hidden="true"></div>

	<div class="card">
		<p class="eyebrow">状态驱动的互动叙事 · 3 分钟演示</p>
		<h1 class="title" aria-label="CosBox">
			<span style="--i: 0">C</span><span style="--i: 1">o</span><span style="--i: 2">s</span
			><span class="accent" style="--i: 3">B</span><span style="--i: 4">o</span><span
				style="--i: 5">x</span
			>
		</h1>
		<p class="pitch">一个会记住角色此刻处境的叙事引擎</p>

		<ul class="features">
			{#each features as feature, index (feature.title)}
				<li style="--i: {index}">
					<span class="index">0{index + 1}</span>
					<div>
						<b>{feature.title}</b>
						<span>{feature.text}</span>
					</div>
				</li>
			{/each}
		</ul>

		<div class="actions">
			<button class="cta" onclick={onStart}>
				<span>开始 3 分钟体验</span>
				<span class="cta-arrow" aria-hidden="true">→</span>
			</button>
			<button class="ghost" onclick={onSkip}>先看看界面</button>
		</div>
		<p class="hint">无需登录 · 内置离线演示 · 本页不收集对话与密钥，数据只存在你的浏览器</p>
	</div>
</div>

<style>
	.intro {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 24px;
		background:
			radial-gradient(120% 90% at 18% 10%, rgba(82, 0, 255, 0.28), transparent 55%),
			radial-gradient(100% 80% at 82% 86%, rgba(60, 255, 208, 0.16), transparent 58%),
			rgba(10, 10, 12, 0.92);
		backdrop-filter: blur(14px);
		animation: intro-in 420ms ease-out both;
		overflow-y: auto;
	}

	.grid {
		position: absolute;
		inset: -30%;
		background-image:
			linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
			linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
		background-size: 46px 46px;
		transform: perspective(620px) rotateX(58deg) translateY(12%);
		transform-origin: center 70%;
		animation: grid-drift 18s linear infinite;
		opacity: 0.7;
	}

	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(48px);
		pointer-events: none;
	}
	.orb-a {
		width: 340px;
		height: 340px;
		left: 8%;
		top: 12%;
		background: rgba(82, 0, 255, 0.45);
		animation: float-a 9s ease-in-out infinite;
	}
	.orb-b {
		width: 280px;
		height: 280px;
		right: 9%;
		bottom: 10%;
		background: rgba(60, 255, 208, 0.28);
		animation: float-b 11s ease-in-out infinite;
	}

	.card {
		position: relative;
		width: min(620px, 100%);
		padding: 40px 40px 30px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 20px;
		background: linear-gradient(160deg, rgba(28, 28, 32, 0.94), rgba(15, 15, 18, 0.96));
		box-shadow:
			0 30px 90px rgba(0, 0, 0, 0.6),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		max-height: calc(100vh - 32px);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		animation: card-in 620ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	.eyebrow {
		margin: 0 0 18px;
		color: var(--text-dim);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		animation: rise 500ms 120ms ease-out both;
	}

	.title {
		display: flex;
		gap: 2px;
		margin: 0;
		font-size: clamp(46px, 9vw, 68px);
		line-height: 1;
		letter-spacing: -0.04em;
		font-weight: 750;
	}
	.title span {
		display: inline-block;
		animation: letter-in 620ms calc(180ms + var(--i) * 55ms) cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.title .accent {
		color: var(--accent);
		text-shadow: 0 0 34px rgba(60, 255, 208, 0.35);
	}

	.pitch {
		margin: 14px 0 26px;
		color: var(--text-dim);
		font-size: 16px;
		animation: rise 520ms 320ms ease-out both;
	}

	.features {
		display: grid;
		gap: 10px;
		margin: 0 0 30px;
		padding: 0;
		list-style: none;
	}
	.features li {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		padding: 12px 14px;
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.025);
		animation: rise 520ms calc(420ms + var(--i) * 90ms) ease-out both;
	}
	.features .index {
		color: var(--accent);
		font-size: 11px;
		letter-spacing: 0.08em;
		padding-top: 2px;
	}
	.features b {
		display: block;
		margin-bottom: 3px;
		font-size: 14px;
		font-weight: 600;
	}
	.features span:not(.index) {
		color: var(--text-dim);
		font-size: 13px;
		line-height: 1.5;
	}

	.actions {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		animation: rise 520ms 420ms ease-out both;
	}

	.cta {
		position: relative;
		display: inline-flex;
		gap: 10px;
		align-items: center;
		padding: 12px 22px;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #08201b;
		font-weight: 650;
		font-size: 14px;
		overflow: hidden;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease;
		box-shadow: 0 0 0 0 rgba(60, 255, 208, 0.35);
	}
	.cta::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.55), transparent 70%);
		transform: translateX(-120%);
		animation: sheen 3.6s 1.4s ease-in-out infinite;
	}
	.cta:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 28px rgba(60, 255, 208, 0.28);
	}
	.cta-arrow {
		transition: transform 160ms ease;
	}
	.cta:hover .cta-arrow {
		transform: translateX(3px);
	}

	.ghost {
		padding: 11px 16px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		transition:
			color 160ms ease,
			border-color 160ms ease;
	}
	.ghost:hover {
		color: var(--text);
		border-color: rgba(255, 255, 255, 0.26);
	}

	.hint {
		margin: 18px 0 0;
		color: var(--text-faint);
		font-size: 12px;
		animation: rise 500ms 560ms ease-out both;
	}

	@keyframes intro-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(18px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes letter-in {
		from {
			opacity: 0;
			transform: translateY(26px) rotate(4deg);
			filter: blur(8px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: blur(0);
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes grid-drift {
		from {
			background-position:
				0 0,
				0 0;
		}
		to {
			background-position:
				0 460px,
				460px 0;
		}
	}
	@keyframes float-a {
		0%,
		100% {
			transform: translate3d(0, 0, 0) scale(1);
		}
		50% {
			transform: translate3d(26px, -18px, 0) scale(1.06);
		}
	}
	@keyframes float-b {
		0%,
		100% {
			transform: translate3d(0, 0, 0) scale(1);
		}
		50% {
			transform: translate3d(-22px, 16px, 0) scale(1.06);
		}
	}
	@keyframes sheen {
		0%,
		55% {
			transform: translateX(-120%);
		}
		72%,
		100% {
			transform: translateX(120%);
		}
	}

	@media (max-width: 620px) {
		.card {
			padding: 26px 20px 22px;
		}
		.features li {
			padding: 10px 12px;
		}
		.actions {
			gap: 10px;
		}
		.cta {
			width: 100%;
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.intro,
		.card,
		.title span,
		.eyebrow,
		.pitch,
		.features li,
		.actions,
		.hint,
		.grid,
		.orb,
		.cta::after {
			animation: none !important;
		}
	}
</style>
