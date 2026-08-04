<script lang="ts">
	import { findWardrobeItem } from '../context/state-summary';
	import type { OutfitState, StatePatch } from '../core/types';
	import { newId } from '../utils/id';

	interface Props {
		outfit: OutfitState;
		onUpdate: (patch: StatePatch, desc: string) => void;
	}

	let { outfit, onUpdate }: Props = $props();

	interface WardrobeRow {
		id: string;
		name: string;
		description: string;
	}

	let top = $state('');
	let bottom = $state('');
	let shoes = $state('');
	let accessories = $state('');
	let rows = $state<WardrobeRow[]>([]);
	let draftName = $state('');
	let draftDescription = $state('');

	const topItem = $derived(findWardrobeItem(outfit.wardrobe, top));
	const bottomItem = $derived(findWardrobeItem(outfit.wardrobe, bottom));
	const shoesItem = $derived(findWardrobeItem(outfit.wardrobe, shoes));

	$effect(() => {
		top = outfit.top ?? '';
		bottom = outfit.bottom ?? '';
		shoes = outfit.shoes ?? '';
		accessories = outfit.accessories.join('，');
		rows = outfit.wardrobe.map((item) => ({
			id: item.id,
			name: item.name,
			description: item.description
		}));
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

	function commitWardrobe(): void {
		onUpdate(
			{
				outfit: {
					wardrobe: rows.map((row) => ({
						id: row.id,
						name: row.name,
						description: row.description
					}))
				}
			},
			'更新衣柜'
		);
	}

	function addItem(): void {
		const name = draftName.trim();
		if (name === '') {
			return;
		}
		rows = [...rows, { id: newId(), name, description: draftDescription.trim() }];
		commitWardrobe();
		draftName = '';
		draftDescription = '';
	}

	function removeItem(id: string): void {
		rows = rows.filter((row) => row.id !== id);
		commitWardrobe();
	}
</script>

<div class="panel">
	<h2 class="panel-title">衣柜</h2>
	<p class="panel-sub">衣柜条目带「穿后描述」，AI 换装时会从衣柜中挑选合适衣物，而不是自行脑补。</p>

	<div class="card">
		<h3 class="card-title">当前穿着</h3>
		<div class="grid-2">
			<div class="field">
				<label for="wardrobe-top">上衣</label>
				<input
					id="wardrobe-top"
					class="input"
					bind:value={top}
					list="wardrobe-names"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="wardrobe-bottom">下装</label>
				<input
					id="wardrobe-bottom"
					class="input"
					bind:value={bottom}
					list="wardrobe-names"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="wardrobe-shoes">鞋</label>
				<input
					id="wardrobe-shoes"
					class="input"
					bind:value={shoes}
					list="wardrobe-names"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="wardrobe-accessories">配饰（逗号分隔）</label>
				<input
					id="wardrobe-accessories"
					class="input"
					bind:value={accessories}
					onchange={commitOutfit}
				/>
			</div>
		</div>
		<datalist id="wardrobe-names">
			{#each outfit.wardrobe as item (item.id)}
				<option value={item.name}></option>
			{/each}
		</datalist>
		{#if topItem || bottomItem || shoesItem}
			<div class="card" style="margin: 12px 0 0; background: var(--panel-2);">
				<h3 class="card-title">穿着细节</h3>
				{#if topItem}
					<p class="preview-line">
						<span class="k">上衣</span><span>{topItem.name}：{topItem.description}</span>
					</p>
				{/if}
				{#if bottomItem}
					<p class="preview-line">
						<span class="k">下装</span><span>{bottomItem.name}：{bottomItem.description}</span>
					</p>
				{/if}
				{#if shoesItem}
					<p class="preview-line">
						<span class="k">鞋</span><span>{shoesItem.name}：{shoesItem.description}</span>
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<div class="card">
		<h3 class="card-title">衣柜管理</h3>
		{#if rows.length === 0}
			<p class="empty-hint">衣柜是空的，添加第一件衣物吧</p>
		{:else}
			{#each rows as row (row.id)}
				<div class="list-row" style="align-items: flex-start;">
					<div style="width: 150px; flex: none;">
						<input
							class="input"
							bind:value={row.name}
							onchange={commitWardrobe}
							placeholder="衣物名"
						/>
					</div>
					<input
						class="input"
						style="flex: 1;"
						bind:value={row.description}
						onchange={commitWardrobe}
						placeholder="穿后描述，如：白色棉质衬衫，领口带细蕾丝"
					/>
					<button
						class="btn btn-danger btn-small"
						onclick={() => removeItem(row.id)}
						aria-label="删除衣物">✕</button
					>
				</div>
			{/each}
		{/if}
		<hr class="section-divider" />
		<div class="grid-2">
			<div class="field">
				<label for="new-item-name">衣物名</label>
				<input id="new-item-name" class="input" bind:value={draftName} placeholder="如：白色衬衫" />
			</div>
			<div class="field">
				<label for="new-item-desc">穿后描述</label>
				<input
					id="new-item-desc"
					class="input"
					bind:value={draftDescription}
					placeholder="如：白色棉质衬衫，领口带细蕾丝"
				/>
			</div>
		</div>
		<button class="btn btn-primary" onclick={addItem}>添加衣物</button>
	</div>
</div>
