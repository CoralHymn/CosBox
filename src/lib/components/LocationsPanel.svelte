<script lang="ts">
	import type { ConfigPatch, LocationDef, LocationState, StatePatch } from '../core/types';
	import type {
		GeneratedItem,
		GenerationRequest,
		GenerationResult,
		GeneratorKind
	} from '../llm/generator';
	import { groupByCategory } from '../utils/grouping';
	import { moveItemToTarget } from '../utils/grouping';
	import { newId } from '../utils/id';
	import AiGeneratorPanel from './AiGeneratorPanel.svelte';

	interface Props {
		places: LocationDef[];
		location: LocationState;
		onUpdate: (patch: StatePatch, desc: string) => void;
		/** 地点库条目属于世界配置：编辑不生成快照、不进版本历史。 */
		onConfig: (patch: ConfigPatch) => void;
		onAiGenerate: (request: GenerationRequest) => Promise<GenerationResult>;
		onAiImport: (kind: GeneratorKind, items: GeneratedItem[]) => Promise<void>;
		onExportConfig: (kind: GeneratorKind, items: GeneratedItem[]) => void;
		onImportConfig: (kind: GeneratorKind, raw: string) => Promise<void>;
	}

	let {
		places,
		location,
		onUpdate,
		onConfig,
		onAiGenerate,
		onAiImport,
		onExportConfig,
		onImportConfig
	}: Props = $props();

	interface PlaceRow {
		id: string;
		category: string;
		name: string;
		description: string;
	}

	let rows = $state<PlaceRow[]>([]);
	let collapsed = $state<Record<string, boolean>>({});
	let currentId = $state('custom');
	let customCategory = $state('');
	let customName = $state('');
	let customDescription = $state('');
	let draftCategory = $state('');
	let draftName = $state('');
	let draftDescription = $state('');
	let aiOpen = $state(false);
	let dragId = $state<string | null>(null);
	let importInput = $state<HTMLInputElement | null>(null);

	const groups = $derived(groupByCategory(rows));

	$effect(() => {
		rows = places.map((place) => ({
			id: place.id,
			category: place.category,
			name: place.name,
			description: place.description
		}));
		currentId = places.some((place) => place.id === location.id) ? location.id : 'custom';
		customCategory = location.category;
		customName = location.name;
		customDescription = location.description;
	});

	function toggle(category: string): void {
		collapsed[category] = !collapsed[category];
	}

	function placeLabel(category: string, name: string): string {
		return category === '' ? name : `${category} > ${name}`;
	}

	/** 从地点库中选择当前所在地。 */
	function commitCurrent(placeId: string): void {
		const place = places.find((item) => item.id === placeId);
		if (place) {
			onUpdate(
				{
					location: {
						id: place.id,
						category: place.category,
						name: place.name,
						description: place.description
					}
				},
				`移动至：${placeLabel(place.category, place.name)}`
			);
		}
	}

	/** 提交自定义当前地点（不在地点库中）。 */
	function commitCustom(): void {
		const name = customName.trim();
		onUpdate(
			{
				location: {
					id: name === '' ? 'custom-location' : name,
					category: customCategory.trim(),
					name: name === '' ? '未命名地点' : name,
					description: customDescription.trim()
				}
			},
			'更新当前地点'
		);
	}

	function commitPlaces(): void {
		onConfig({
			places: rows.map((row) => ({
				id: row.id,
				category: row.category,
				name: row.name,
				description: row.description
			}))
		});
	}

	function addPlace(): void {
		const name = draftName.trim();
		if (name === '') {
			return;
		}
		rows = [
			...rows,
			{ id: newId(), category: draftCategory.trim(), name, description: draftDescription.trim() }
		];
		commitPlaces();
		draftCategory = '';
		draftName = '';
		draftDescription = '';
	}

	function removePlace(id: string): void {
		if (!window.confirm('确定删除该地点？此操作会立即保存，无法撤销。')) {
			return;
		}
		rows = rows.filter((row) => row.id !== id);
		commitPlaces();
	}

	/** 拖拽排序：把 dragId 地点放到目标地点位置（仅同分类内），并持久化。 */
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
		commitPlaces();
	}

	function exportConfig(): void {
		onExportConfig('locations', rows);
	}

	async function onImportFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file === undefined) {
			return;
		}
		try {
			await onImportConfig('locations', await file.text());
		} finally {
			input.value = '';
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">地点</h2>
	<p class="panel-sub">
		地点库是 AI 认知中的全部地点（可按大类收纳，如「学校 > 食堂」）；当前所在地独立于日程。
	</p>

	<div class="card">
		<h3 class="card-title">当前所在地</h3>
		<div class="field">
			<label for="current-place">地点</label>
			<select
				id="current-place"
				class="select"
				value={currentId}
				onchange={(event) => {
					const value = (event.currentTarget as HTMLSelectElement).value;
					if (value === 'custom') {
						currentId = 'custom';
					} else {
						commitCurrent(value);
					}
				}}
			>
				{#each places as place (place.id)}
					<option value={place.id}>{placeLabel(place.category, place.name)}</option>
				{/each}
				<option value="custom">自定义…</option>
			</select>
		</div>
		{#if currentId === 'custom'}
			<div class="grid-2">
				<div class="field">
					<label for="custom-loc-category">分类</label>
					<input
						id="custom-loc-category"
						class="input"
						bind:value={customCategory}
						onchange={commitCustom}
					/>
				</div>
				<div class="field">
					<label for="custom-loc-name">名称</label>
					<input
						id="custom-loc-name"
						class="input"
						bind:value={customName}
						onchange={commitCustom}
					/>
				</div>
				<div class="field">
					<label for="custom-loc-desc">描述</label>
					<input
						id="custom-loc-desc"
						class="input"
						bind:value={customDescription}
						onchange={commitCustom}
					/>
				</div>
			</div>
		{/if}
	</div>

	<div class="card">
		<h3 class="card-title">地点库</h3>
		{#if groups.length === 0}
			<p class="empty-hint">还没有地点，先添加一个吧</p>
		{:else}
			{#each groups as group (group.category)}
				<div class="group">
					<button class="group-header" onclick={() => toggle(group.category)}>
						<span class="chevron" class:collapsed={collapsed[group.category]}>▸</span>
						<span class="group-name">{group.category === '' ? '未分类' : group.category}</span>
						<span class="muted">{group.items.length} 处</span>
					</button>
					{#if !collapsed[group.category]}
						{#each group.items as row (row.id)}
							<div
								class="list-row"
								class:dragging={dragId === row.id}
								role="button"
								tabindex="-1"
								draggable="true"
								ondragstart={() => (dragId = row.id)}
								ondragover={(event) => event.preventDefault()}
								ondrop={(event) => {
									event.preventDefault();
									onDrop(row.id);
								}}
								ondragend={() => (dragId = null)}
							>
								<span class="drag-handle" title="拖拽排序">⠿</span>
								<input
									class="input"
									style="width: 110px;"
									bind:value={row.category}
									onchange={commitPlaces}
									placeholder="分类"
								/>
								<input
									class="input"
									style="width: 150px;"
									bind:value={row.name}
									onchange={commitPlaces}
									placeholder="地点名"
								/>
								<input
									class="input"
									style="flex: 1;"
									bind:value={row.description}
									onchange={commitPlaces}
									placeholder="描述"
								/>
								<button
									class="btn btn-danger btn-small"
									onclick={() => removePlace(row.id)}
									aria-label="删除地点">✕</button
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
				<label for="new-place-category">分类（可选）</label>
				<input
					id="new-place-category"
					class="input"
					bind:value={draftCategory}
					list="place-categories"
					placeholder="如：学校"
				/>
				<datalist id="place-categories">
					{#each groups as group (group.category)}
						{#if group.category !== ''}
							<option value={group.category}></option>
						{/if}
					{/each}
				</datalist>
			</div>
			<div class="field">
				<label for="new-place-name">地点名</label>
				<input
					id="new-place-name"
					class="input"
					bind:value={draftName}
					placeholder="如：校门口便利店"
				/>
			</div>
			<div class="field">
				<label for="new-place-desc">描述</label>
				<input
					id="new-place-desc"
					class="input"
					bind:value={draftDescription}
					placeholder="如：卖关东煮的小店"
				/>
			</div>
		</div>
		<div class="row-actions">
			<button class="btn btn-primary" onclick={addPlace}>添加地点</button>
			<button class="btn" onclick={() => (aiOpen = true)}>AI地点</button>
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
		kind="locations"
		existing={places}
		onClose={() => (aiOpen = false)}
		onGenerate={onAiGenerate}
		onImport={(items) => onAiImport('locations', items)}
	/>
{/if}
