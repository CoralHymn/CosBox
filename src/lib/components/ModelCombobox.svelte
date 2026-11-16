<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	interface Props {
		/** 当前模型 id（受控：由父级持有并同步回写）。 */
		value: string;
		/** 候选模型列表（服务端拉取或预设建议）。 */
		candidates: string[];
		/** 输入框 id（供表单/e2e 定位）。 */
		inputId?: string;
		placeholder?: string;
		/** 输入或选中变化时回调（含手动输入的自定义模型）。 */
		onChange: (value: string) => void;
	}

	let {
		value,
		candidates,
		inputId = 'llm-model',
		placeholder = '模型 id',
		onChange
	}: Props = $props();
	let open = $state(false);
	let activeIndex = $state(0);
	/** 用户实际输入的过滤词；聚焦时清空 = 展示全部候选。 */
	let query = $state('');

	/** 按输入过滤候选；未输入时展示全部。 */
	const filtered = $derived(
		candidates.filter((candidate) => candidate.toLowerCase().includes(query.trim().toLowerCase()))
	);

	/** 候选变化时重置高亮。 */
	$effect(() => {
		void filtered;
		activeIndex = 0;
	});

	function openList(): void {
		if (candidates.length > 0) {
			// 当前值只是「已选中的模型」，聚焦时展示全部候选供选择。
			query = '';
			open = true;
			activeIndex = 0;
		}
	}

	function closeList(): void {
		open = false;
	}

	function select(candidate: string): void {
		onChange(candidate);
		open = false;
	}

	function onInput(event: Event): void {
		query = (event.currentTarget as HTMLInputElement).value;
		onChange(query);
		open = true;
		activeIndex = 0;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (filtered.length === 0) {
			if (event.key === 'ArrowDown' && candidates.length > 0) {
				event.preventDefault();
				open = true;
			}
			return;
		}
		if (!open) {
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = (activeIndex + 1) % filtered.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			select(filtered[activeIndex]!);
		} else if (event.key === 'Escape') {
			closeList();
		}
	}

	/** 点击输入框外部时收起下拉（延迟让 mousedown 选择优先）。 */
	function onBlur(): void {
		window.setTimeout(() => {
			open = false;
		}, 120);
	}
</script>

<div class="combobox">
	<input
		id={inputId}
		class="input combobox-input"
		{value}
		{placeholder}
		autocomplete="off"
		role="combobox"
		aria-controls="llm-model-listbox"
		aria-expanded={open}
		oninput={onInput}
		onfocus={openList}
		onkeydown={onKeydown}
		onblur={onBlur}
	/>
	<span class="combobox-caret" aria-hidden="true"><ChevronDown size={13} /></span>
	{#if open && filtered.length > 0}
		<div id="llm-model-listbox" class="combobox-popup" role="listbox">
			{#each filtered as candidate, i (candidate)}
				<button
					type="button"
					class="combobox-item"
					class:active={i === activeIndex}
					role="option"
					aria-selected={i === activeIndex}
					onmousedown={(event) => {
						event.preventDefault();
						select(candidate);
					}}
					onmouseenter={() => (activeIndex = i)}
				>
					{candidate}
				</button>
			{/each}
		</div>
	{/if}
</div>
