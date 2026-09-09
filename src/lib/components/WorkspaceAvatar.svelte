<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';

	interface Props {
		meta: Pick<WorkspaceMeta, 'name' | 'avatar'>;
		/** 方形头像边长（px）。 */
		size?: number;
	}

	let { meta, size = 40 }: Props = $props();

	/** 未配置头像时的兜底色板（按名称哈希取色）。 */
	const FALLBACK_COLORS = [
		'#6d8dff',
		'#c98a4b',
		'#4ade80',
		'#f472b6',
		'#a78bfa',
		'#38bdf8',
		'#f97316',
		'#5a6478'
	];

	function fallbackColor(name: string): string {
		let hash = 0;
		for (const char of name) {
			hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
		}
		return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
	}

	const glyph = $derived(
		meta.avatar?.kind === 'glyph' ? meta.avatar.glyph : ([...meta.name][0] ?? '工')
	);
	const color = $derived(
		meta.avatar?.kind === 'glyph' ? meta.avatar.color : fallbackColor(meta.name)
	);
	const image = $derived(meta.avatar?.kind === 'image' ? meta.avatar.image : null);
</script>

<span
	class="ws-avatar"
	style={`width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.44)}px`}
>
	{#if image !== null}
		<img src={image} alt="" />
	{:else}
		{glyph}
	{/if}
</span>

<style>
	.ws-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border-radius: 22%;
		color: #fff;
		font-weight: 700;
		overflow: hidden;
		user-select: none;
	}
	.ws-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>
