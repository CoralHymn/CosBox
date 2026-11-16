<script lang="ts">
	import { X } from '@lucide/svelte';
	import { wardrobeItemsForSlot } from '../context/state-summary';
	import type { ClothingItem } from '../core/types';

	interface Props {
		/** 输入框 id 前缀（同一页面多个 picker 时保持唯一）。 */
		idPrefix: string;
		label: string;
		/** 当前已佩戴的配饰名称列表。 */
		value: string[];
		/** 衣柜：候选按 kind=配饰（含 any/未标注）过滤。 */
		wardrobe: ClothingItem[];
		/** 变更时回调完整配饰列表（整体替换语义）。 */
		onCommit: (value: string[]) => void;
	}

	let { idPrefix, label, value, wardrobe, onCommit }: Props = $props();
	let customText = $state('');
	let adding = $state(false);
	let selected = $state('');

	const candidates = $derived(
		wardrobeItemsForSlot(wardrobe, 'accessory').filter((item) => !value.includes(item.name))
	);
	const selectId = $derived(`${idPrefix}-accessories`);
	const customId = $derived(`${idPrefix}-accessories-custom`);

	function addCandidate(): void {
		const name = selected;
		selected = '';
		if (name === '') {
			return;
		}
		onCommit([...value, name]);
	}

	function removeItem(name: string): void {
		onCommit(value.filter((item) => item !== name));
	}

	function addCustom(): void {
		const name = customText.trim();
		if (name === '') {
			return;
		}
		onCommit(value.includes(name) ? value : [...value, name]);
		customText = '';
		adding = false;
	}
</script>

<div class="field">
	<label for={selectId}>{label}</label>
	{#if value.length === 0}
		<p class="muted" style="margin: 0 0 6px;">（未佩戴）</p>
	{/if}
	{#if value.length > 0}
		<div class="chips" role="list" aria-label={`已佩戴的${label}`}>
			{#each value as name (name)}
				<span class="chip" role="listitem">
					{name}
					<button
						class="chip-x"
						aria-label={`移除配饰 ${name}`}
						onclick={() => removeItem(name)}
					>
						<X size={11} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
	<div class="accessory-actions">
		<select id={selectId} class="select" bind:value={selected} onchange={addCandidate}>
			<option value="">从衣柜添加…</option>
			{#each candidates as item (item.id)}
				<option value={item.name}
					>{item.category === '' ? item.name : `${item.category} > ${item.name}`}</option
				>
			{/each}
		</select>
		{#if adding}
			<input
				id={customId}
				class="input"
				bind:value={customText}
				placeholder="自定义配饰名"
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						addCustom();
					}
				}}
			/>
			<button class="btn btn-small" onclick={addCustom}>添加</button>
		{:else}
			<button class="btn btn-small" onclick={() => (adding = true)}>自定义…</button>
		{/if}
	</div>
</div>
