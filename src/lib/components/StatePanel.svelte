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

	let top = $state('');
	let bottom = $state('');
	let shoes = $state('');
	let accessories = $state('');
	let locationId = $state('');
	let locationName = $state('');
	let locationDesc = $state('');
	let attrs = $state<AttributeRow[]>([]);

	$effect(() => {
		top = characterState.outfit.top ?? '';
		bottom = characterState.outfit.bottom ?? '';
		shoes = characterState.outfit.shoes ?? '';
		accessories = characterState.outfit.accessories.join('，');
		locationId = characterState.location.id;
		locationName = characterState.location.name;
		locationDesc = characterState.location.description;
		attrs = Object.entries(characterState.attributes).map(([key, value]) => ({ key, value: String(value) }));
	});

	function commitOutfit(): void {
		onUpdate(
			{
				outfit: {
					top: top.trim() === '' ? null : top.trim(),
					bottom: bottom.trim() === '' ? null : bottom.trim(),
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

	function commitLocation(): void {
		onUpdate(
			{
				location: {
					id: locationId.trim() === '' ? 'unknown' : locationId.trim(),
					name: locationName.trim() === '' ? '未命名地点' : locationName.trim(),
					description: locationDesc.trim()
				}
			},
			'更新地点'
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
	<p class="panel-sub">所有变更都会自动生成快照，可通过「版本」页随时回退。</p>

	<div class="card">
		<h3 class="card-title">穿着</h3>
		<div class="grid-2">
			<div class="field">
				<label for="outfit-top">上衣</label>
				<input id="outfit-top" class="input" bind:value={top} onchange={commitOutfit} />
			</div>
			<div class="field">
				<label for="outfit-bottom">下装</label>
				<input id="outfit-bottom" class="input" bind:value={bottom} onchange={commitOutfit} />
			</div>
		</div>
		<div class="field">
			<label for="outfit-shoes">鞋</label>
			<input id="outfit-shoes" class="input" bind:value={shoes} onchange={commitOutfit} />
		</div>
		<div class="field">
			<label for="outfit-accessories">配饰（用逗号分隔）</label>
			<input id="outfit-accessories" class="input" bind:value={accessories} onchange={commitOutfit} />
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">地点</h3>
		<div class="field">
			<label for="loc-name">地点名称</label>
			<input id="loc-name" class="input" bind:value={locationName} onchange={commitLocation} />
		</div>
		<div class="grid-2">
			<div class="field">
				<label for="loc-id">地点 id</label>
				<input id="loc-id" class="input" bind:value={locationId} onchange={commitLocation} />
			</div>
			<div class="field">
				<label for="loc-desc">描述</label>
				<input id="loc-desc" class="input" bind:value={locationDesc} onchange={commitLocation} />
			</div>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">属性</h3>
		{#each attrs as row, index (row.key + index)}
			<div class="key-value-row">
				<input class="input" bind:value={row.key} onchange={commitAttributes} placeholder="键" />
				<input class="input value-input" bind:value={row.value} onchange={commitAttributes} placeholder="值" />
				<button class="btn btn-danger btn-small" onclick={() => removeAttributeRow(index)} aria-label="删除属性">✕</button>
			</div>
		{/each}
		<button class="btn btn-small" onclick={addAttributeRow}>＋ 添加属性</button>
	</div>
</div>
