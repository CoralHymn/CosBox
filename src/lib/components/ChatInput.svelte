<script lang="ts">
	interface Props {
		disabled: boolean;
		searchSupported: boolean;
		searching: boolean;
		onSend: (content: string, options: { search: boolean }) => void;
	}

	let { disabled, searchSupported, searching, onSend }: Props = $props();
	let text = $state('');
	let search = $state(false);

	function submit(): void {
		const value = text.trim();
		if (value === '' || disabled) {
			return;
		}
		onSend(value, { search });
		text = '';
		search = false;
	}

	function toggleSearch(): void {
		if (searchSupported) {
			search = !search;
		}
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
		}}></textarea>
	<button
		class="btn"
		class:active={search}
		title={searchSupported ? '发送时附带网络搜索' : '需在设置中启用并配置搜索 API Key'}
		onclick={toggleSearch}
		disabled={!searchSupported || searching}
		aria-pressed={search}
		aria-label="网络搜索"
	>
		{searching ? '…' : '🔍'}
	</button>
	<button class="btn btn-primary" onclick={submit} disabled={disabled || text.trim() === ''}
		>发送</button
	>
</div>
