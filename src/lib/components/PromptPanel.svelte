<script lang="ts">
	import { defaultSystemPrompt } from '../context/pipeline';
	import { DEFAULT_PROFILE, type AppProfile } from '../stores/settings.svelte';

	interface Props {
		profile: AppProfile;
		onSaveProfile: (profile: AppProfile) => Promise<void>;
	}

	let { profile, onSaveProfile }: Props = $props();

	let systemPrompt = $state('');
	let characterPrompt = $state('');
	let userPrompt = $state('');
	let worldPrompt = $state('');
	let stylePrompt = $state('');
	let saving = $state(false);

	$effect(() => {
		systemPrompt = profile.systemPrompt ?? '';
		characterPrompt = profile.characterPrompt ?? '';
		userPrompt = profile.userPrompt ?? '';
		worldPrompt = profile.worldPrompt ?? '';
		stylePrompt = profile.stylePrompt ?? '';
	});

	async function save(): Promise<void> {
		saving = true;
		try {
			const next: AppProfile = {
				...profile,
				systemPrompt: systemPrompt.trim() || null,
				characterPrompt: characterPrompt.trim() || null,
				userPrompt: userPrompt.trim() || null,
				worldPrompt: worldPrompt.trim() || null,
				stylePrompt: stylePrompt.trim() || null
			};
			await onSaveProfile(next);
		} finally {
			saving = false;
		}
	}

	/** 只重置五段提示词；角色名仍在「设置」页维护。 */
	async function reset(): Promise<void> {
		saving = true;
		try {
			const name = profile.name.trim() || DEFAULT_PROFILE.name;
			const next: AppProfile = {
				...profile,
				name,
				systemPrompt: defaultSystemPrompt(name),
				characterPrompt: null,
				userPrompt: null,
				worldPrompt: null,
				stylePrompt: null
			};
			await onSaveProfile(next);
		} finally {
			saving = false;
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">提示词</h2>
	<p class="panel-sub">
		五段提示词会在每次对话时按「系统 → 人物 → 用户认知 → 世界观 → 风格」的顺序组装进系统消息；
		留空的段落不会注入。修改后点击保存，立即对下一次对话生效。
	</p>

	<div class="card">
		<h3 class="card-title">系统提示词</h3>
		<p class="muted" style="margin: 0 0 10px;">
			这里放回复规则或破甲词。原「设置 → 角色档案 → 系统提示」的内容已迁移到这里；
			留空时使用内置默认模板 （角色身份 + 当前状态约束）。
		</p>
		<div class="field">
			<textarea
				id="prompt-system"
				class="textarea prompt-textarea"
				bind:value={systemPrompt}
				placeholder="留空则使用内置默认模板"></textarea>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">人物提示词</h3>
		<p class="muted" style="margin: 0 0 10px;">
			这是 AI 扮演的角色提示词：身份、年龄、性格与说话方式。
		</p>
		<div class="field">
			<textarea
				id="prompt-character"
				class="textarea prompt-textarea"
				bind:value={characterPrompt}
				placeholder="例如：你是绫音，16 岁高中女生，性格安静但偶尔毒舌……"></textarea>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">用户提示词</h3>
		<p class="muted" style="margin: 0 0 10px;">这是 AI 对用户的看法：关系、称呼与相处方式。</p>
		<div class="field">
			<textarea
				id="prompt-user"
				class="textarea prompt-textarea"
				bind:value={userPrompt}
				placeholder="例如：用户是你的同班同学，与你相识多年……"></textarea>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">世界观提示词</h3>
		<p class="muted" style="margin: 0 0 10px;">字面意思：故事发生在怎样的世界里。</p>
		<div class="field">
			<textarea
				id="prompt-world"
				class="textarea prompt-textarea"
				bind:value={worldPrompt}
				placeholder="例如：故事发生在一座现代虚拟学园，表面平静但存在超自然角落……"></textarea>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">风格提示词</h3>
		<p class="muted" style="margin: 0 0 10px;">
			期望的文风，例如鲁迅的白描与冷峻，或余华的冷静克制笔触。
		</p>
		<div class="field">
			<textarea
				id="prompt-style"
				class="textarea prompt-textarea"
				bind:value={stylePrompt}
				placeholder="例如：使用余华式的冷静克制笔触，少用形容词，多用短句……"></textarea>
		</div>
	</div>

	<div class="row-actions">
		<button class="btn btn-primary" onclick={save} disabled={saving}>保存提示词</button>
		<button class="btn" onclick={reset} disabled={saving}>恢复默认提示词</button>
		{#if saving}<span class="muted">保存中…</span>{/if}
	</div>
</div>

<style>
	.prompt-textarea {
		min-height: 150px;
		line-height: 1.6;
	}
</style>
