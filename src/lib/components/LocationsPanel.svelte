<script lang="ts">
	import type { LocationDef, LocationState, StatePatch } from '../core/types';
	import { newId } from '../utils/id';

	interface Props {
		places: LocationDef[];
		location: LocationState;
		onUpdate: (patch: StatePatch, desc: string) => void;
	}

	let { places, location, onUpdate }: Props = $props();

	interface PlaceRow {
		id: string;
		name: string;
		description: string;
	}

	let rows = $state<PlaceRow[]>([]);
	let currentId = $state('custom');
	let customName = $state('');
	let customDescription = $state('');
	let draftName = $state('');
	let draftDescription = $state('');

	$effect(() => {
		rows = places.map((place) => ({
			id: place.id,
			name: place.name,
			description: place.description
		}));
		currentId = places.some((place) => place.id === location.id) ? location.id : 'custom';
		customName = location.name;
		customDescription = location.description;
	});

	/** 从地点库中选择当前所在地。 */
	function commitCurrent(placeId: string): void {
		const place = places.find((item) => item.id === placeId);
		if (place) {
			onUpdate(
				{ location: { id: place.id, name: place.name, description: place.description } },
				`移动至：${place.name}`
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
					name: name === '' ? '未命名地点' : name,
					description: customDescription.trim()
				}
			},
			'更新当前地点'
		);
	}

	function commitPlaces(): void {
		onUpdate(
			{
				places: rows.map((row) => ({
					id: row.id,
					name: row.name,
					description: row.description
				}))
			},
			'更新地点库'
		);
	}

	function addPlace(): void {
		const name = draftName.trim();
		if (name === '') {
			return;
		}
		rows = [...rows, { id: newId(), name, description: draftDescription.trim() }];
		commitPlaces();
		draftName = '';
		draftDescription = '';
	}

	function removePlace(id: string): void {
		rows = rows.filter((row) => row.id !== id);
		commitPlaces();
	}
</script>

<div class="panel">
	<h2 class="panel-title">地点</h2>
	<p class="panel-sub">地点库是 AI 认知中的全部地点；当前所在地独立于日程，随时可以移动。</p>

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
					<option value={place.id}>{place.name}</option>
				{/each}
				<option value="custom">自定义…</option>
			</select>
		</div>
		{#if currentId === 'custom'}
			<div class="grid-2">
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
		{#if rows.length === 0}
			<p class="empty-hint">还没有地点，先添加一个吧</p>
		{:else}
			{#each rows as row (row.id)}
				<div class="list-row">
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
		<hr class="section-divider" />
		<div class="grid-2">
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
		<button class="btn btn-primary" onclick={addPlace}>添加地点</button>
	</div>
</div>
