<script lang="ts">
	import type { AttributeValue, CharacterState, OutfitSlot, StatePatch } from '../core/types';
	import AccessoryPicker from './AccessoryPicker.svelte';
	import OutfitSlotPicker from './OutfitSlotPicker.svelte';

	interface AttributeRow {
		key: string;
		value: string;
	}

	interface Props {
		characterState: CharacterState;
		onUpdate: (patch: StatePatch, desc: string) => void;
	}

	let { characterState, onUpdate }: Props = $props();

	const slots: { key: OutfitSlot; label: string }[] = [
		{ key: 'headwear', label: '帽子' },
		{ key: 'top', label: '上衣' },
		{ key: 'underwear', label: '内衣' },
		{ key: 'underpants', label: '内裤' },
		{ key: 'bottom', label: '下装' },
		{ key: 'socks', label: '袜子' },
		{ key: 'shoes', label: '鞋' }
	];

	// attrs 同时被用户编辑与外部状态同步，不能改写成只读 derived。
	// eslint-disable-next-line svelte/prefer-writable-derived
	let attrs = $state<AttributeRow[]>([]);

	$effect(() => {
		attrs = Object.entries(characterState.attributes).map(([key, value]) => ({
			key,
			value: String(value)
		}));
	});

	function commitSlot(slot: OutfitSlot, value: string | null): void {
		const patch: Partial<typeof characterState.outfit> = {};
		patch[slot] = value;
		onUpdate({ outfit: patch }, '更新穿着');
	}

	function parseAttribute(raw: string): AttributeValue | undefined {
		const trimmed = raw.trim();
		if (trimmed === '') {
			return undefined;
		}
		if (trimmed === 'true') {
			return true;
		}
		if (trimmed === 'false') {
			return false;
		}
		const numeric = Number(trimmed);
		if (trimmed !== '' && Number.isFinite(numeric) && !/[a-z]/i.test(trimmed)) {
			return numeric;
		}
		return trimmed;
	}

	function commitAttributes(): void {
		const attributes: Record<string, AttributeValue> = {};
		for (const row of attrs) {
			const key = row.key.trim();
			if (key === '') {
				continue;
			}
			const value = parseAttribute(row.value);
			if (value !== undefined) {
				attributes[key] = value;
			}
		}
		onUpdate({ attributes }, '更新属性');
	}

	function addAttributeRow(): void {
		attrs = [...attrs, { key: '', value: '' }];
	}

	function removeAttributeRow(index: number): void {
		attrs = attrs.filter((_, i) => i !== index);
	}
</script>

<div class="panel">
	<h2 class="panel-title">角色状态编辑器</h2>
	<p class="panel-sub">
		穿着与属性的快速编辑；地点库与衣柜请在对应标签页维护。所有变更都会自动生成快照。
	</p>

	<div class="card">
		<h3 class="card-title">穿着</h3>
		<div class="grid-2">
			{#each slots as slot (slot.key)}
				<OutfitSlotPicker
					idPrefix="outfit"
					label={slot.label}
					slot={slot.key}
					value={characterState.outfit[slot.key] ?? ''}
					wardrobe={characterState.outfit.wardrobe}
					onCommit={(value) => commitSlot(slot.key, value)}
				/>
			{/each}
			<AccessoryPicker
				idPrefix="outfit"
				label="配饰"
				value={characterState.outfit.accessories}
				wardrobe={characterState.outfit.wardrobe}
				onCommit={(next) => onUpdate({ outfit: { accessories: next } }, '更新穿着')}
			/>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">属性</h3>
		{#each attrs as row, index (row.key + index)}
			<div class="key-value-row">
				<input class="input" bind:value={row.key} onchange={commitAttributes} placeholder="键" />
				<input
					class="input value-input"
					bind:value={row.value}
					onchange={commitAttributes}
					placeholder="值"
				/>
				<button
					class="btn btn-danger btn-small"
					onclick={() => removeAttributeRow(index)}
					aria-label="删除属性">✕</button
				>
			</div>
		{/each}
		<button class="btn btn-small" onclick={addAttributeRow}>＋ 添加属性</button>
	</div>
</div>
