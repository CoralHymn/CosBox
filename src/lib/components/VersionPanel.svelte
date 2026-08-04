<script lang="ts">
	import { getChildrenMap } from '../core/snapshot';
	import type { BranchSummary, SnapshotNode } from '../core/types';
	import VersionNode from './VersionNode.svelte';

	interface Props {
		snapshots: SnapshotNode[];
		headId: string | null;
		branches: BranchSummary[];
		onCheckout: (id: string) => void;
		onAddCheckpoint: (desc: string) => void;
	}

	let { snapshots, headId, branches, onCheckout, onAddCheckpoint }: Props = $props();
	let checkpointDesc = $state('');

	const childrenMap = $derived(getChildrenMap(snapshots));
	const roots = $derived(snapshots.filter((node) => node.parentId === null));

	function addCheckpoint(): void {
		onAddCheckpoint(checkpointDesc.trim());
		checkpointDesc = '';
	}
</script>

<div class="panel">
	<h2 class="panel-title">版本时间线</h2>
	<p class="panel-sub">
		所有状态变更与对话都以增量快照存储；切换节点会重建该时刻的状态与对话，不会影响其他分支。
	</p>

	<div class="card">
		<h3 class="card-title">分支</h3>
		{#if branches.length === 0}
			<p class="empty-hint">暂无分支</p>
		{:else}
			{#each branches as branch (branch.tipId)}
				<div class="list-row">
					<span class="badge tip">分支</span>
					<span class="version-desc">{branch.desc}</span>
					<span class="muted">深度 {branch.depth}</span>
					{#if branch.tipId !== headId}
						<button class="btn btn-small" onclick={() => onCheckout(branch.tipId)}>切换</button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<div class="card">
		<h3 class="card-title">快照树</h3>
		{#each roots as root (root.id)}
			<VersionNode node={root} {childrenMap} {headId} {onCheckout} />
		{/each}
	</div>

	<div class="card">
		<h3 class="card-title">创建检查点</h3>
		<div class="row-actions">
			<input class="input" bind:value={checkpointDesc} placeholder="检查点描述（可选）" />
			<button class="btn btn-primary" onclick={addCheckpoint}>保存检查点</button>
		</div>
	</div>
</div>
