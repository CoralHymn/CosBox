<script lang="ts">
	interface Props {
		disabled: boolean;
		onSend: (content: string) => void;
	}

	let { disabled, onSend }: Props = $props();
	let text = $state('');

	function submit(): void {
		const value = text.trim();
		if (value === '' || disabled) {
			return;
		}
		onSend(value);
		text = '';
	}
</script>

<div class="composer">
	<textarea
		class="textarea"
		placeholder="输入消息，Enter 发送，Shift+Enter 换行"
		bind:value={text}
		onkeydown={(event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				submit();
			}
		}}
	></textarea>
	<button class="btn btn-primary" onclick={submit} disabled={disabled || text.trim() === ''}>发送</button>
</div>
