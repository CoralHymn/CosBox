<script lang="ts">
	import { collectLinearChain } from '../core/snapshot';
	import type { SnapshotNode } from '../core/types';
	import { formatDateTime } from '../utils/format';
	import VersionNode from './VersionNode.svelte';

	interface Props {
		node: SnapshotNode;
		childrenMap: Map<string, SnapshotNode[]>;
		headId: string | null;
		onCheckout: (id: string) => void;
		/** 分支点下的节点向右缩进；单链节点平级显示，避免快照树无限向右延伸。 */
		indented?: boolean;
	}

	let { node, childrenMap, headId, onCheckout, indented = false }: Props = $props();

	const typeLabel: Record<SnapshotNode['metadata']['type'], string> = {
		root: '初始',
		state: '状态',
		message: '消息',
		checkpoint: '检查点'
	};

	const chain = $derived(collectLinearChain(childrenMap, node));
	const tail = $derived(chain[chain.length - 1]);
	const branchChildren = $derived(tail === undefined ? [] : (childrenMap.get(tail.id) ?? []));
</script>

<div class="version-node" class:indented>
	{#each chain as item (item.id)}
		<div class="version-row" class:head={item.id === headId}>
			<span class="badge {item.metadata.type}">{typeLabel[item.metadata.type]}</span>
			<span class="version-desc" title={item.metadata.desc}>{item.metadata.desc}</span>
			<span class="muted">{formatDateTime(item.timestamp)}</span>
			{#if (childrenMap.get(item.id) ?? []).length > 1}
				<span class="badge tip">分支点</span>
			{/if}
			{#if item.id === headId}
				<span class="badge current">当前</span>
			{:else}
				<button class="btn btn-small" onclick={() => onCheckout(item.id)}>切换</button>
			{/if}
		</div>
	{/each}
	{#if branchChildren.length > 1}
		<div class="branch-children">
			{#each branchChildren as child (child.id)}
				<VersionNode node={child} {childrenMap} {headId} {onCheckout} indented={true} />
			{/each}
		</div>
	{/if}
</div>
