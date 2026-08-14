<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import WorkspaceManager from './WorkspaceManager.svelte';

	interface Props {
		workspaces: WorkspaceMeta[];
		currentId: string | null;
		busy?: boolean;
		onClose: () => void;
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
		onClose,
		onEnter,
		onCreate,
		onRename,
		onDuplicate,
		onDelete,
		onExport,
		onImportFile
	}: Props = $props();

	$effect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div
	class="ws-modal-backdrop"
	role="presentation"
	onclick={onClose}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			onClose();
		}
	}}
>
	<div
		class="ws-modal"
		role="dialog"
		tabindex="-1"
		aria-label="管理工作区"
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => event.stopPropagation()}
	>
		<div class="ws-modal-head">
			<h3>管理工作区</h3>
			<button class="btn btn-small" aria-label="关闭" onclick={onClose}>关闭</button>
		</div>
		<WorkspaceManager
			{workspaces}
			{currentId}
			{busy}
			onEnter={(id) => {
				onEnter(id);
			}}
			{onCreate}
			{onRename}
			{onDuplicate}
			{onDelete}
			{onExport}
			{onImportFile}
		/>
	</div>
</div>
