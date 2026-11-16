<script lang="ts">
	import type { WorkspaceMeta } from '../workspace/types';
	import WorkspaceManager from './WorkspaceManager.svelte';

	interface Props {
		workspaces: WorkspaceMeta[];
		currentId: string | null;
		/** 正在切换/创建中：禁用操作按钮。 */
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
</script>

<div class="home">
	<header class="home-head">
		<div class="home-brand">
			<span class="brand-mark" aria-hidden="true"></span>
			<span>CosBox</span>
		</div>
		<p class="home-sub">状态驱动的 AI 角色扮演客户端 —— 选择一个工作区开始</p>
	</header>
	<WorkspaceManager
		{workspaces}
		{currentId}
		{busy}
		{onEnter}
		{onCreate}
		{onRename}
		{onDuplicate}
		{onDelete}
		{onExport}
		{onImportFile}
	/>
</div>
