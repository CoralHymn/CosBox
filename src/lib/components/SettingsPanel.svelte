<script lang="ts">
	import { CUSTOM_PROVIDER_ID, findProviderPreset, LLM_PROVIDER_PRESETS } from '../llm/providers';
	import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
	import type { WebSearchProvider } from '../search/types';
	import type { AppProfile } from '../stores/settings.svelte';

	interface Props {
		config: LlmConfig;
		profile: AppProfile;
		onSaveConfig: (config: LlmConfig) => Promise<void>;
		onSaveProfile: (profile: AppProfile) => Promise<void>;
	}

	let { config, profile, onSaveConfig, onSaveProfile }: Props = $props();

	/** 服务商选择：'demo' | 预设 id | CUSTOM_PROVIDER_ID。 */
	let presetSelection = $state<string>('demo');
	let baseUrl = $state('');
	let apiKey = $state('');
	let model = $state('');
	let temperature = $state(0.8);
	let maxTokens = $state(1024);
	let profileName = $state('');
	let systemPrompt = $state('');
	let saving = $state(false);

	/** 网络搜索配置草稿。 */
	let searchEnabled = $state(false);
	let searchProvider = $state<WebSearchProvider>('tavily');
	let searchApiKey = $state('');
	let searchMaxResults = $state(5);

	const currentPreset = $derived(findProviderPreset(presetSelection));

	$effect(() => {
		presetSelection =
			config.provider === 'demo'
				? 'demo'
				: findProviderPreset(config.providerId)
					? config.providerId
					: CUSTOM_PROVIDER_ID;
		baseUrl = config.baseUrl;
		apiKey = config.apiKey;
		model = config.model;
		temperature = config.temperature;
		maxTokens = config.maxTokens;
		searchEnabled = config.webSearch.enabled;
		searchProvider = config.webSearch.provider;
		searchApiKey = config.webSearch.apiKey;
		searchMaxResults = config.webSearch.maxResults;
		profileName = profile.name;
		systemPrompt = profile.systemPrompt ?? '';
	});

	/** 切换服务商：选中预设时自动填充地址与默认模型。 */
	function selectProvider(id: string): void {
		presetSelection = id;
		if (id === 'demo' || id === CUSTOM_PROVIDER_ID) {
			return;
		}
		const preset = findProviderPreset(id);
		if (!preset) {
			presetSelection = CUSTOM_PROVIDER_ID;
			return;
		}
		baseUrl = preset.baseUrl;
		model = preset.defaultModel;
	}

	async function save(): Promise<void> {
		saving = true;
		try {
			await onSaveConfig({
				provider: presetSelection === 'demo' ? 'demo' : 'openai-compatible',
				providerId: presetSelection === 'demo' ? CUSTOM_PROVIDER_ID : presetSelection,
				baseUrl: baseUrl.trim(),
				apiKey: apiKey.trim(),
				model: model.trim() || DEFAULT_LLM_CONFIG.model,
				temperature: Math.min(2, Math.max(0, temperature)),
				maxTokens: Math.max(1, Math.floor(maxTokens)),
				webSearch: {
					enabled: searchEnabled,
					provider: searchProvider,
					apiKey: searchApiKey.trim(),
					maxResults: Math.min(10, Math.max(1, Math.floor(searchMaxResults)))
				}
			});
			await onSaveProfile({ name: profileName.trim(), systemPrompt: systemPrompt.trim() || null });
		} finally {
			saving = false;
		}
	}
</script>

<div class="panel">
	<h2 class="panel-title">设置</h2>
	<p class="panel-sub">
		LLM 接入与角色档案。内置演示模式开箱即用；切换到任一主流服务商预设会自动填充兼容端点与常用模型。
	</p>

	<div class="card">
		<h3 class="card-title">模型服务</h3>
		<div class="field">
			<label for="llm-provider">服务商</label>
			<select
				id="llm-provider"
				class="select"
				value={presetSelection}
				onchange={(event) => selectProvider((event.currentTarget as HTMLSelectElement).value)}
			>
				<option value="demo">内置演示（离线）</option>
				{#each LLM_PROVIDER_PRESETS as preset (preset.id)}
					<option value={preset.id}>{preset.label}</option>
				{/each}
				<option value={CUSTOM_PROVIDER_ID}>自定义（OpenAI-compatible）</option>
			</select>
		</div>

		{#if presetSelection !== 'demo'}
			<div class="field">
				<label for="llm-base-url">Base URL（OpenAI 兼容端点）</label>
				<input
					id="llm-base-url"
					class="input"
					bind:value={baseUrl}
					placeholder="https://api.example.com/v1"
				/>
			</div>
			<div class="field">
				<label for="llm-api-key">API Key</label>
				<input
					id="llm-api-key"
					class="input"
					type="password"
					bind:value={apiKey}
					placeholder={currentPreset?.requiresApiKey === false
						? '本地服务通常无需 Key'
						: 'your-api-key'}
				/>
			</div>
			<div class="field">
				<label for="llm-model">模型</label>
				<input
					id="llm-model"
					class="input"
					bind:value={model}
					list="llm-model-list"
					placeholder="模型 id"
				/>
				<datalist id="llm-model-list">
					{#each currentPreset?.models ?? [] as candidate (candidate)}
						<option value={candidate}></option>
					{/each}
				</datalist>
			</div>
			{#if currentPreset?.notes}
				<p class="muted" style="margin-top: 2px;">{currentPreset.notes}</p>
			{/if}
		{/if}

		<div class="grid-2">
			<div class="field">
				<label for="llm-temperature">Temperature（{temperature.toFixed(1)}）</label>
				<input
					id="llm-temperature"
					type="range"
					min="0"
					max="2"
					step="0.1"
					bind:value={temperature}
					style="width: 100%;"
				/>
			</div>
			<div class="field">
				<label for="llm-max-tokens">Max Tokens</label>
				<input id="llm-max-tokens" class="input" type="number" bind:value={maxTokens} />
			</div>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">网络搜索</h3>
		<p class="muted" style="margin: 0 0 10px;">
			发送消息时可附带实时搜索结果注入上下文（Tavily / Serper / Brave）。
		</p>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input id="search-enabled" class="checkbox" type="checkbox" bind:checked={searchEnabled} />
			<label for="search-enabled" class="muted">启用搜索</label>
		</div>
		{#if searchEnabled}
			<div class="grid-2">
				<div class="field">
					<label for="search-provider">服务商</label>
					<select id="search-provider" class="select" bind:value={searchProvider}>
						<option value="tavily">Tavily</option>
						<option value="serper">Serper (Google)</option>
						<option value="brave">Brave Search</option>
					</select>
				</div>
				<div class="field">
					<label for="search-max-results">结果数（1-10）</label>
					<input
						id="search-max-results"
						class="input"
						type="number"
						min="1"
						max="10"
						bind:value={searchMaxResults}
					/>
				</div>
			</div>
			<div class="field">
				<label for="search-api-key">搜索 API Key</label>
				<input
					id="search-api-key"
					class="input"
					type="password"
					bind:value={searchApiKey}
					placeholder="your-api-key"
				/>
			</div>
		{/if}
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
