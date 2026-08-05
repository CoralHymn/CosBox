<script lang="ts">
	import { DAY_NAMES, formatMinutesOfDay } from '../core/state';
	import type { ClothingItem, LocationDef, ScheduleEntry } from '../core/types';
	import {
		itemKeyFor,
		KIND_LABELS,
		WORLDVIEW_PRESETS,
		type GeneratedItem,
		type GenerationRequest,
		type GenerationResult,
		type GeneratorKind,
		type WorldviewPreset
	} from '../llm/generator';

	interface Props {
		kind: GeneratorKind;
		/** 现有条目（用于标注已存在并默认取消勾选）。 */
		existing: GeneratedItem[];
		onClose: () => void;
		onGenerate: (request: GenerationRequest) => Promise<GenerationResult>;
		onImport: (items: GeneratedItem[]) => Promise<void>;
	}

	let { kind, existing, onClose, onGenerate, onImport }: Props = $props();

	let worldview = $state<WorldviewPreset>('modern');
	let gender = $state('女');
	let customGender = $state('');
	let requirements = $state('');
	let generating = $state(false);
	let errorText = $state('');
	let result = $state<GenerationResult | null>(null);
	let selected = $state<Record<string, boolean>>({});

	const existingNames = $derived(new Set(existing.map((item) => itemKeyFor(kind, item))));
	const checkedCount = $derived(
		result === null
			? 0
			: result.items.filter((item) => selected[itemKeyFor(kind, item)] === true).length
	);

	async function run(): Promise<void> {
		generating = true;
		errorText = '';
		result = null;
		try {
			const effectiveGender =
				kind === 'wardrobe'
					? gender === '自定义'
						? customGender.trim() || '中性'
						: gender
					: undefined;
			const res = await onGenerate({
				kind,
				worldview,
				...(kind === 'wardrobe' ? { gender: effectiveGender } : {}),
				requirements: requirements.trim()
			});
			result = res;
			selected = Object.fromEntries(
				res.items.map((item) => [
					itemKeyFor(kind, item),
					!existingNames.has(itemKeyFor(kind, item))
				])
			);
		} catch (err) {
			errorText = err instanceof Error ? err.message : '生成失败，请重试';
		} finally {
			generating = false;
		}
	}

	function itemLabel(item: GeneratedItem): string {
		if (kind === 'locations') {
			const place = item as LocationDef;
			return `${place.category === '' ? '未分类' : place.category} > ${place.name}：${place.description}`;
		}
		if (kind === 'wardrobe') {
			const cloth = item as ClothingItem;
			return `${cloth.category === '' ? '未分类' : cloth.category} > ${cloth.name}（${cloth.kind ?? 'any'}）：${cloth.description}`;
		}
		const entry = item as ScheduleEntry;
		return `${DAY_NAMES[entry.day]} ${formatMinutesOfDay(entry.start)}-${formatMinutesOfDay(entry.end)} ${entry.title}`;
	}

	function selectAll(): void {
		if (result === null) {
			return;
		}
		selected = Object.fromEntries(result.items.map((item) => [itemKeyFor(kind, item), true]));
	}

	function selectNone(): void {
		if (result === null) {
			return;
		}
		selected = Object.fromEntries(result.items.map((item) => [itemKeyFor(kind, item), false]));
	}

	async function importSelected(): Promise<void> {
		if (result === null) {
			return;
		}
		const items = result.items.filter((item) => selected[itemKeyFor(kind, item)] === true);
		if (items.length === 0) {
			return;
		}
		await onImport(items);
		onClose();
	}
</script>

<div
	class="prompt-backdrop"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}}
>
	<div class="prompt-modal ai-modal" role="dialog" aria-label={`AI 生成${KIND_LABELS[kind]}`}>
		<div class="prompt-modal-head">
			<span class="prompt-modal-title">AI 生成{KIND_LABELS[kind]}</span>
			<button class="btn btn-small" onclick={onClose}>关闭</button>
		</div>
		<div class="prompt-modal-body">
			<div class="grid-2">
				<div class="field">
					<label for="ai-worldview">世界观</label>
					<select id="ai-worldview" class="select" bind:value={worldview}>
						{#each Object.entries(WORLDVIEW_PRESETS) as [value, preset] (value)}
							<option {value}>{preset.label}</option>
						{/each}
					</select>
				</div>
				{#if kind === 'wardrobe'}
					<div class="field">
						<label for="ai-gender">角色性别</label>
						<select id="ai-gender" class="select" bind:value={gender}>
							<option value="女">女</option>
							<option value="男">男</option>
							<option value="自定义">自定义…</option>
						</select>
					</div>
				{/if}
			</div>
			{#if kind === 'wardrobe' && gender === '自定义'}
				<div class="field">
					<label for="ai-custom-gender">自定义性别</label>
					<input
						id="ai-custom-gender"
						class="input"
						bind:value={customGender}
						placeholder="如：无性别 / 兽人 / 精灵"
					/>
				</div>
			{/if}
			<div class="field">
				<label for="ai-requirements">你的要求</label>
				<textarea
					id="ai-requirements"
					class="textarea"
					bind:value={requirements}
					placeholder="描述想要的内容，如：学园场景，需要书院、集市、马厩；或：日常便服，清爽一点"
				></textarea>
			</div>
			<div class="row-actions" style="margin-bottom: 12px;">
				<button
					class="btn btn-primary"
					onclick={run}
					disabled={generating || requirements.trim() === ''}
				>
					{generating ? '生成中…' : '生成'}
				</button>
				<p class="muted">
					生成内容会先经 review_generation
					工具审查（格式、遗漏与世界观一致性），你可以勾选需要的部分后一键导入。
				</p>
			</div>

			{#if errorText !== ''}
				<p class="muted" style="color: var(--err); margin: 0 0 8px;">{errorText}</p>
			{/if}

			{#if result !== null}
				{#if result.issues.length > 0}
					<p class="muted" style="color: var(--warn); margin: 0 0 8px;">
						审查提示：{result.issues.join('；')}
					</p>
				{/if}
				<div class="ai-item-list">
					{#each result.items as item (itemKeyFor(kind, item))}
						<label class="list-row ai-item">
							<input
								type="checkbox"
								checked={selected[itemKeyFor(kind, item)] === true}
								onchange={(event) => {
									selected = {
										...selected,
										[itemKeyFor(kind, item)]: (event.currentTarget as HTMLInputElement).checked
									};
								}}
							/>
							<span style="flex: 1; min-width: 0;">{itemLabel(item)}</span>
							{#if existingNames.has(itemKeyFor(kind, item))}
								<span class="badge current">已存在</span>
							{/if}
						</label>
					{/each}
				</div>
				<div class="row-actions" style="margin-top: 12px;">
					<button class="btn btn-small" onclick={selectAll}>全选</button>
					<button class="btn btn-small" onclick={selectNone}>全不选</button>
					<button class="btn btn-primary" onclick={importSelected} disabled={checkedCount === 0}>
						一键导入（{checkedCount}）
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
