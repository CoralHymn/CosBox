<script lang="ts">
	import type { Toast } from '../stores/ui.svelte';

	interface Props {
		toasts: Toast[];
		onDismiss: (id: string) => void;
	}

	let { toasts, onDismiss }: Props = $props();
</script>

<div class="toasts">
	{#each toasts as toast (toast.id)}
		<div class="toast {toast.kind}">
			<span>{toast.message}</span>
			<button class="toast-close" onclick={() => onDismiss(toast.id)} aria-label="关闭">✕</button>
		</div>
	{/each}
</div>
