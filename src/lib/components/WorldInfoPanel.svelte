<script lang="ts">
	import type { WorldInfoEntry } from '../core/types';
	import { newId } from '../utils/id';

	interface Props {
		entries: WorldInfoEntry[];
		onUpsert: (entry: WorldInfoEntry) => void;
		onRemove: (id: string) => void;
	}

	let { entries, onUpsert, onRemove }: Props = $props();

	let draftKeys = $state('');
	let draftContent = $state('');
	let draftPriority = $state(50);

	function splitKeys(raw: string): string[] {
		return raw
			.split(/[,，]/)
			.map((key) => key.trim())
			.filter((key) => key !== '');
	}

	function upsertEntry(id: string, patch: Partial<WorldInfoEntry>): void {
		const entry = entries.find((item) => item.id === id);
		if (entry) {
			onUpsert({ ...entry, ...patch });
		}
	}

	function addEntry(): void {
		const keys = splitKeys(draftKeys);
		if (keys.length === 0 || draftContent.trim() === '') {
			return;
		}
		onUpsert({
			id: newId(),
			keys,
			content: draftContent.trim(),
			enabled: true,
			priority: draftPriority
		});
		draftKeys = '';
		draftContent = '';
		draftPriority = 50;
	}
</script>

<div class="panel">
	<h2 class="panel-title">世界书（World Info）</h2>
	<p class="panel-sub">关键词触发式设定：对话中命中关键词时，对应内容会注入 LLM 上下文。</p>

	{#each entries as entry (entry.id)}
		<div class="card">
			<div class="row-actions" style="margin-bottom: 10px;">
				<input
					class="input"
					value={entry.keys.join('，')}
					placeholder="触发关键词（逗号分隔）"
					onchange={(event) =>
						upsertEntry(entry.id, {
							keys: splitKeys((event.currentTarget as HTMLInputElement).value)
						})}
				/>
				<input
					class="input"
					style="width: 90px;"
					type="number"
					value={entry.priority}
					placeholder="优先级"
					onchange={(event) =>
						upsertEntry(entry.id, {
							priority: Number((event.currentTarget as HTMLInputElement).value)
						})}
				/>
				<label class="row-actions" style="gap: 5px;">
					<input
						class="checkbox"
						type="checkbox"
						checked={entry.enabled}
						onchange={(event) =>
							upsertEntry(entry.id, { enabled: (event.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="muted">启用</span>
				</label>
				<button
					class="btn btn-danger btn-small"
					onclick={() => onRemove(entry.id)}
					aria-label="删除条目">✕</button
				>
			</div>
			<textarea
				class="textarea"
				value={entry.content}
				placeholder="设定内容"
				onchange={(event) =>
					upsertEntry(entry.id, { content: (event.currentTarget as HTMLTextAreaElement).value })}
			></textarea>
		</div>
	{:else}
		<p class="empty-hint">还没有世界信息条目</p>
	{/each}

	<div class="card">
		<h3 class="card-title">新增条目</h3>
		<div class="field">
			<label for="wi-keys">触发关键词</label>
			<input id="wi-keys" class="input" bind:value={draftKeys} placeholder="如：图书馆，禁地" />
		</div>
		<div class="field">
			<label for="wi-content">设定内容</label>
			<textarea
				id="wi-content"
				class="textarea"
				bind:value={draftContent}
				placeholder="命中时注入上下文的内容"></textarea>
		</div>
		<div class="field">
			<label for="wi-priority">优先级</label>
			<input id="wi-priority" class="input" type="number" bind:value={draftPriority} />
		</div>
		<button class="btn btn-primary" onclick={addEntry}>添加条目</button>
	</div>
</div>
