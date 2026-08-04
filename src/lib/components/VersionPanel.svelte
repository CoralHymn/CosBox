<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { chainToRoot, collectBranchPath, getChildrenMap } from '../core/snapshot';
	import type { BranchSummary, SnapshotNode } from '../core/types';
	import { formatDateTime } from '../utils/format';

	interface Props {
		snapshots: SnapshotNode[];
		headId: string | null;
		branches: BranchSummary[];
		onCheckout: (id: string) => void;
		onAddCheckpoint: (desc: string) => void;
		onDeleteBranch: (tipId: string) => void;
	}

	let { snapshots, headId, branches, onCheckout, onAddCheckpoint, onDeleteBranch }: Props =
		$props();
	let checkpointDesc = $state('');
	/** 默认全部展开；显式收起的分支记录在这里。 */
	let collapsed = new SvelteSet<string>();

	const typeLabel: Record<SnapshotNode['metadata']['type'], string> = {
		root: '初始',
		state: '状态',
		message: '消息',
		checkpoint: '检查点'
	};

	const childrenMap = $derived(getChildrenMap(snapshots));
	const nodeMap = $derived(new SvelteMap(snapshots.map((node) => [node.id, node])));

	interface BranchRow {
		branch: BranchSummary;
		/** 从根到 tip 的完整链（含共享前缀），保证任意节点都可切换。 */
		chain: SnapshotNode[];
		/** 本分支独有的快照数（不含分支点与共享前缀）。 */
		uniqueCount: number;
		/** 分叉来源节点描述；直接分叉自根时为 null。 */
		forkDesc: string | null;
		/** 出现在多条分支链中的共享节点 id（视觉弱化）。 */
		sharedIds: ReadonlySet<string>;
	}

	const branchRows = $derived.by((): BranchRow[] => {
		const rows = branches.map((branch) => {
			const chain = chainToRoot(nodeMap, branch.tipId);
			const unique = collectBranchPath(childrenMap, nodeMap, branch.tipId).reverse();
			const forkId = unique[0]?.parentId;
			const forkPoint = forkId === undefined || forkId === null ? null : (nodeMap.get(forkId) ?? null);
			return {
				branch,
				chain,
				uniqueCount: unique.length,
				forkDesc: forkPoint !== null && forkPoint.parentId !== null ? forkPoint.metadata.desc : null
			};
		});
		const counts: Record<string, number> = {};
		for (const row of rows) {
			for (const node of row.chain) {
				counts[node.id] = (counts[node.id] ?? 0) + 1;
			}
		}
		return rows
			.map((row) => ({
				...row,
				sharedIds: new SvelteSet(
					row.chain.filter((node) => (counts[node.id] ?? 0) > 1).map((node) => node.id)
				)
			}))
			.sort((a, b) => b.branch.lastTimestamp - a.branch.lastTimestamp);
	});

	function toggleCollapsed(tipId: string): void {
		if (collapsed.has(tipId)) {
			collapsed.delete(tipId);
		} else {
			collapsed.add(tipId);
		}
	}

	function addCheckpoint(): void {
		onAddCheckpoint(checkpointDesc.trim());
		checkpointDesc = '';
	}
</script>

<div class="panel">
	<h2 class="panel-title">版本与分支</h2>
	<p class="panel-sub">
		所有状态变更与对话都以增量快照存储；切换任意节点会重建该时刻的状态与对话，不影响其他分支。
		删除分支只移除该分支独有的快照；只剩一个分支时不可删除。
	</p>

	<div class="card">
		<h3 class="card-title">分支列表（{branchRows.length}）</h3>
		{#if branchRows.length === 0}
			<p class="empty-hint">暂无分支</p>
		{:else}
			{#each branchRows as row (row.branch.tipId)}
				<div class="branch-card" class:current={row.branch.tipId === headId}>
					<div class="branch-header">
						<span class="badge {row.branch.type}">{typeLabel[row.branch.type]}</span>
						<span class="version-desc" title={row.branch.desc}>{row.branch.desc}</span>
						<span class="muted">{row.chain.length - 1} 个快照</span>
						{#if row.branch.tipId === headId}
							<span class="badge current">当前</span>
						{/if}
						<button class="btn btn-small" onclick={() => toggleCollapsed(row.branch.tipId)}>
							{collapsed.has(row.branch.tipId) ? '展开' : '收起'}
						</button>
						{#if row.branch.tipId !== headId}
							<button class="btn btn-small" onclick={() => onCheckout(row.branch.tipId)}>切换</button>
						{/if}
						<button
							class="btn btn-small btn-danger"
							disabled={branches.length <= 1}
							title={branches.length <= 1 ? '只剩一个分支时不能删除' : '删除该分支独有的快照'}
							onclick={() => onDeleteBranch(row.branch.tipId)}>删除</button
						>
					</div>
					{#if row.forkDesc !== null}
						<p class="muted" style="margin: 0 0 4px;">分叉自：「{row.forkDesc}」</p>
					{/if}
					{#if !collapsed.has(row.branch.tipId)}
						<div class="branch-chain">
							{#each row.chain as node (node.id)}
								<div class="version-row" class:shared={row.sharedIds.has(node.id)}>
									<span class="badge {node.metadata.type}">{typeLabel[node.metadata.type]}</span>
									<span class="version-desc" title={node.metadata.desc}>{node.metadata.desc}</span>
									<span class="muted">{formatDateTime(node.timestamp)}</span>
									{#if node.id === headId}
										<span class="badge current">当前</span>
									{:else}
										<button class="btn btn-small" onclick={() => onCheckout(node.id)}>切换</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<div class="card">
		<h3 class="card-title">创建检查点</h3>
		<div class="row-actions">
			<input class="input" bind:value={checkpointDesc} placeholder="检查点描述（可选）" />
			<button class="btn btn-primary" onclick={addCheckpoint}>保存检查点</button>
		</div>
	</div>
</div>
