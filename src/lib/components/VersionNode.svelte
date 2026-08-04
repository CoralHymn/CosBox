<script lang="ts">
	import type { SnapshotNode } from '../core/types';
	import { formatDateTime } from '../utils/format';
	import VersionNode from './VersionNode.svelte';

	interface Props {
		node: SnapshotNode;
		childrenMap: Map<string, SnapshotNode[]>;
		headId: string | null;
		onCheckout: (id: string) => void;
	}

	let { node, childrenMap, headId, onCheckout }: Props = $props();

	const typeLabel: Record<SnapshotNode['metadata']['type'], string> = {
		root: '初始',
		state: '状态',
		message: '消息',
		checkpoint: '检查点'
	};

	const children = $derived(childrenMap.get(node.id) ?? []);
	const isBranchPoint = $derived(children.length > 1);
</script>

<div class="version-node" class:head={node.id === headId} class:branch-point={isBranchPoint}>
	<div class="version-row">
		<span class="badge {node.metadata.type}">{typeLabel[node.metadata.type]}</span>
		<span class="version-desc" title={node.metadata.desc}>{node.metadata.desc}</span>
		<span class="muted">{formatDateTime(node.timestamp)}</span>
		{#if isBranchPoint}
			<span class="badge tip">分支点</span>
		{/if}
		{#if node.id === headId}
			<span class="badge current">当前</span>
		{:else}
			<button class="btn btn-small" onclick={() => onCheckout(node.id)}>切换</button>
		{/if}
	</div>
	{#each children as child (child.id)}
		<VersionNode node={child} {childrenMap} {headId} {onCheckout} />
	{/each}
</div>
