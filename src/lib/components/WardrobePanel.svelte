<script lang="ts">
	import { findWardrobeItem } from '../context/state-summary';
	import { CLOTHING_KINDS } from '../core/state';
	import type {
		ClothingItem,
		ClothingKind,
		ConfigPatch,
		OutfitSlot,
		OutfitState,
		StatePatch
	} from '../core/types';
	import type {
		GeneratedItem,
		GenerationRequest,
		GenerationResult,
		GeneratorKind
	} from '../llm/generator';
	import { groupByCategory } from '../utils/grouping';
	import { moveItemToTarget } from '../utils/grouping';
	import { newId } from '../utils/id';
	import AccessoryPicker from './AccessoryPicker.svelte';
	import AiGeneratorPanel from './AiGeneratorPanel.svelte';
	import OutfitSlotPicker from './OutfitSlotPicker.svelte';

	interface Props {
		outfit: OutfitState;
		onUpdate: (patch: StatePatch, desc: string) => void;
		/** 衣柜条目属于世界配置：编辑不生成快照、不进版本历史。 */
		onConfig: (patch: ConfigPatch) => void;
		onAiGenerate: (request: GenerationRequest) => Promise<GenerationResult>;
		onAiImport: (kind: GeneratorKind, items: GeneratedItem[]) => Promise<void>;
		onExportConfig: (kind: GeneratorKind, items: GeneratedItem[]) => void;
		onImportConfig: (kind: GeneratorKind, raw: string) => Promise<void>;
	}

	let {
		outfit,
		onUpdate,
		onConfig,
		onAiGenerate,
		onAiImport,
		onExportConfig,
		onImportConfig
	}: Props = $props();

	interface WardrobeRow {
		id: string;
		category: string;
		kind: ClothingKind;
		name: string;
		description: string;
	}

	const slots: { key: OutfitSlot; label: string }[] = [
		{ key: 'headwear', label: '帽子' },
		{ key: 'top', label: '上衣' },
		{ key: 'underwear', label: '内衣' },
		{ key: 'underpants', label: '内裤' },
		{ key: 'bottom', label: '下装' },
		{ key: 'socks', label: '袜子' },
		{ key: 'shoes', label: '鞋' }
	];

	const kindLabels: Record<ClothingKind, string> = {
		headwear: '帽子',
		top: '上衣',
		underwear: '内衣',
		underpants: '内裤',
		bottom: '下装',
		socks: '袜子',
		shoes: '鞋',
		accessory: '配饰',
		any: '任意'
	};

	// rows 同时被用户编辑与外部状态同步，不能改写成只读 derived。
	// eslint-disable-next-line svelte/prefer-writable-derived
	let rows = $state<WardrobeRow[]>([]);
	let collapsed = $state<Record<string, boolean>>({});
	let draftCategory = $state('');
	let draftKind = $state<ClothingKind>('top');
	let draftName = $state('');
	let draftDescription = $state('');
	let aiOpen = $state(false);
	let dragId = $state<string | null>(null);
	let importInput = $state<HTMLInputElement | null>(null);
	let sortingEnabled = $state(false);

	const groups = $derived(groupByCategory(rows));
	const slotItems = $derived(
		Object.fromEntries(
			slots.map(({ key }) => [key, findWardrobeItem(outfit.wardrobe, outfit[key] ?? '')])
		) as Record<OutfitSlot, { name: string; description: string } | undefined>
	);
	const accessoryItems = $derived(
		outfit.accessories
			.map((name) => findWardrobeItem(outfit.wardrobe, name))
			.filter((item): item is ClothingItem => item !== undefined)
	);

	$effect(() => {
		rows = outfit.wardrobe.map((item) => ({
			id: item.id,
			category: item.category,
			kind: item.kind ?? 'any',
			name: item.name,
			description: item.description
		}));
	});

	function toggle(category: string): void {
		collapsed[category] = !collapsed[category];
	}

	function commitSlot(slot: OutfitSlot, value: string | null): void {
		const patch: Partial<OutfitState> = {};
		patch[slot] = value;
		onUpdate({ outfit: patch }, '更新穿着');
	}

	function commitWardrobe(): void {
		onConfig({
			wardrobe: rows.map((row) => ({
				id: row.id,
				category: row.category,
				kind: row.kind,
				name: row.name,
				description: row.description
			}))
		});
	}

	function addItem(): void {
		const name = draftName.trim();
		if (name === '') {
			return;
		}
		rows = [
			...rows,
			{
				id: newId(),
				category: draftCategory.trim(),
				kind: draftKind,
				name,
				description: draftDescription.trim()
			}
		];
		commitWardrobe();
		draftCategory = '';
		draftKind = 'top';
		draftName = '';
		draftDescription = '';
	}

	function removeItem(id: string): void {
		if (!window.confirm('确定删除这件衣物？此操作会立即保存，无法撤销。')) {
			return;
		}
		rows = rows.filter((row) => row.id !== id);
		commitWardrobe();
	}

	/** 拖拽排序：把 dragId 衣物放到目标衣物位置（仅同分类内），并持久化。 */
	function onDrop(targetId: string): void {
		if (dragId === null || dragId === targetId) {
			dragId = null;
			return;
		}
		const dragRow = rows.find((row) => row.id === dragId);
		const targetRow = rows.find((row) => row.id === targetId);
		if (
			dragRow === undefined ||
			targetRow === undefined ||
			dragRow.category !== targetRow.category
		) {
			dragId = null;
			return;
		}
		rows = moveItemToTarget(rows, dragId, targetId);
		dragId = null;
		commitWardrobe();
	}

	function exportConfig(): void {
		onExportConfig('wardrobe', rows);
	}

	async function onImportFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file === undefined) {
			return;
		}
		try {
			await onImportConfig('wardrobe', await file.text());
		} finally {
			input.value = '';
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">衣柜</h2>
	<p class="panel-sub">
		衣柜条目带分类与衣物类型（如「常服 > 上衣 >
		白色衬衫」）；槽位只能从匹配类型的衣物中挑选，不会把内裤套头上。
	</p>

	<div class="card">
		<h3 class="card-title">当前穿着</h3>
		<div class="grid-2">
			{#each slots as slot (slot.key)}
				<OutfitSlotPicker
					idPrefix="wardrobe"
					label={slot.label}
					slot={slot.key}
					value={outfit[slot.key] ?? ''}
					wardrobe={outfit.wardrobe}
					onCommit={(value) => commitSlot(slot.key, value)}
				/>
			{/each}
			<AccessoryPicker
				idPrefix="wardrobe"
				label="配饰"
				value={outfit.accessories}
				wardrobe={outfit.wardrobe}
				onCommit={(next) => onUpdate({ outfit: { accessories: next } }, '更新穿着')}
			/>
		</div>
		{#if Object.values(slotItems).some((item) => item !== undefined) || accessoryItems.length > 0}
			<div class="card" style="margin: 12px 0 0; background: var(--panel-2);">
				<h3 class="card-title">穿着细节</h3>
				{#each slots as slot (slot.key)}
					{#if slotItems[slot.key]}
						<p class="preview-line">
							<span class="k">{slot.label}</span><span
								>{slotItems[slot.key]!.name}：{slotItems[slot.key]!.description}</span
							>
						</p>
					{/if}
				{/each}
				{#each accessoryItems as item (item.name)}
					<p class="preview-line">
						<span class="k">配饰</span><span
							>{item.name}：{item.description}</span
						>
					</p>
				{/each}
			</div>
		{/if}
	</div>

	<div class="card">
		<div class="row-actions" style="justify-content: space-between; margin-bottom: 10px;">
			<h3 class="card-title" style="margin: 0;">衣柜管理</h3>
			<button
				class="btn btn-small"
				class:active={sortingEnabled}
				onclick={() => (sortingEnabled = !sortingEnabled)}
			>
				编辑排序
			</button>
		</div>
		{#if sortingEnabled}
			<p class="muted" style="margin: 0 0 6px;">拖动条目行可调整分类内的顺序。</p>
		{/if}
		{#if groups.length === 0}
			<p class="empty-hint">衣柜是空的，添加第一件衣物吧</p>
		{:else}
			{#each groups as group (group.category)}
				<div class="group">
					<button class="group-header" onclick={() => toggle(group.category)}>
						<span class="chevron" class:collapsed={collapsed[group.category]}>▸</span>
						<span class="group-name">{group.category === '' ? '未分类' : group.category}</span>
						<span class="muted">{group.items.length} 件</span>
					</button>
					{#if !collapsed[group.category]}
						{#each group.items as row (row.id)}
							<div
								class="list-row"
								class:dragging={dragId === row.id}
								role="button"
								tabindex="-1"
								draggable={sortingEnabled}
								style="align-items: flex-start;"
								ondragstart={() => (dragId = row.id)}
								ondragover={(event) => event.preventDefault()}
								ondrop={(event) => {
									event.preventDefault();
									onDrop(row.id);
								}}
								ondragend={() => (dragId = null)}
							>
								{#if sortingEnabled}
									<span class="drag-handle" title="拖拽排序" style="margin-top: 9px;">⠿</span>
								{/if}
								<div style="width: 90px; flex: none;">
									<input
										class="input"
										bind:value={row.category}
										onchange={commitWardrobe}
										placeholder="分类"
									/>
								</div>
								<div style="width: 100px; flex: none;">
									<select
										class="select"
										value={row.kind}
										onchange={(event) => {
											row.kind = event.currentTarget.value as ClothingKind;
											commitWardrobe();
										}}
									>
										{#each CLOTHING_KINDS as kind (kind)}
											<option value={kind}>{kindLabels[kind]}</option>
										{/each}
									</select>
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
					list="wardrobe-categories"
					placeholder="如：常服 / 工作服"
				/>
				<datalist id="wardrobe-categories">
					{#each groups as group (group.category)}
						{#if group.category !== ''}
							<option value={group.category}></option>
						{/if}
					{/each}
				</datalist>
			</div>
			<div class="field">
				<label for="new-item-kind">衣物类型</label>
				<select id="new-item-kind" class="select" bind:value={draftKind}>
					{#each CLOTHING_KINDS as kind (kind)}
						<option value={kind}>{kindLabels[kind]}</option>
					{/each}
				</select>
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
		<div class="row-actions">
			<button class="btn btn-primary" onclick={addItem}>添加衣物</button>
			<button class="btn" onclick={() => (aiOpen = true)}>AI衣物</button>
			<button class="btn" onclick={exportConfig}>导出</button>
			<button class="btn" onclick={() => importInput?.click()}>导入</button>
			<input
				bind:this={importInput}
				type="file"
				accept="application/json,.json"
				style="display: none;"
				onchange={onImportFile}
			/>
		</div>
	</div>
</div>

{#if aiOpen}
	<AiGeneratorPanel
		kind="wardrobe"
		existing={outfit.wardrobe}
		onClose={() => (aiOpen = false)}
		onGenerate={onAiGenerate}
		onImport={(items) => onAiImport('wardrobe', items)}
	/>
{/if}
