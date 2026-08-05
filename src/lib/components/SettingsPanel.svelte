<script lang="ts">
	import { findModelInfo } from '../llm/model-info';
	import type { FetchedModel } from '../llm/model-service';
	import { CUSTOM_PROVIDER_ID, findProviderPreset, LLM_PROVIDER_PRESETS } from '../llm/providers';
	import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
	import type { WebSearchProvider } from '../search/types';
	import type { AppProfile } from '../stores/settings.svelte';
	import ModelCombobox from './ModelCombobox.svelte';

	interface Props {
		config: LlmConfig;
		profile: AppProfile;
		developerMode: boolean;
		onSaveConfig: (config: LlmConfig) => Promise<void>;
		onSaveProfile: (profile: AppProfile) => Promise<void>;
		onResetProfile: () => Promise<void>;
		onSaveDeveloperMode: (enabled: boolean) => Promise<void>;
		onFetchModels: (draft: LlmConfig) => Promise<FetchedModel[]>;
		onTestConnection: (draft: LlmConfig) => Promise<void>;
		onExportWorkspace: () => void;
		onImportWorkspace: (file: File) => Promise<void>;
	}

	let {
		config,
		profile,
		developerMode,
		onSaveConfig,
		onSaveProfile,
		onResetProfile,
		onSaveDeveloperMode,
		onFetchModels,
		onTestConnection,
		onExportWorkspace,
		onImportWorkspace
	}: Props = $props();

	/** 服务商选择：'demo' | 预设 id | CUSTOM_PROVIDER_ID。 */
	let presetSelection = $state<string>('demo');
	let baseUrl = $state('');
	let apiKey = $state('');
	let model = $state('');
	let temperature = $state(0.8);
	let maxTokens = $state(4096);
	let modelContextWindow = $state<number | undefined>(undefined);
	let autoCompact = $state(true);
	let compactThreshold = $state(0.8);
	let stream = $state(false);
	let allowAiStateTools = $state(false);
	let devMode = $state(false);
	let profileName = $state('');
	let systemPrompt = $state('');
	let saving = $state(false);
	let fetchingModels = $state(false);
	let testingConnection = $state(false);
	let workspaceInput = $state<HTMLInputElement | null>(null);
	/** 「获取模型列表」拉取到的模型 id 与上下文窗口。 */
	let availableModels = $state<string[]>([]);
	let modelContexts = $state<Record<string, number>>({});

	/** 网络搜索配置草稿。 */
	let searchEnabled = $state(false);
	let searchProvider = $state<WebSearchProvider>('tavily');
	let searchApiKey = $state('');
	let searchMaxResults = $state(5);

	const currentPreset = $derived(findProviderPreset(presetSelection));
	/** 模型候选：拉取到列表后优先使用服务端列表，否则回退预设建议。 */
	const modelCandidates = $derived(
		availableModels.length > 0 ? availableModels : (currentPreset?.models ?? [])
	);

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
		modelContextWindow = config.modelContextWindow;
		autoCompact = config.autoCompact !== false;
		compactThreshold = config.compactThreshold ?? 0.8;
		stream = config.stream === true;
		allowAiStateTools = config.allowAiStateTools === true;
		searchEnabled = config.webSearch.enabled;
		searchProvider = config.webSearch.provider;
		searchApiKey = config.webSearch.apiKey;
		searchMaxResults = config.webSearch.maxResults;
		profileName = profile.name;
		systemPrompt = profile.systemPrompt ?? '';
		devMode = developerMode;
	});

	/** 切换服务商：选中预设时自动填充地址与默认模型。 */
	function selectProvider(id: string): void {
		presetSelection = id;
		if (id === 'demo' || id === CUSTOM_PROVIDER_ID) {
			modelContextWindow = undefined;
			return;
		}
		const preset = findProviderPreset(id);
		if (!preset) {
			presetSelection = CUSTOM_PROVIDER_ID;
			modelContextWindow = undefined;
			return;
		}
		baseUrl = preset.baseUrl;
		model = preset.defaultModel;
		modelContextWindow = findModelInfo(preset.defaultModel)?.contextWindow;
	}

	/** 从当前表单构建完整配置草稿（保存、获取模型列表、连接测试共用）。 */
	function buildConfig(): LlmConfig {
		return {
			provider: presetSelection === 'demo' ? 'demo' : 'openai-compatible',
			providerId: presetSelection === 'demo' ? CUSTOM_PROVIDER_ID : presetSelection,
			baseUrl: baseUrl.trim(),
			apiKey: apiKey.trim(),
			model: model.trim() || DEFAULT_LLM_CONFIG.model,
			temperature: Math.min(2, Math.max(0, temperature)),
			maxTokens: Math.max(1, Math.floor(maxTokens)),
			modelContextWindow,
			autoCompact,
			compactThreshold,
			stream,
			allowAiStateTools,
			webSearch: {
				enabled: searchEnabled,
				provider: searchProvider,
				apiKey: searchApiKey.trim(),
				maxResults: Math.min(10, Math.max(1, Math.floor(searchMaxResults)))
			}
		};
	}

	async function save(): Promise<void> {
		saving = true;
		try {
			// 先捕获输入值：await 期间 $effect 会用旧 profile 覆盖本地字段，避免保存空值。
			const name = profileName.trim();
			const prompt = systemPrompt.trim() || null;
			const dev = devMode;
			await onSaveConfig(buildConfig());
			await onSaveProfile({ name, systemPrompt: prompt });
			await onSaveDeveloperMode(dev);
		} finally {
			saving = false;
		}
	}

	/** 「回到默认」仅重置角色档案，不动其他设置。 */
	async function resetProfile(): Promise<void> {
		await onResetProfile();
	}

	/** 拉取模型列表并填充 datalist；自动补全当前模型的上下文窗口。 */
	async function fetchModels(): Promise<void> {
		if (presetSelection === 'demo') {
			return;
		}
		fetchingModels = true;
		try {
			const models = await onFetchModels(buildConfig());
			availableModels = models.map((entry) => entry.id);
			const contexts: Record<string, number> = {};
			for (const entry of models) {
				if (entry.contextWindow !== undefined) {
					contexts[entry.id] = entry.contextWindow;
				}
			}
			modelContexts = contexts;
			const known = contexts[model.trim()];
			if (known !== undefined) {
				modelContextWindow = known;
			}
		} finally {
			fetchingModels = false;
		}
	}

	/** 连接测试：验证当前草稿的端点和 Key。 */
	async function test(): Promise<void> {
		if (presetSelection === 'demo') {
			return;
		}
		testingConnection = true;
		try {
			await onTestConnection(buildConfig());
		} finally {
			testingConnection = false;
		}
	}

	async function onImportFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file === undefined) {
			return;
		}
		try {
			await onImportWorkspace(file);
		} finally {
			input.value = '';
		}
	}

	/** 输入/选中模型时，若已拉取到该模型的上下文窗口则自动填充。 */
	function onModelChange(next: string): void {
		model = next;
		const known = modelContexts[model.trim()];
		if (known !== undefined) {
			modelContextWindow = known;
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
				<ModelCombobox
					value={model}
					candidates={modelCandidates}
					inputId="llm-model"
					placeholder="模型 id（点击选择或直接输入）"
					onChange={onModelChange}
				/>
				<p class="muted" style="margin-top: 2px;">
					上下文窗口：{modelContextWindow ?? findModelInfo(model.trim())?.contextWindow ?? '未知'} tokens
				</p>
			</div>
			{#if currentPreset?.notes}
				<p class="muted" style="margin-top: 2px;">{currentPreset.notes}</p>
			{/if}
			<div class="row-actions" style="margin-bottom: 10px;">
				<button
					class="btn btn-small"
					onclick={fetchModels}
					disabled={fetchingModels || testingConnection}
				>
					{fetchingModels ? '获取中…' : '获取模型列表'}
				</button>
				<button class="btn btn-small" onclick={test} disabled={fetchingModels || testingConnection}>
					{testingConnection ? '测试中…' : '连接测试'}
				</button>
			</div>
			{#if availableModels.length > 0}
				<p class="muted" style="margin: 0 0 10px;">
					已获取 {availableModels.length} 个模型；选择或输入已知模型后自动填充上下文窗口。
				</p>
			{:else}
				<p class="muted" style="margin: 0 0 10px;">
					获取模型列表将拉取该端点支持的模型并替代写死的候选列表；连接测试用于验证地址与 Key
					是否有效。
				</p>
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
				<label for="llm-max-tokens">Max Tokens（单次回复最大输出）</label>
				<input id="llm-max-tokens" class="input" type="number" bind:value={maxTokens} />
				<p class="muted" style="margin-top: 2px;">
					限制一次回复最多生成的 token 数（请求中的 max_tokens），不是上下文总长度；
					自动压缩时也会预留这么多作为输出预算。思考型模型（如 DeepSeek R1）的
					思考与正文共享该预算：设置过小（如 1024）会导致思考耗尽预算、正文为空， 建议 4096 以上。
				</p>
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
		<h3 class="card-title">AI 行为</h3>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input id="stream-enabled" class="checkbox" type="checkbox" bind:checked={stream} />
			<label for="stream-enabled" class="muted">流式输出（边生成边显示回复）</label>
		</div>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input
				id="ai-tools-enabled"
				class="checkbox"
				type="checkbox"
				bind:checked={allowAiStateTools}
			/>
			<label for="ai-tools-enabled" class="muted"
				>允许 AI 自主修改状态（地点 / 时间 / 穿着 / 属性）</label
			>
		</div>
		<p class="muted" style="margin: 0;">
			开启后，AI
			可在剧情中自行调用工具更新状态并生成快照，你可以在版本页回溯；关闭则保持纯文本回复。
		</p>
	</div>

	<div class="card">
		<h3 class="card-title">上下文压缩</h3>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input
				id="auto-compact-enabled"
				class="checkbox"
				type="checkbox"
				bind:checked={autoCompact}
			/>
			<label for="auto-compact-enabled" class="muted">自动压缩（接近上限时总结早期对话）</label>
		</div>
		<div class="field">
			<label for="compact-threshold">触发阈值：{Math.round(compactThreshold * 100)}%</label>
			<input
				id="compact-threshold"
				type="range"
				min="0.5"
				max="0.95"
				step="0.05"
				bind:value={compactThreshold}
				disabled={!autoCompact}
				style="width: 100%;"
			/>
		</div>
		<p class="muted" style="margin: 0;">
			与 opencode / Chatbox 一致：当估算用量（含输出预算）达到阈值时，由模型把早期对话总结成
			延续摘要（保留角色关系、关键事件等细节），最近 20 条消息原样保留；
			聊天记录与快照不受影响，可随时在对话页侧栏「立即压缩」。
		</p>
	</div>

	<div class="card">
		<h3 class="card-title">角色档案</h3>
		<p class="muted" style="margin: 0 0 10px;">默认与内置角色「绫音」一致；可自由修改。</p>
		<div class="field">
			<label for="profile-name">角色名</label>
			<input id="profile-name" class="input" bind:value={profileName} />
		</div>
		<div class="field">
			<label for="profile-prompt">系统提示（可选，覆盖默认模板）</label>
			<textarea id="profile-prompt" class="textarea" bind:value={systemPrompt}></textarea>
		</div>
		<button class="btn" onclick={resetProfile}>回到默认</button>
	</div>

	<div class="card">
		<h3 class="card-title">开发者功能</h3>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input id="dev-mode-enabled" class="checkbox" type="checkbox" bind:checked={devMode} />
			<label for="dev-mode-enabled" class="muted">开发者模式</label>
		</div>
		<p class="muted" style="margin: 0;">
			开启后，在对话页可展开查看最近一次实际发送给 AI 的完整提示词（系统消息 + 全部消息）。
		</p>
	</div>

	<div class="card">
		<h3 class="card-title">工作区</h3>
		<p class="muted" style="margin: 0 0 10px;">
			导出全部数据（对话快照、地点库/衣柜/日程、世界书、角色档案等）， 以 .cbox
			压缩包保存；导入会整体恢复。不含模型配置，API Key 不会泄露。
		</p>
		<div class="row-actions">
			<button class="btn" onclick={onExportWorkspace}>导出工作区</button>
			<button class="btn" onclick={() => workspaceInput?.click()}>导入工作区</button>
			<input
				bind:this={workspaceInput}
				type="file"
				accept=".cbox"
				style="display: none;"
				onchange={onImportFile}
			/>
		</div>
	</div>

	<button class="btn btn-primary" onclick={save} disabled={saving}>保存设置</button>
</div>
