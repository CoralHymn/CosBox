<script lang="ts">
	import { findModelInfo } from '../llm/model-info';
	import type { FetchedModel } from '../llm/model-service';
	import { CUSTOM_PROVIDER_ID, findProviderPreset, LLM_PROVIDER_PRESETS } from '../llm/providers';
	import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/types';
	import type { WebSearchProvider } from '../search/types';
	import type { AppProfile } from '../stores/settings.svelte';
	import type { SyncResult } from '../sync/sync-service';
	import type { SyncSettings } from '../sync/types';
	import {
		DEFAULT_THEME_CONFIG,
		THEME_PRESETS,
		findThemePreset,
		type ThemeColorKey,
		type ThemeConfig
	} from '../theme/theme';
	import ModelCombobox from './ModelCombobox.svelte';

	interface Props {
		config: LlmConfig;
		profile: AppProfile;
		developerMode: boolean;
		syncSettings: SyncSettings;
		theme: ThemeConfig;
		onSaveConfig: (config: LlmConfig) => Promise<void>;
		onSaveProfile: (profile: AppProfile) => Promise<void>;
		onResetProfile: () => Promise<void>;
		onSaveDeveloperMode: (enabled: boolean) => Promise<void>;
		onSaveSync: (settings: SyncSettings) => Promise<void>;
		onSaveTheme: (theme: ThemeConfig) => Promise<void>;
		onTestSync: (draft: SyncSettings) => Promise<SyncResult>;
		onSyncNow: () => Promise<SyncResult>;
		onFetchModels: (draft: LlmConfig) => Promise<FetchedModel[]>;
		onTestConnection: (draft: LlmConfig) => Promise<void>;
		onExportWorkspace: () => void;
		onImportWorkspace: (file: File) => Promise<void>;
	}

	let {
		config,
		profile,
		developerMode,
		syncSettings,
		theme,
		onSaveConfig,
		onSaveProfile,
		onResetProfile,
		onSaveDeveloperMode,
		onSaveSync,
		onSaveTheme,
		onTestSync,
		onSyncNow,
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
	let llmStateConfirm = $state(false);
	let devMode = $state(false);
	let syncEnabled = $state(false);
	let syncServerUrl = $state('');
	let syncServerKey = $state('');
	let syncStatus = $state('');
	let syncBusy = $state(false);
	let themePresetId = $state(DEFAULT_THEME_CONFIG.presetId);
	let themeColors = $state<Partial<Record<ThemeColorKey, string>>>({});
	let themeBackground = $state('');
	let themeOpacity = $state(1);
	let themeBusy = $state(false);
	let themeInput = $state<HTMLInputElement | null>(null);
	let profileName = $state('');
	let systemPrompt = $state('');
	let saving = $state(false);
	let fetchingModels = $state(false);
	let testingConnection = $state(false);
	let workspaceInput = $state<HTMLInputElement | null>(null);
	/** 「获取模型列表」拉取到的模型 id 与上下文窗口。 */
	let availableModels = $state<string[]>([]);
	let modelContexts = $state<Record<string, number>>({});

	/** 主题颜色项：rgba 项只能文本输入，其余用取色器。 */
	const themeColorKeys: { key: ThemeColorKey; label: string; rgba: boolean }[] = [
		{ key: 'bg', label: '页面背景', rgba: false },
		{ key: 'bg-elevated', label: '顶栏 / 浮层背景', rgba: false },
		{ key: 'panel', label: '卡片背景', rgba: false },
		{ key: 'panel-2', label: '次级面板背景', rgba: false },
		{ key: 'border', label: '边框', rgba: false },
		{ key: 'border-strong', label: '强调边框', rgba: false },
		{ key: 'text', label: '正文文字', rgba: false },
		{ key: 'text-dim', label: '次级文字', rgba: false },
		{ key: 'text-faint', label: '弱化文字', rgba: false },
		{ key: 'accent', label: '主色', rgba: false },
		{ key: 'accent-dim', label: '主色淡背景', rgba: true },
		{ key: 'accent-2', label: '辅助主色', rgba: false },
		{ key: 'ok', label: '成功', rgba: false },
		{ key: 'warn', label: '警告', rgba: false },
		{ key: 'err', label: '错误', rgba: false }
	];

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
		llmStateConfirm = config.llmStateConfirm === true;
		searchEnabled = config.webSearch.enabled;
		searchProvider = config.webSearch.provider;
		searchApiKey = config.webSearch.apiKey;
		searchMaxResults = config.webSearch.maxResults;
		profileName = profile.name;
		systemPrompt = profile.systemPrompt ?? '';
		devMode = developerMode;
		syncEnabled = syncSettings.enabled;
		syncServerUrl = syncSettings.serverUrl;
		syncServerKey = syncSettings.serverKey;
		themePresetId = theme.presetId;
		themeColors = { ...theme.colors };
		themeBackground = theme.backgroundImage;
		themeOpacity = theme.backgroundOpacity;
	});

	/** 当前主题草稿（颜色合并预设默认值，保证变量齐全）。 */
	function buildThemeDraft(): ThemeConfig {
		const base = findThemePreset(themePresetId)?.colors ?? {};
		return {
			presetId: themePresetId,
			colors: { ...base, ...themeColors },
			backgroundImage: themeBackground,
			backgroundOpacity: themeOpacity
		};
	}

	/** 主题保存串行队列：连续修改（如快速切换预设后立刻换图）不丢任何一次。 */
	let themeSaveChain: Promise<void> = Promise.resolve();
	let themePending = 0;

	/** 主题修改即时保存（与其它设置走「保存设置」不同，主题需要实时预览）。 */
	function persistTheme(): void {
		const draft = buildThemeDraft();
		themePending += 1;
		themeBusy = true;
		themeSaveChain = themeSaveChain
			.then(() => onSaveTheme(draft))
			.catch(() => {})
			.finally(() => {
				themePending -= 1;
				if (themePending === 0) {
					themeBusy = false;
				}
			});
	}

	/** 选择预设：用预设完整颜色覆盖并保存。 */
	function selectThemePreset(id: string): void {
		const preset = findThemePreset(id);
		themePresetId = id;
		themeColors = preset ? { ...preset.colors } : {};
		void persistTheme();
	}

	/** 修改单个颜色：切到自定义并即时保存。 */
	function setThemeColor(key: ThemeColorKey, value: string): void {
		themePresetId = 'custom';
		themeColors = { ...themeColors, [key]: value.trim() };
		void persistTheme();
	}

	/** 选择背景图：读取为 data URL 并即时保存。 */
	async function pickThemeBackground(): Promise<void> {
		const file = themeInput?.files?.[0];
		if (file === undefined) {
			return;
		}
		const dataUrl = await readFileAsDataUrl(file);
		themeBackground = dataUrl;
		void persistTheme();
	}

	/** 移除背景图。 */
	function removeThemeBackground(): void {
		themeBackground = '';
		void persistTheme();
	}

	/** 恢复默认主题（颜色 + 移除背景图）。 */
	function resetTheme(): void {
		themePresetId = DEFAULT_THEME_CONFIG.presetId;
		themeColors = {};
		themeBackground = '';
		themeOpacity = 1;
		void persistTheme();
	}

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
			llmStateConfirm,
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
			const sync = {
				enabled: syncEnabled,
				serverUrl: syncServerUrl.trim(),
				serverKey: syncServerKey.trim()
			};
			await onSaveConfig(buildConfig());
			await onSaveProfile({ name, systemPrompt: prompt });
			await onSaveDeveloperMode(dev);
			await onSaveSync(sync);
		} finally {
			saving = false;
		}
	}

	/** 连接测试：用当前草稿配置验证服务器可用。 */
	async function testSync(): Promise<void> {
		if (syncServerUrl.trim() === '') {
			syncStatus = '请先填写服务器地址';
			return;
		}
		syncBusy = true;
		try {
			const result = await onTestSync({
				enabled: syncEnabled,
				serverUrl: syncServerUrl.trim(),
				serverKey: syncServerKey.trim()
			});
			syncStatus = result.message;
		} finally {
			syncBusy = false;
		}
	}

	/** 手动立即同步。 */
	async function syncNow(): Promise<void> {
		syncBusy = true;
		try {
			const result = await onSyncNow();
			syncStatus = result.message;
		} finally {
			syncBusy = false;
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

	/** 把图片文件读为 data URL（背景图以 base64 随设置持久化）。 */
	function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
			reader.onerror = () => reject(new Error('读取图片失败'));
			reader.readAsDataURL(file);
		});
	}

	/** 取色器需要 #rrggbb：归一化 hex，非法值回退黑色。 */
	function toHex(value: string): string {
		const trimmed = value.trim();
		if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
			return trimmed.toLowerCase();
		}
		if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
			return `#${trimmed
				.slice(1)
				.split('')
				.map((char) => char + char)
				.join('')}`;
		}
		return '#000000';
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
		<div class="row-actions" style="margin-bottom: 10px;">
			<input
				id="llm-state-confirm"
				class="checkbox"
				type="checkbox"
				bind:checked={llmStateConfirm}
				disabled={!allowAiStateTools}
			/>
			<label for="llm-state-confirm" class="muted"
				>使用 LLM 状态确认（AI 未调用工具时，由另一个 LLM 判断并补执行）</label
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
		<h3 class="card-title">主题</h3>
		<p class="muted" style="margin: 0 0 10px;">
			高度自定义外观：预设、背景图与透明度、颜色变量。修改即时生效并自动保存。
		</p>
		<div class="field">
			<label for="theme-preset">预设</label>
			<select
				id="theme-preset"
				class="select"
				value={themePresetId}
				onchange={(event) =>
					selectThemePreset((event.currentTarget as HTMLSelectElement).value)}
			>
				{#each THEME_PRESETS as preset (preset.id)}
					<option value={preset.id}>{preset.label}</option>
				{/each}
				<option value="custom">自定义…</option>
			</select>
			<p class="muted" style="margin-top: 2px;">
				{findThemePreset(themePresetId)?.description ?? '已进入自定义模式：改动任何颜色即生效。'}
			</p>
		</div>

		<div class="field">
			<label for="theme-bg-file">背景图</label>
			<div class="row-actions">
				<button class="btn btn-small" onclick={() => themeInput?.click()}>
					{themeBackground === '' ? '选择背景图' : '更换背景图'}
				</button>
				{#if themeBackground !== ''}
					<button class="btn btn-small btn-danger" onclick={removeThemeBackground}>
						移除背景图
					</button>
				{/if}
				<input
					id="theme-bg-file"
					bind:this={themeInput}
					type="file"
					accept="image/*"
					style="display: none;"
					onchange={pickThemeBackground}
				/>
			</div>
			{#if themeBackground !== ''}
				<p class="muted" style="margin: 4px 0 0;">已启用背景图（建议使用压缩后的图片，base64 会随设置持久化）。</p>
				<div class="field">
					<label for="theme-bg-opacity">背景图透明度：{Math.round(themeOpacity * 100)}%</label>
					<input
						id="theme-bg-opacity"
						type="range"
						min="0"
						max="100"
						value={Math.round(themeOpacity * 100)}
						oninput={(event) => {
							themeOpacity = Number((event.currentTarget as HTMLInputElement).value) / 100;
							void persistTheme();
						}}
					/>
				</div>
			{/if}
		</div>

		<div class="theme-grid">
			{#each themeColorKeys as item (item.key)}
				<div class="field theme-color-field">
					<label for={`theme-color-${item.key}`}>{item.label}</label>
					<div style="display: flex; gap: 6px; align-items: center;">
						{#if !item.rgba}
							<input
								id={`theme-color-${item.key}`}
								class="color-input"
								type="color"
								value={toHex(themeColors[item.key] ?? '')}
								oninput={(event) =>
									setThemeColor(item.key, (event.currentTarget as HTMLInputElement).value)}
							/>
						{/if}
						<input
							class="input"
							value={themeColors[item.key] ?? ''}
							placeholder={item.rgba ? 'rgba(…)' : '#rrggbb'}
							onchange={(event) =>
								setThemeColor(item.key, (event.currentTarget as HTMLInputElement).value)}
						/>
					</div>
				</div>
			{/each}
		</div>
		<div class="row-actions" style="margin-top: 10px;">
			<button class="btn btn-small" onclick={resetTheme} disabled={themeBusy}>恢复默认主题</button>
			{#if themeBusy}<span class="muted">保存中…</span>{/if}
		</div>
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

	<div class="card">
		<h3 class="card-title">数据同步</h3>
		<p class="muted" style="margin: 0 0 10px;">
			连接你自己的远程服务器，实时同步快照、地点库/衣柜/日程、世界书与角色档案 （不含模型配置，API
			Key 不会上传）。服务器地址与密钥由服务器端一键安装脚本生成。
		</p>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input id="sync-enabled" class="checkbox" type="checkbox" bind:checked={syncEnabled} />
			<label for="sync-enabled" class="muted">启用远程同步</label>
		</div>
		<div class="field">
			<label for="sync-server-url">服务器地址</label>
			<input
				id="sync-server-url"
				class="input"
				bind:value={syncServerUrl}
				placeholder="https://sync.example.com 或 http://1.2.3.4:8787"
			/>
		</div>
		<div class="field">
			<label for="sync-server-key">服务器密钥</label>
			<input
				id="sync-server-key"
				class="input"
				bind:value={syncServerKey}
				placeholder="服务器生成的同步密钥"
			/>
		</div>
		<div class="row-actions">
			<button class="btn" onclick={testSync} disabled={syncBusy}>连接测试</button>
			<button class="btn" onclick={syncNow} disabled={syncBusy || !syncEnabled}>立即同步</button>
			{#if syncStatus}
				<span class="muted">{syncStatus}</span>
			{/if}
		</div>
	</div>

	<button class="btn btn-primary" onclick={save} disabled={saving}>保存设置</button>
</div>
