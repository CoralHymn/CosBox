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
		category: string;
		name: string;
		description: string;
	}

	let headwear = $state('');
	let top = $state('');
	let underwear = $state('');
	let underpants = $state('');
	let bottom = $state('');
	let socks = $state('');
	let shoes = $state('');
	let accessories = $state('');
	let rows = $state<WardrobeRow[]>([]);
	let draftCategory = $state('');
	let draftName = $state('');
	let draftDescription = $state('');

	const slotItems = $derived({
		headwear: findWardrobeItem(outfit.wardrobe, headwear),
		top: findWardrobeItem(outfit.wardrobe, top),
		underwear: findWardrobeItem(outfit.wardrobe, underwear),
		underpants: findWardrobeItem(outfit.wardrobe, underpants),
		bottom: findWardrobeItem(outfit.wardrobe, bottom),
		socks: findWardrobeItem(outfit.wardrobe, socks),
		shoes: findWardrobeItem(outfit.wardrobe, shoes)
	});

	$effect(() => {
		headwear = outfit.headwear ?? '';
		top = outfit.top ?? '';
		underwear = outfit.underwear ?? '';
		underpants = outfit.underpants ?? '';
		bottom = outfit.bottom ?? '';
		socks = outfit.socks ?? '';
		shoes = outfit.shoes ?? '';
		accessories = outfit.accessories.join('，');
		rows = outfit.wardrobe.map((item) => ({
			id: item.id,
			category: item.category,
			name: item.name,
			description: item.description
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

	function commitWardrobe(): void {
		onUpdate(
			{
				outfit: {
					wardrobe: rows.map((row) => ({
						id: row.id,
						category: row.category,
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
		rows = [
			...rows,
			{ id: newId(), category: draftCategory.trim(), name, description: draftDescription.trim() }
		];
		commitWardrobe();
		draftCategory = '';
		draftName = '';
		draftDescription = '';
	}

	function removeItem(id: string): void {
		rows = rows.filter((row) => row.id !== id);
		commitWardrobe();
	}

	function slotLabel(slot: string): string {
		const labels: Record<string, string> = {
			headwear: '帽子',
			top: '上衣',
			underwear: '内衣',
			underpants: '内裤',
			bottom: '下装',
			socks: '袜子',
			shoes: '鞋'
		};
		return labels[slot] ?? slot;
	}
</script>

<div class="panel">
	<h2 class="panel-title">衣柜</h2>
	<p class="panel-sub">
		衣柜条目带「穿后描述」并可分类（如「常服 > 白色衬衫」）；AI
		换装时会从衣柜中挑选合适衣物，而不是自行脑补。
	</p>

	<div class="card">
		<h3 class="card-title">当前穿着</h3>
		<div class="grid-2">
			<div class="field">
				<label for="wardrobe-headwear">帽子</label>
				<input
					id="wardrobe-headwear"
					class="input"
					bind:value={headwear}
					list="wardrobe-names"
					onchange={commitOutfit}
				/>
			</div>
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
				<label for="wardrobe-underwear">内衣</label>
				<input
					id="wardrobe-underwear"
					class="input"
					bind:value={underwear}
					list="wardrobe-names"
					onchange={commitOutfit}
				/>
			</div>
			<div class="field">
				<label for="wardrobe-underpants">内裤</label>
				<input
					id="wardrobe-underpants"
					class="input"
					bind:value={underpants}
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
				<label for="wardrobe-socks">袜子</label>
				<input
					id="wardrobe-socks"
					class="input"
					bind:value={socks}
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
		{#if Object.values(slotItems).some((item) => item !== undefined)}
			<div class="card" style="margin: 12px 0 0; background: var(--panel-2);">
				<h3 class="card-title">穿着细节</h3>
				{#each Object.entries(slotItems) as [slot, item] (slot)}
					{#if item}
						<p class="preview-line">
							<span class="k">{slotLabel(slot)}</span><span>{item.name}：{item.description}</span>
						</p>
					{/if}
				{/each}
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
					<div style="width: 100px; flex: none;">
						<input
							class="input"
							bind:value={row.category}
							onchange={commitWardrobe}
							placeholder="分类"
						/>
					</div>
					<div style="width: 130px; flex: none;">
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
				<label for="new-item-category">分类（可选）</label>
				<input
					id="new-item-category"
					class="input"
					bind:value={draftCategory}
					placeholder="如：常服 / 工作服"
				/>
			</div>
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
