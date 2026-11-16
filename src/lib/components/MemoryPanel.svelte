<script lang="ts">
	import { X } from '@lucide/svelte';
	import { MEMORY_CATEGORIES, type ExtractedMemory, type MemoryEntry } from '../memory/types';

	interface Props {
		entries: MemoryEntry[];
		extracting: boolean;
		onAdd: (draft: {
			content: string;
			category: string;
			keywords: string[];
			importance: number;
			pinned: boolean;
		}) => Promise<void>;
		onUpdate: (id: string, patch: Partial<Omit<MemoryEntry, 'id'>>) => Promise<void>;
		onRemove: (id: string) => Promise<void>;
		/** 触发 LLM 从最近对话提取候选记忆；取消或失败返回 null。 */
		onExtract: () => Promise<ExtractedMemory[] | null>;
		/** 导入勾选的候选；返回导入/跳过数量供提示。 */
		onImportExtracted: (items: ExtractedMemory[]) => Promise<{ imported: number; skipped: number }>;
	}

	let {
		entries,
		extracting,
		onAdd,
		onUpdate,
		onRemove,
		onExtract,
		onImportExtracted
	}: Props = $props();

	let filter = $state('全部');
	let showAdd = $state(false);
	let addContent = $state('');
	let addCategory = $state('人物关系');
	let addKeywords = $state('');
	let addImportance = $state(3);
	let addPinned = $state(false);
	let adding = $state(false);
	let candidates = $state<ExtractedMemory[] | null>(null);
	let selected = $state<boolean[]>([]);
	let importing = $state(false);
	let importStatus = $state('');

	const categories = $derived(
		[...new Set([...MEMORY_CATEGORIES, ...entries.map((entry) => entry.category)])].sort()
	);
	const filtered = $derived(
		filter === '全部' ? entries : entries.filter((entry) => entry.category === filter)
	);
	const selectedCount = $derived(selected.filter(Boolean).length);

	function splitKeywords(raw: string): string[] {
		return raw
			.split(/[,，、]/)
			.map((key) => key.trim())
			.filter((key) => key !== '');
	}

	async function addEntry(): Promise<void> {
		if (addContent.trim() === '' || adding) {
			return;
		}
		adding = true;
		try {
			await onAdd({
				content: addContent,
				category: addCategory,
				keywords: splitKeywords(addKeywords),
				importance: addImportance,
				pinned: addPinned
			});
			addContent = '';
			addKeywords = '';
			addImportance = 3;
			addPinned = false;
			showAdd = false;
		} finally {
			adding = false;
		}
	}

	async function removeEntry(entry: MemoryEntry): Promise<void> {
		if (!window.confirm(`确定删除这条记忆？\n「${entry.content}」`)) {
			return;
		}
		await onRemove(entry.id);
	}

	async function runExtract(): Promise<void> {
		importStatus = '';
		const items = await onExtract();
		if (items === null) {
			return;
		}
		candidates = items;
		selected = items.map(() => true);
	}

	async function importSelected(): Promise<void> {
		if (candidates === null || importing) {
			return;
		}
		const picked = candidates.filter((_, index) => selected[index] === true);
		if (picked.length === 0) {
			importStatus = '未选择任何记忆';
			return;
		}
		importing = true;
		try {
			const result = await onImportExtracted(picked);
			importStatus =
				result.skipped > 0
					? `已导入 ${result.imported} 条，跳过重复 ${result.skipped} 条`
					: `已导入 ${result.imported} 条记忆`;
			candidates = null;
			selected = [];
		} finally {
			importing = false;
		}
	}

	function toggleAll(checked: boolean): void {
		selected = (candidates ?? []).map(() => checked);
	}
</script>

<div class="panel">
	<h2 class="panel-title">记忆（长期记忆库）</h2>
	<p class="panel-sub">
		记录值得跨会话记住的剧情事实。每次请求时按关键词与重要度召回注入上下文，
		弥补上下文压缩丢失的细节；与「世界书」的区别是：世界书是手动设定，记忆库可自动提取。
	</p>

	<div class="row-actions" style="margin-bottom: 12px; flex-wrap: wrap;">
		<button class="btn btn-small" onclick={runExtract} disabled={extracting}>
			{extracting ? '提取中…' : '从对话提取'}
		</button>
		<button class="btn btn-small" onclick={() => (showAdd = !showAdd)}>
			{showAdd ? '收起添加' : '添加记忆'}
		</button>
		<span class="muted" style="margin-left: auto;">
			共 {entries.length} 条
			{#if importStatus !== ''} · {importStatus}{/if}
		</span>
	</div>

	<div class="row-actions" style="margin-bottom: 12px; flex-wrap: wrap; gap: 6px;">
		<button
			class="chip-btn"
			class:chip-active={filter === '全部'}
			onclick={() => (filter = '全部')}>全部</button
		>
		{#each categories as category (category)}
			<button
				class="chip-btn"
				class:chip-active={filter === category}
				onclick={() => (filter = category)}>{category}</button
			>
		{/each}
	</div>

	{#if showAdd}
		<div class="card" style="margin-bottom: 14px;">
			<h3 class="card-title">新记忆</h3>
			<div class="field">
				<label for="mem-content">事实内容</label>
				<textarea
					id="mem-content"
					class="textarea"
					bind:value={addContent}
					placeholder="例如：绫音怕打雷，打雷时会躲进主角怀里"
				></textarea>
			</div>
			<div class="field">
				<label for="mem-category">分类</label>
				<select id="mem-category" class="select" bind:value={addCategory}>
					{#each categories as category (category)}
						<option value={category}>{category}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="mem-keywords">触发关键词（逗号分隔）</label>
				<input
					id="mem-keywords"
					class="input"
					bind:value={addKeywords}
					placeholder="例如：打雷，怕雷"
				/>
			</div>
			<div class="row-actions" style="gap: 12px;">
				<div class="field" style="flex: 1;">
					<label for="mem-importance">重要度 1-5</label>
					<input
						id="mem-importance"
						class="input"
						type="number"
						min="1"
						max="5"
						bind:value={addImportance}
					/>
				</div>
				<label class="row-actions" style="gap: 5px; margin-top: 20px;">
					<input
						class="checkbox"
						type="checkbox"
						bind:checked={addPinned}
						aria-label="置顶"
					/>
					<span class="muted">置顶（每次注入）</span>
				</label>
				<button class="btn btn-small" onclick={addEntry} disabled={adding || addContent.trim() === ''}>
					保存
				</button>
			</div>
		</div>
	{/if}

	{#if candidates !== null}
		<div class="card" style="margin-bottom: 14px; border-color: var(--accent);">
			<div class="row-actions" style="margin-bottom: 8px;">
				<h3 class="card-title" style="margin: 0;">提取候选（{candidates.length} 条）</h3>
				<div class="row-actions" style="margin-left: auto; gap: 6px;">
					<label class="row-actions" style="gap: 5px;">
						<input
							class="checkbox"
							type="checkbox"
							checked={selectedCount === candidates.length}
							onchange={(event) =>
								toggleAll((event.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="muted">全选</span>
					</label>
					<button
						class="btn btn-small"
						onclick={importSelected}
						disabled={importing || selectedCount === 0}
					>
						{importing ? '导入中…' : `导入所选（${selectedCount}）`}
					</button>
					<button class="btn btn-small" onclick={() => (candidates = null)}>取消</button>
				</div>
			</div>
			{#each candidates as candidate, index (index)}
				<div class="memory-candidate">
					<input
						class="checkbox"
						type="checkbox"
						checked={selected[index] === true}
						onchange={(event) => {
							selected = selected.map((value, i) =>
								i === index ? (event.currentTarget as HTMLInputElement).checked : value
							);
						}}
						aria-label={`选择候选 ${index + 1}`}
					/>
					<div style="flex: 1; min-width: 0;">
						<p style="margin: 0 0 4px;">{candidate.content}</p>
						<p class="muted" style="margin: 0; font-size: 12px;">
							[{candidate.category}] 重要度 {candidate.importance}
							{#if candidate.keywords.length > 0} · 关键词：{candidate.keywords.join('、')}{/if}
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#each filtered as entry (entry.id)}
		<div class="card" style="margin-bottom: 12px;">
			<div class="row-actions" style="margin-bottom: 8px; gap: 6px; flex-wrap: wrap;">
				<select
					class="select"
					style="width: auto;"
					value={entry.category}
					onchange={(event) =>
						onUpdate(entry.id, {
							category: (event.currentTarget as HTMLSelectElement).value
						})}
					aria-label="记忆分类"
				>
					{#each categories as category (category)}
						<option value={category}>{category}</option>
					{/each}
				</select>
				<input
					class="input"
					style="width: 90px;"
					type="number"
					min="1"
					max="5"
					value={entry.importance}
					onchange={(event) =>
						onUpdate(entry.id, {
							importance: Number((event.currentTarget as HTMLInputElement).value)
						})}
					aria-label="重要度"
				/>
				<label class="row-actions" style="gap: 5px;">
					<input
						class="checkbox"
						type="checkbox"
						checked={entry.pinned}
						onchange={(event) =>
							onUpdate(entry.id, {
								pinned: (event.currentTarget as HTMLInputElement).checked
							})}
						aria-label="置顶"
					/>
					<span class="muted">置顶</span>
				</label>
				<span class="muted" style="margin-left: auto; font-size: 12px;">
					召回 {entry.useCount} 次
					{#if entry.source === 'extract'} · AI 提取{/if}
				</span>
				<button
					class="btn btn-danger btn-small"
					onclick={() => removeEntry(entry)}
					aria-label="删除记忆">
					<X size={13} />
				</button>
			</div>
			<textarea
				class="textarea"
				value={entry.content}
				placeholder="记忆事实"
				onchange={(event) =>
					onUpdate(entry.id, {
						content: (event.currentTarget as HTMLTextAreaElement).value
					})}
				aria-label="记忆内容"
			></textarea>
			<input
				class="input"
				style="margin-top: 8px;"
				value={entry.keywords.join('、')}
				placeholder="触发关键词（逗号分隔）"
				onchange={(event) =>
					onUpdate(entry.id, {
						keywords: splitKeywords((event.currentTarget as HTMLInputElement).value)
					})}
				aria-label="触发关键词"
			/>
		</div>
	{:else}
		{#if !showAdd && candidates === null}
			<p class="empty-hint">
				还没有记忆。可以点击「从对话提取」让 AI 自动总结，或手动添加。
			</p>
		{/if}
	{/each}
</div>

<style>
	.chip-btn {
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text-faint);
		border-radius: 999px;
		padding: 3px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.chip-btn:hover {
		color: var(--text);
	}
	.chip-active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.memory-candidate {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.memory-candidate:first-of-type {
		border-top: none;
	}
</style>
