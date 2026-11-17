<script lang="ts">
	interface Props {
		rolledBack: boolean;
		canRollback: boolean;
		onRollback: () => void;
		onContinue: () => void;
		onOwnStory: () => void;
	}

	let { rolledBack, canRollback, onRollback, onContinue, onOwnStory }: Props = $props();
</script>

<div class="cue" class:rolled-back={rolledBack}>
	<div class="cue-glow" aria-hidden="true"></div>
	<div class="cue-body">
		<p class="eyebrow">{rolledBack ? '时间线已回退' : '这就是版本树'}</p>
		<h3>{rolledBack ? '已经回到换装前' : '刚才的每一步，都在这条时间线上'}</h3>
		<p>
			{rolledBack
				? '聊天、地点、时间和穿着一起退回了。版本页不是只读历史，任意节点都可以切过去。'
				: '消息与状态变更都是节点。回到「换装前」试试——聊天会缩短，状态也会跟着退回去。'}
		</p>
		<div class="cue-actions">
			{#if !rolledBack && canRollback}
				<button class="primary" onclick={onRollback}>
					<span>回到换装前</span>
					<span class="arrow" aria-hidden="true">↩</span>
				</button>
			{/if}
			<button class="ghost" onclick={onContinue}>继续体验</button>
			<button class="ghost" onclick={onOwnStory}>写我自己的故事</button>
		</div>
	</div>
	<div class="timeline" aria-hidden="true">
		{#each Array(8) as _, index (index)}
			<span style="--i: {index}" class:on={index < 6}></span>
		{/each}
	</div>
</div>

<style>
	.cue {
		position: relative;
		display: flex;
		align-items: center;
		gap: 22px;
		margin: 0 18px 12px;
		padding: 16px 18px;
		border: 1px solid rgba(60, 255, 208, 0.28);
		border-radius: 14px;
		background:
			linear-gradient(140deg, rgba(60, 255, 208, 0.08), rgba(82, 0, 255, 0.07)),
			rgba(20, 20, 23, 0.94);
		overflow: hidden;
		animation: cue-in 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.cue.rolled-back {
		border-color: rgba(82, 0, 255, 0.45);
		animation:
			cue-in 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
			cue-glow 2.6s ease-in-out infinite;
	}
	.cue-glow {
		position: absolute;
		width: 220px;
		height: 220px;
		left: -80px;
		top: -110px;
		border-radius: 50%;
		background: rgba(60, 255, 208, 0.16);
		filter: blur(50px);
		animation: drift 7s ease-in-out infinite;
	}
	.cue-body {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.eyebrow {
		margin: 0 0 6px;
		color: var(--accent);
		font-size: 11px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 16px;
		font-weight: 650;
	}
	p {
		max-width: 620px;
		margin: 0;
		color: var(--text-dim);
		font-size: 12.5px;
		line-height: 1.6;
	}
	.cue-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 12px;
	}
	.primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 7px 15px;
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
		box-shadow: 0 8px 24px rgba(60, 255, 208, 0.26);
	}
	.arrow {
		font-size: 13px;
	}
	.ghost {
		padding: 6px 13px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		background: transparent;
		color: var(--text-dim);
		font-size: 12px;
		transition:
			color 160ms ease,
			border-color 160ms ease;
	}
	.ghost:hover {
		color: var(--text);
		border-color: rgba(255, 255, 255, 0.28);
	}

	.timeline {
		position: relative;
		display: flex;
		align-items: center;
		gap: 14px;
		padding-right: 4px;
	}
	.timeline span {
		position: relative;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.16);
		animation: node-in 360ms calc(220ms + var(--i) * 55ms) ease-out both;
	}
	.timeline span.on {
		background: var(--accent);
		box-shadow: 0 0 12px rgba(60, 255, 208, 0.6);
	}
	.timeline span:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 12px;
		top: 4px;
		width: 14px;
		height: 1px;
		background: rgba(255, 255, 255, 0.14);
	}

	@keyframes cue-in {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes cue-glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(82, 0, 255, 0);
		}
		50% {
			box-shadow: 0 0 30px 0 rgba(82, 0, 255, 0.18);
		}
	}
	@keyframes node-in {
		from {
			opacity: 0;
			transform: scale(0.4);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes drift {
		0%,
		100% {
			transform: translate3d(0, 0, 0);
		}
		50% {
			transform: translate3d(18px, 10px, 0);
		}
	}

	@media (max-width: 768px) {
		.cue {
			margin: 0 10px 10px;
			padding: 14px;
			align-items: flex-start;
		}
		.timeline {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cue,
		.cue.rolled-back,
		.cue-glow,
		.timeline span {
			animation: none !important;
		}
	}
</style>
