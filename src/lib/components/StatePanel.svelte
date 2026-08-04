<script lang="ts">
	import type { AttributeValue, CharacterState, StatePatch } from '../core/types';

	interface AttributeRow {
		key: string;
		value: string;
	}

	interface Props {
		characterState: CharacterState;
		onUpdate: (patch: StatePatch, desc: string) => void;
	}

	let { characterState, onUpdate }: Props = $props();

	let headwear = $state('');
	let top = $state('');
	let underwear = $state('');
	let underpants = $state('');
	let bottom = $state('');
	let socks = $state('');
	let shoes = $state('');
	let accessories = $state('');
	let attrs = $state<AttributeRow[]>([]);

	$effect(() => {
		headwear = characterState.outfit.headwear ?? '';
		top = characterState.outfit.top ?? '';
		underwear = characterState.outfit.underwear ?? '';
		underpants = characterState.outfit.underpants ?? '';
		bottom = characterState.outfit.bottom ?? '';
		socks = characterState.outfit.socks ?? '';
		shoes = characterState.outfit.shoes ?? '';
		accessories = characterState.outfit.accessories.join('，');
		attrs = Object.entries(characterState.attributes).map(([key, value]) => ({
			key,
			value: String(value)
		}));
	});

	function commitOutfit(): void {
		onUpdate(
			{
				outfit: {
					headwear: headwear.trim() === '' ? null : headwear.trim(),
					top: top.trim() === '' ? null : top.trim(),
					underwear: underwear.trim() === '' ? null : underwear.trim(),
					underpants: underpants.trim() === '' ? null : underpants.trim(),
					bottom: bottom.trim() === '' ? null : bottom.trim(),
					socks: socks.trim() === '' ? null : socks.trim(),
					shoes: shoes.trim() === '' ? null : shoes.trim(),
					accessories: accessories
						.split(/[,，]/)
						.map((part) => part.trim())
						.filter((part) => part !== '')
				}
			},
			'更新穿着'
		);
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
			<div class="field">
				<label for="outfit-headwear">帽子</label>
				<input
					id="outfit-headwear"
					class="input"
					bind:value={headwear}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-top">上衣</label>
				<input
					id="outfit-top"
					class="input"
					bind:value={top}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-underwear">内衣</label>
				<input
					id="outfit-underwear"
					class="input"
					bind:value={underwear}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-underpants">内裤</label>
				<input
					id="outfit-underpants"
					class="input"
					bind:value={underpants}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-bottom">下装</label>
				<input
					id="outfit-bottom"
					class="input"
					bind:value={bottom}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-socks">袜子</label>
				<input
					id="outfit-socks"
					class="input"
					bind:value={socks}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="outfit-shoes">鞋</label>
				<input
					id="outfit-shoes"
					class="input"
					bind:value={shoes}
					list="outfit-wardrobe-list"
					onchange={commitOutfit}
				/>
			</div>
		</div>
		<datalist id="outfit-wardrobe-list">
			{#each characterState.outfit.wardrobe as item (item.id)}
				<option value={item.name}></option>
			{/each}
		</datalist>
		<div class="field">
			<label for="outfit-accessories">配饰（用逗号分隔）</label>
			<input
				id="outfit-accessories"
				class="input"
				bind:value={accessories}
				onchange={commitOutfit}
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
