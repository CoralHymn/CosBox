<script lang="ts">
	import type { WorkspaceAvatar } from '../workspace/types';

	interface Props {
		/** 工作区名（默认首字与标题展示）。 */
		name: string;
		/** 当前头像（未设置时为 undefined）。 */
		avatar: WorkspaceAvatar | undefined;
		/** 移动端全屏形态；桌面端为居中模态框。 */
		fullscreen?: boolean;
		/** 保存：undefined 表示恢复默认头像。 */
		onSave: (avatar: WorkspaceAvatar | undefined) => void;
		onClose: () => void;
	}

	let { name, avatar, fullscreen = false, onSave, onClose }: Props = $props();

	/** 头像底色色板（glyph 模式）。 */
	const SWATCH_COLORS = [
		'#6d8dff',
		'#c98a4b',
		'#5a6478',
		'#4ade80',
		'#f472b6',
		'#a78bfa',
		'#38bdf8',
		'#f97316'
	];
	/** 常用首字/表情候选（也可手动输入）。 */
	const GLYPH_PRESETS = ['🐱', '🦊', '🌙', '🔥', '🎭', '🌸', '⚔️', '🤖'];

	/** 编辑草稿；null 表示「恢复默认」（保存时传 undefined）。
	 * 组件由宿主 `{#if}` 条件挂载，每次打开都是新实例，取初始值即可。 */
	// svelte-ignore state_referenced_locally
	let draft = $state<WorkspaceAvatar | null>(avatar ?? null);
	/** 图片读取/超限等本地错误提示。 */
	let uploadError = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	/** glyph 草稿当前值（image 草稿时按名称首字展示候选）。 */
	const draftGlyph = $derived(
		draft !== null && draft.kind === 'glyph' ? draft.glyph : ([...name][0] ?? '工')
	);
	const draftColor = $derived(
		draft !== null && draft.kind === 'glyph' ? draft.color : SWATCH_COLORS[0]!
	);

	function pickColor(color: string): void {
		draft = { kind: 'glyph', color, glyph: draftGlyph };
	}

	function pickGlyph(glyph: string): void {
		draft = { kind: 'glyph', color: draftColor, glyph };
	}

	/** 上传图片：读成 data URL 存为 image 头像（过大时提示不写入）。 */
	function handleFileSelected(event: Event): void {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (file === undefined) {
			return;
		}
		uploadError = '';
		if (file.size > 4 * 1024 * 1024) {
			uploadError = '图片超过 4MB，请压缩后再试';
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === 'string') {
				draft = { kind: 'image', image: reader.result };
			}
		};
		reader.onerror = () => {
			uploadError = '图片读取失败，请换一张试试';
		};
		reader.readAsDataURL(file);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="ae-backdrop" class:fullscreen role="presentation" onclick={onClose}>
	<div
		class="ae-modal"
		role="dialog"
		aria-label="编辑角色头像"
		tabindex="-1"
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => event.stopPropagation()}
	>
		{#if fullscreen}
			<div class="ae-head">
				<button class="btn btn-small" onclick={onClose}>返回</button>
				<span class="ae-title">编辑角色头像</span>
				<span class="ae-head-spacer"></span>
			</div>
		{:else}
			<div class="ae-head">
				<span class="ae-title">编辑「{name}」的头像</span>
				<button class="btn btn-small" aria-label="关闭" onclick={onClose}>✕</button>
			</div>
		{/if}

		<div class="ae-preview-wrap">
			{#if draft === null}
				<span class="ae-preview ae-preview-default">{[...name][0] ?? '工'}</span>
			{:else if draft.kind === 'image'}
				<span class="ae-preview"><img src={draft.image} alt="头像预览" /></span>
			{:else}
				<span class="ae-preview" style={`background:${draft.color}`}>{draft.glyph}</span>
			{/if}
		</div>

		<span class="ae-label">底色</span>
		<div class="ae-swatches">
			{#each SWATCH_COLORS as color (color)}
				<button
					class="ae-swatch"
					class:active={draft !== null && draft.kind === 'glyph' && draft.color === color}
					style={`background:${color}`}
					aria-label={`选择底色 ${color}`}
					onclick={() => pickColor(color)}
				></button>
			{/each}
		</div>

		<span class="ae-label">首字 / 表情</span>
		<div class="ae-chars">
			<button
				class="ae-char"
				class:active={draft !== null &&
					draft.kind === 'glyph' &&
					draft.glyph === ([...name][0] ?? '')}
				aria-label="使用名称首字"
				onclick={() => pickGlyph([...name][0] ?? '工')}>{[...name][0] ?? '工'}</button
			>
			{#each GLYPH_PRESETS as glyph (glyph)}
				<button
					class="ae-char"
					class:active={draft !== null && draft.kind === 'glyph' && draft.glyph === glyph}
					onclick={() => pickGlyph(glyph)}>{glyph}</button
				>
			{/each}
			<input
				class="input ae-glyph-input"
				placeholder="自定义"
				maxlength={4}
				aria-label="自定义首字或表情"
				onchange={(event) => {
					const value = (event.currentTarget as HTMLInputElement).value.trim();
					if (value !== '') {
						pickGlyph(value);
					}
				}}
			/>
		</div>

		<button class="ae-upload" onclick={() => fileInput?.click()}>🖼 上传自定义图片…</button>
		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			class="ae-file-input"
			onchange={handleFileSelected}
		/>
		{#if uploadError !== ''}
			<p class="ae-error">{uploadError}</p>
		{/if}

		<div class="ae-actions">
			<button class="btn btn-small" onclick={() => onSave(undefined)}>恢复默认</button>
			{#if !fullscreen}
				<button class="btn btn-small" onclick={onClose}>取消</button>
			{/if}
			<button
				class="btn btn-small btn-primary"
				disabled={draft === null && avatar === undefined}
				onclick={() => onSave(draft ?? undefined)}
			>
				保存
			</button>
		</div>
	</div>
</div>

<style>
	.ae-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(4, 6, 10, 0.6);
		z-index: 110;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}
	.ae-backdrop.fullscreen {
		padding: 0;
		background: var(--bg);
	}
	.ae-modal {
		width: min(380px, 100%);
		max-height: 90vh;
		overflow-y: auto;
		background: var(--panel);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ae-backdrop.fullscreen .ae-modal {
		width: 100%;
		height: 100%;
		max-height: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px));
		padding-top: calc(14px + env(safe-area-inset-top, 0px));
	}
	.ae-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.ae-head-spacer {
		width: 52px;
		flex: none;
	}
	.ae-title {
		font-size: 14px;
		font-weight: 700;
		flex: 1;
		text-align: center;
	}
	.ae-backdrop:not(.fullscreen) .ae-title {
		text-align: left;
	}
	.ae-preview-wrap {
		display: flex;
		justify-content: center;
	}
	.ae-preview {
		width: 92px;
		height: 92px;
		border-radius: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 40px;
		font-weight: 700;
		color: #fff;
		border: 1px solid var(--border-strong);
		overflow: hidden;
	}
	.ae-preview-default {
		background: var(--panel-2);
		color: var(--text-dim);
	}
	.ae-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.ae-label {
		font-size: 12px;
		color: var(--text-dim);
	}
	.ae-swatches {
		display: flex;
		gap: 9px;
		flex-wrap: wrap;
	}
	.ae-swatch {
		width: 32px;
		height: 32px;
		border-radius: 9px;
		border: 2px solid transparent;
		cursor: pointer;
	}
	.ae-swatch.active {
		border-color: #fff;
	}
	.ae-chars {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
		align-items: center;
	}
	.ae-char {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text);
		font-size: 16px;
		cursor: pointer;
	}
	.ae-char.active {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.ae-glyph-input {
		width: 84px;
	}
	.ae-upload {
		padding: 10px;
		border-radius: 8px;
		border: 1px dashed var(--border-strong);
		background: none;
		color: var(--text-dim);
		font-size: 13px;
		cursor: pointer;
	}
	.ae-upload:hover {
		color: var(--text);
	}
	.ae-file-input {
		display: none;
	}
	.ae-error {
		margin: 0;
		font-size: 12px;
		color: var(--err);
	}
	.ae-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: auto;
	}
</style>
