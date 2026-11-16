<script lang="ts">
	import { X } from '@lucide/svelte';
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
			<button class="toast-close" onclick={() => onDismiss(toast.id)} aria-label="关闭">
				<X size={13} />
			</button>
		</div>
	{/each}
</div>
