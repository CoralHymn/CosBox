<script lang="ts">
	import type { AppProfile } from '../stores/settings.svelte';
	import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';

	interface Props {
		config: LlmConfig;
		profile: AppProfile;
		onSaveConfig: (config: LlmConfig) => Promise<void>;
		onSaveProfile: (profile: AppProfile) => Promise<void>;
	}

	let { config, profile, onSaveConfig, onSaveProfile }: Props = $props();

	let provider = $state<LlmConfig['provider']>('demo');
	let baseUrl = $state('');
	let apiKey = $state('');
	let model = $state('');
	let temperature = $state(0.8);
	let maxTokens = $state(1024);
	let profileName = $state('');
	let systemPrompt = $state('');
	let saving = $state(false);

	$effect(() => {
		provider = config.provider;
		baseUrl = config.baseUrl;
		apiKey = config.apiKey;
		model = config.model;
		temperature = config.temperature;
		maxTokens = config.maxTokens;
		profileName = profile.name;
		systemPrompt = profile.systemPrompt ?? '';
	});

	async function save(): Promise<void> {
		saving = true;
		try {
			await onSaveConfig({
				provider,
				baseUrl: baseUrl.trim(),
				apiKey: apiKey.trim(),
				model: model.trim() || DEFAULT_LLM_CONFIG.model,
				temperature: Math.min(2, Math.max(0, temperature)),
				maxTokens: Math.max(1, Math.floor(maxTokens))
			});
			await onSaveProfile({ name: profileName.trim(), systemPrompt: systemPrompt.trim() || null });
		} finally {
			saving = false;
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">设置</h2>
	<p class="panel-sub">LLM 接入与角色档案。默认使用内置演示模式，可切换到任意 OpenAI-compatible 端点。</p>

	<div class="card">
		<h3 class="card-title">模型服务</h3>
		<div class="field">
			<label for="llm-provider">Provider</label>
			<select id="llm-provider" class="select" bind:value={provider}>
				<option value="demo">内置演示（离线）</option>
				<option value="openai-compatible">OpenAI-compatible</option>
			</select>
		</div>
		{#if provider === 'openai-compatible'}
			<div class="field">
				<label for="llm-base-url">Base URL（含 /v1）</label>
				<input id="llm-base-url" class="input" bind:value={baseUrl} placeholder="http://localhost:4000/v1" />
			</div>
			<div class="field">
				<label for="llm-api-key">API Key</label>
				<input id="llm-api-key" class="input" type="password" bind:value={apiKey} placeholder="sk-..." />
			</div>
		{/if}
		<div class="field">
			<label for="llm-model">模型</label>
			<input id="llm-model" class="input" bind:value={model} placeholder="gpt-4o-mini" />
		</div>
		<div class="grid-2">
			<div class="field">
				<label for="llm-temperature">Temperature（{temperature.toFixed(1)}）</label>
				<input id="llm-temperature" type="range" min="0" max="2" step="0.1" bind:value={temperature} style="width: 100%;" />
			</div>
			<div class="field">
				<label for="llm-max-tokens">Max Tokens</label>
				<input id="llm-max-tokens" class="input" type="number" bind:value={maxTokens} />
			</div>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">角色档案</h3>
		<div class="field">
			<label for="profile-name">角色名</label>
			<input id="profile-name" class="input" bind:value={profileName} />
		</div>
		<div class="field">
			<label for="profile-prompt">系统提示（可选，覆盖默认模板）</label>
			<textarea id="profile-prompt" class="textarea" bind:value={systemPrompt}></textarea>
		</div>
	</div>

	<button class="btn btn-primary" onclick={save} disabled={saving}>保存设置</button>
</div>
