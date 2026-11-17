<script lang="ts">
	import { wardrobeItemsForSlot } from '../context/state-summary';
	import type { ClothingItem, OutfitSlot } from '../core/types';
	import { getEditionRules, isWardrobeItemHidden } from '../platform/edition';

	interface Props {
		/** 输入框 id 前缀（同一页面多个 picker 时保持唯一）。 */
		idPrefix: string;
		label: string;
		/** 槽位类型：候选衣柜条目按此过滤，防止衣物错配到不合适的部位。 */
		slot: OutfitSlot;
		value: string;
		wardrobe: ClothingItem[];
		onCommit: (value: string | null) => void;
	}

	let { idPrefix, label, slot, value, wardrobe, onCommit }: Props = $props();
	let customText = $state('');
	let customMode = $state(false);

	const rules = getEditionRules();
	const candidates = $derived(
		wardrobeItemsForSlot(wardrobe, slot).filter((item) => !isWardrobeItemHidden(item, rules))
	);
	const selectedItem = $derived(candidates.find((item) => item.name === value) ?? null);
	const selectId = $derived(`${idPrefix}-${slot}`);
	const customId = $derived(`${idPrefix}-${slot}-custom`);

	function handleSelect(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value;
		if (next === 'custom') {
			customMode = true;
			customText = value;
			return;
		}
		customMode = false;
		onCommit(next === '' ? null : next);
	}

	function commitCustom(): void {
		const trimmed = customText.trim();
		customMode = false;
		onCommit(trimmed === '' ? null : trimmed);
	}
</script>

<div class="field">
	<label for={selectId}>{label}</label>
	<select
		id={selectId}
		class="select"
		value={selectedItem ? value : value === '' ? '' : 'custom'}
		onchange={handleSelect}
	>
		<option value="">（未穿）</option>
		{#each candidates as item (item.id)}
			<option value={item.name}>{item.name}</option>
		{/each}
		<option value="custom">自定义…</option>
	</select>
	{#if customMode || (value !== '' && selectedItem === null)}
		<div style="display: flex; gap: 6px; margin-top: 6px;">
			<input id={customId} class="input" bind:value={customText} placeholder="自定义名称" />
			<button class="btn btn-small" onclick={commitCustom}>确定</button>
		</div>
	{/if}
	{#if selectedItem !== null && selectedItem.description !== ''}
		<p class="muted" style="margin-top: 4px;">{selectedItem.description}</p>
	{/if}
</div>
