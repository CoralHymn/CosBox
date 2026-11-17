<script lang="ts">
	import { LoaderCircle, Search, Square } from '@lucide/svelte';
	import type { ClothingItem, LocationDef } from '../core/types';
	import { getEditionRules } from '../platform/edition';
	import { buildAutocompleteSuggestions } from '../utils/autocomplete';

	interface Props {
		disabled: boolean;
		/** 正在生成：发送按钮变为「停止」，点击打断 AI 思考/输出。 */
		busy: boolean;
		searchSupported: boolean;
		searching: boolean;
		/** 地点库：/goto 补全数据源。 */
		places: LocationDef[];
		/** 衣柜：/wear 补全数据源。 */
		wardrobe: ClothingItem[];
		/** 输入框内容变化回调（供开发者预览使用）。 */
		onTextChange?: (text: string) => void;
		onSend: (content: string, options: { search: boolean }) => void;
		onStop: () => void;
	}

	let { disabled, busy, searchSupported, searching, places, wardrobe, onTextChange, onSend, onStop }:
		Props = $props();
	let text = $state('');
	let search = $state(false);
	let activeIndex = $state(0);
	let dismissed = $state(false);
	let inputEl = $state<HTMLTextAreaElement | null>(null);

	const suggestions = $derived(
		buildAutocompleteSuggestions(text, places, wardrobe, getEditionRules())
	);
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
		oninput={(event) => {
			dismissed = false;
			onTextChange?.((event.currentTarget as HTMLTextAreaElement).value);
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
			{#if searching}
				<span class="spin"><LoaderCircle size={16} /></span>
			{:else}
				<Search size={16} />
			{/if}
		</button>
	{/if}
	{#if busy}
		<button class="btn btn-primary btn-stop" onclick={onStop} aria-label="停止生成" title="停止生成">
			<Square size={12} fill="currentColor" strokeWidth={0} /> 停止
		</button>
	{:else}
		<button class="btn btn-primary" onclick={submit} disabled={disabled || text.trim() === ''}>
			发送
		</button>
	{/if}
</div>

<style>
	.spin {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
