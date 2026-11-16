<script lang="ts">
	import { ICONS, type IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 16 }: Props = $props();

	const IconComponent = $derived(ICONS[name]);
</script>

<IconComponent class="icon" {size} />