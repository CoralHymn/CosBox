<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';

	interface Props {
		workspaces: WorkspaceMeta[];
		currentId: string | null;
		/** 正在生成回复/切换中：禁用进入与删除，避免竞态。 */
		busy?: boolean;
		onEnter: (id: string) => void;
		onCreate: (name: string) => Promise<void>;
		onRename: (id: string, name: string) => Promise<void>;
		onDuplicate: (id: string) => Promise<void>;
		onDelete: (id: string) => Promise<void>;
		onExport: (id: string) => Promise<void>;
		onImportFile: (file: File) => Promise<void>;
	}

	let {
		workspaces,
		currentId,
		busy = false,
		onEnter,
		onCreate,
		onRename,
		onDuplicate,
		onDelete,
		onExport,
		onImportFile
	}: Props = $props();

	let newName = $state('');
	let editingId = $state<string | null>(null);
	let editingName = $state('');
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	let creating = $state(false);

	function fmt(ts: number): string {
		const d = new Date(ts);
		const pad = (v: number): string => String(v).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function startRename(ws: WorkspaceMeta): void {
		editingId = ws.id;
		editingName = ws.name;
	}

	function cancelRename(): void {
		editingId = null;
		editingName = '';
	}

	async function saveRename(id: string): Promise<void> {
		const name = editingName.trim();
		if (name === '') {
			return;
		}
		editingId = null;
		await onRename(id, name);
	}

	async function create(): Promise<void> {
		const name = newName.trim();
		if (name === '' || creating) {
			return;
		}
		creating = true;
		try {
			await onCreate(name);
			newName = '';
		} finally {
			creating = false;
		}
	}

	function onNewNameKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			void create();
		}
	}

	function onRenameKeydown(id: string, event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			void saveRename(id);
		} else if (event.key === 'Escape') {
			cancelRename();
		}
	}

	function pickImport(): void {
		fileInput?.click();
	}

	async function importPicked(): Promise<void> {
		const file = fileInput?.files?.[0];
		if (file !== undefined) {
			await onImportFile(file);
		}
		// 允许重复选择同一文件。
		if (fileInput !== undefined) {
			fileInput.value = '';
		}
	}
</script>

<div class="ws-manager">
	<div class="ws-list">
		{#each workspaces as ws (ws.id)}
			<div class="ws-row" class:current={ws.id === currentId}>
				{#if editingId === ws.id}
					<div class="ws-edit">
						<input
							bind:value={editingName}
							onkeydown={(event) => onRenameKeydown(ws.id, event)}
							placeholder="工作区名称"
						/>
						<button class="btn btn-small" onclick={() => saveRename(ws.id)}>保存</button>
						<button class="btn btn-small" onclick={cancelRename}>取消</button>
					</div>
				{:else}
					<button
						class="ws-enter"
						class:is-current={ws.id === currentId}
						disabled={busy}
						onclick={() => onEnter(ws.id)}
					>
						<span class="ws-name">{ws.name}</span>
						<span class="ws-meta">
							{ws.id === currentId ? '当前工作区' : `更新于 ${fmt(ws.updatedAt)}`}
						</span>
					</button>
					<div class="ws-actions">
						<button
							class="btn btn-small"
							title="重命名"
							aria-label="重命名"
							onclick={() => startRename(ws)}
						>
							✏️
						</button>
						<button
							class="btn btn-small"
							title="复制工作区"
							aria-label="复制工作区"
							disabled={busy}
							onclick={() => onDuplicate(ws.id)}
						>
							⧉
						</button>
						<button
							class="btn btn-small"
							title="导出 .cbox"
							aria-label="导出工作区"
							disabled={busy}
							onclick={() => onExport(ws.id)}
						>
							⬇️
						</button>
						<button
							class="btn btn-small"
							title="删除工作区"
							aria-label="删除工作区"
							disabled={busy || workspaces.length <= 1}
							onclick={() => onDelete(ws.id)}
						>
							🗑️
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<p class="empty-hint">还没有工作区，先新建一个吧</p>
		{/each}
	</div>
	<div class="ws-create">
		<input
			bind:value={newName}
			onkeydown={onNewNameKeydown}
			placeholder="新工作区名称"
			maxlength="40"
		/>
		<button class="btn" disabled={newName.trim() === '' || creating} onclick={create}>
			新建工作区
		</button>
		<button class="btn" disabled={busy} onclick={pickImport}>导入 .cbox 为新工作区</button>
		<input
			type="file"
			accept=".cbox,.zip"
			class="ws-file-input"
			hidden
			bind:this={fileInput}
			onchange={() => void importPicked()}
		/>
	</div>
</div>
