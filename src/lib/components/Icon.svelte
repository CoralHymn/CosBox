<script lang="ts">
	import { ICON_PATHS, type IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 16 }: Props = $props();
</script>

<!-- 内联 SVG 图标：Lucide 风格描边，颜色随当前文字色（stroke=currentColor）。 -->
<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<!-- 路径来自常量表（icons.ts），无用户输入，禁用 XSS 告警。 -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html ICON_PATHS[name]}
</svg>
