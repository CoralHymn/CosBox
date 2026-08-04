<script lang="ts">
	interface Props {
		onImport: (text: string) => Promise<void>;
		onExport: () => void;
	}

	let { onImport, onExport }: Props = $props();
	let importText = $state('');
	let importing = $state(false);

	async function importCard(): Promise<void> {
		importing = true;
		try {
			await onImport(importText);
			importText = '';
		} finally {
			importing = false;
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">SillyTavern V3 角色卡</h2>
	<p class="panel-sub">
		导入会把文本型设定映射为世界书条目，名称写入属性；导出会把当前内容序列化为 chara_card_v3 JSON。
	</p>

	<div class="card">
		<h3 class="card-title">导入</h3>
		<div class="field">
			<label for="import-text">粘贴角色卡 JSON</label>
			<textarea
				id="import-text"
				class="textarea"
				style="min-height: 180px;"
				bind:value={importText}
				placeholder="粘贴 chara_card_v3 规范的 JSON"></textarea>
		</div>
		<button
			class="btn btn-primary"
			onclick={importCard}
			disabled={importing || importText.trim() === ''}
		>
			{importing ? '导入中…' : '导入角色卡'}
		</button>
	</div>

	<div class="card">
		<h3 class="card-title">导出</h3>
		<p class="muted" style="margin: 0 0 12px;">导出当前角色名、世界书与第一句问候为 V3 角色卡。</p>
		<button class="btn" onclick={onExport}>导出 .chara-v3.json</button>
	</div>
</div>
