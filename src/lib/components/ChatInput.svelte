<script lang="ts">
	import type { ClothingItem, LocationDef } from '../core/types';
	import { buildAutocompleteSuggestions } from '../utils/autocomplete';

	interface Props {
		disabled: boolean;
		searchSupported: boolean;
		searching: boolean;
		/** 地点库：/goto 补全数据源。 */
		places: LocationDef[];
		/** 衣柜：/wear 补全数据源。 */
		wardrobe: ClothingItem[];
		onSend: (content: string, options: { search: boolean }) => void;
	}

	let { disabled, searchSupported, searching, places, wardrobe, onSend }: Props = $props();
	let text = $state('');
	let search = $state(false);
	let activeIndex = $state(0);
	let dismissed = $state(false);
	let inputEl = $state<HTMLTextAreaElement | null>(null);

	const suggestions = $derived(buildAutocompleteSuggestions(text, places, wardrobe));
	const popupVisible = $derived(suggestions.length > 0 && !dismissed);

	/** 建议列表变化时把选中项复位到第一项。 */
	$effect(() => {
		void suggestions;
		activeIndex = 0;
	});

	function acceptSuggestion(index: number): void {
		const suggestion = suggestions[index];
		if (suggestion === undefined) {
			return;
		}
		const lastSpace = text.lastIndexOf(' ');
		const prefix = lastSpace === -1 ? '' : text.slice(0, lastSpace + 1);
		text = prefix + suggestion.insert;
		if (suggestion.keepOpen !== true) {
			dismissed = true;
		}
		activeIndex = 0;
		inputEl?.focus();
	}

	function submit(): void {
		const value = text.trim();
		if (value === '' || disabled) {
			return;
		}
		onSend(value, { search });
		text = '';
		search = false;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (popupVisible) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				activeIndex = (activeIndex + 1) % suggestions.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				acceptSuggestion(activeIndex);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				dismissed = true;
				return;
			}
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	}

	function toggleSearch(): void {
		if (searchSupported) {
			search = !search;
		}
	}
</script>

<div class="composer">
	{#if popupVisible}
		<div class="suggest-popup" role="listbox" aria-label="快捷命令补全">
			{#each suggestions as suggestion, i (suggestion.insert + suggestion.label)}
				<button
					type="button"
					class="suggest-item"
					class:active={i === activeIndex}
					role="option"
					aria-selected={i === activeIndex}
					onmousedown={(event) => {
						event.preventDefault();
						acceptSuggestion(i);
					}}
				>
					<span class="suggest-label">{suggestion.label}</span>
					{#if suggestion.detail !== undefined}
						<span class="muted suggest-detail">{suggestion.detail}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
	<textarea
		class="textarea"
		bind:this={inputEl}
		placeholder="输入消息；或输入 / 使用快捷命令，Enter 发送，Shift+Enter 换行"
		bind:value={text}
		onkeydown={onKeydown}
		oninput={() => {
			dismissed = false;
		}}
		onblur={() => {
			dismissed = true;
		}}></textarea>
	{#if searchSupported}
		<button
			class="btn"
			class:active={search}
			title="发送时附带网络搜索"
			onclick={toggleSearch}
			disabled={searching}
			aria-pressed={search}
			aria-label="网络搜索"
		>
			{searching ? '…' : '🔍'}
		</button>
	{/if}
	<button class="btn btn-primary" onclick={submit} disabled={disabled || text.trim() === ''}
		>发送</button
	>
</div>
