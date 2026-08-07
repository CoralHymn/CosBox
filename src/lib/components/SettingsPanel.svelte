<script lang="ts">
	import { findModelInfo } from '../llm/model-info';
	import {
		bindingValue,
		MODEL_ROLE_LABELS,
		type ModelEntryDraft,
		normalizeModelService,
		parseBindingValue
	} from '../llm/model-services';
	import type { FetchedModel } from '../llm/model-service';
	import { CUSTOM_PROVIDER_ID, findProviderPreset, LLM_PROVIDER_PRESETS } from '../llm/providers';
	import {
		DEFAULT_LLM_CONFIG,
		type LlmConfig,
		type ModelRole,
		type ModelService
	} from '../llm/types';
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
		/** 模型服务管理的即时保存（换绑/保存服务/温度等），静默持久化。 */
		onAutoSaveConfig: (config: LlmConfig) => Promise<void>;
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
		onAutoSaveConfig,
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
	let memoryEnabled = $state(true);
	let memoryInjectLimit = $state(5);
	let memoryAutoExtract = $state(false);
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
	let themeBlur = $state(0);
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
	/** 已保存的模型服务列表与三角色绑定（角色 → 服务 id）。 */
	let services = $state<ModelService[]>([]);
	let chatModelId = $state('');
	let chatModelEntryId = $state('');
	let judgeModelId = $state('');
	let judgeModelEntryId = $state('');
	let generatorModelId = $state('');
	let generatorModelEntryId = $state('');
	/** 服务编辑草稿（复用 provider/baseUrl/apiKey/model 等字段）。 */
	let serviceEditorOpen = $state(false);
	let editingServiceId = $state<string | null>(null);
	let serviceLabel = $state('');
	let serviceNote = $state('');
	let serviceMaxTokens = $state<number | undefined>(undefined);
	/** 编辑器里已加入的模型行（多选）。 */
	let editorModels = $state<ModelEntryDraft[]>([]);
	/** 「获取模型列表」后勾选待批量添加的模型 id。 */
	let selectedFetchedModels = $state<string[]>([]);
	let savingService = $state(false);

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
	/** 角色分配下拉的扁平选项：每个服务下的每个模型一条（值 = 服务id::模型id）。 */
	const roleOptions = $derived(
		services.flatMap((service) =>
			(service.models ?? []).map((entry) => ({
				value: bindingValue(service.id, entry.id),
				label: `${service.label} / ${entry.model}`
			}))
		)
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
		memoryEnabled = config.memoryEnabled !== false;
		memoryInjectLimit = config.memoryInjectLimit ?? 5;
		memoryAutoExtract = config.memoryAutoExtract === true;
		services = (config.modelServices ?? []).map((service) => ({ ...service }));
		chatModelId = config.chatModelId ?? '';
		chatModelEntryId = config.chatModelEntryId ?? '';
		judgeModelId = config.judgeModelId ?? '';
		judgeModelEntryId = config.judgeModelEntryId ?? '';
		generatorModelId = config.generatorModelId ?? '';
		generatorModelEntryId = config.generatorModelEntryId ?? '';
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
		themeBlur = theme.backgroundBlur;
	});

	/** 当前主题草稿（颜色合并预设默认值，保证变量齐全）。 */
	function buildThemeDraft(): ThemeConfig {
		const base = findThemePreset(themePresetId)?.colors ?? {};
		return {
			presetId: themePresetId,
			colors: { ...base, ...themeColors },
			backgroundImage: themeBackground,
			backgroundOpacity: themeOpacity,
			backgroundBlur: themeBlur
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
		themeBlur = 0;
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
			memoryEnabled,
			memoryInjectLimit,
			memoryAutoExtract,
			modelServices: services.map((service) => ({ ...service })),
			chatModelId,
			chatModelEntryId,
			judgeModelId,
			judgeModelEntryId,
			generatorModelId,
			generatorModelEntryId,
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
			const models = await onFetchModels(buildServiceDraftConfig());
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
			await onTestConnection(buildServiceDraftConfig());
		} finally {
			testingConnection = false;
		}
	}

	/** 把「服务编辑草稿」合成一份配置，供获取模型列表 / 连接测试使用。 */
	function buildServiceDraftConfig(): LlmConfig {
		return {
			...buildConfig(),
			provider: presetSelection === 'demo' ? 'demo' : 'openai-compatible',
			providerId: presetSelection === 'demo' ? CUSTOM_PROVIDER_ID : presetSelection,
			baseUrl: baseUrl.trim(),
			apiKey: apiKey.trim(),
			model: model.trim() || DEFAULT_LLM_CONFIG.model,
			modelContextWindow,
			maxTokens: Math.max(1, Math.floor(serviceMaxTokens ?? maxTokens))
		};
	}

	/** 打开新增表单，或回填某个服务进行编辑。 */
	function openServiceEditor(service: ModelService | null): void {
		editingServiceId = service?.id ?? null;
		serviceLabel = service?.label ?? '';
		serviceNote = service?.notes ?? '';
		editorModels = (service?.models ?? []).map((entry) => ({ ...entry }));
		selectedFetchedModels = [];
		if (service === null) {
			presetSelection = CUSTOM_PROVIDER_ID;
			baseUrl = '';
			apiKey = '';
			model = '';
			modelContextWindow = undefined;
			serviceMaxTokens = undefined;
		} else {
			presetSelection =
				service.provider === 'demo'
					? 'demo'
					: findProviderPreset(service.providerId)
						? service.providerId
						: CUSTOM_PROVIDER_ID;
			baseUrl = service.baseUrl;
			apiKey = service.apiKey;
			model = '';
			modelContextWindow = undefined;
			serviceMaxTokens = undefined;
		}
		availableModels = [];
		modelContexts = {};
		serviceEditorOpen = true;
	}

	/** 把「添加模型」草稿（model/窗口/Max）追加为一行。 */
	function addEditorModel(): void {
		if (model.trim() === '') {
			return;
		}
		editorModels = [
			...editorModels,
			{
				model: model.trim(),
				...(modelContextWindow !== undefined ? { contextWindow: modelContextWindow } : {}),
				...(serviceMaxTokens !== undefined ? { maxTokens: serviceMaxTokens } : {})
			}
		];
		model = '';
		modelContextWindow = undefined;
		serviceMaxTokens = undefined;
	}

	/** 局部更新编辑器里的某行模型。 */
	function updateEditorModel(index: number, patch: Partial<ModelEntryDraft>): void {
		editorModels = editorModels.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
	}

	/** 删除编辑器里的一行模型。 */
	function removeEditorModel(index: number): void {
		editorModels = editorModels.filter((_, i) => i !== index);
	}

	/** 把「获取模型列表」勾选的模型批量加入编辑器。 */
	function addFetchedModels(): void {
		const existingModels = editorModels.map((entry) => entry.model);
		const fresh = selectedFetchedModels.filter((id) => !existingModels.includes(id));
		editorModels = [
			...editorModels,
			...fresh.map((id) => ({
				model: id,
				...(modelContexts[id] !== undefined ? { contextWindow: modelContexts[id] } : {})
			}))
		];
		selectedFetchedModels = [];
		availableModels = [];
	}

	/** 保存（新增或更新）一个模型服务；首个服务自动绑定全部角色。 */
	async function saveService(): Promise<void> {
		if (savingService || editorModels.length === 0) {
			return;
		}
		savingService = true;
		try {
			const draft = {
				id: editingServiceId ?? undefined,
				label: serviceLabel,
				provider: (presetSelection === 'demo' ? 'demo' : 'openai-compatible') as ModelService['provider'],
				providerId: presetSelection,
				baseUrl,
				apiKey,
				models: editorModels,
				notes: serviceNote
			};
			const normalized = normalizeModelService(draft);
			if (editingServiceId === null) {
				services = [...services, normalized];
				if (services.length === 1) {
					chatModelId = normalized.id;
					chatModelEntryId = normalized.models[0]?.id ?? '';
					judgeModelId = normalized.id;
					judgeModelEntryId = normalized.models[0]?.id ?? '';
					generatorModelId = normalized.id;
					generatorModelEntryId = normalized.models[0]?.id ?? '';
				}
			} else {
				services = services.map((service) => (service.id === normalized.id ? normalized : service));
				// 编辑已有服务：若角色绑定的是该服务但条目已不存在，回退第一条。
				const firstEntryId = normalized.models[0]?.id ?? '';
				const rebind = (serviceId: string, entryId: string): string =>
					serviceId === normalized.id &&
					!normalized.models.some((entry) => entry.id === entryId)
						? firstEntryId
						: entryId;
				chatModelEntryId = rebind(chatModelId, chatModelEntryId);
				judgeModelEntryId = rebind(judgeModelId, judgeModelEntryId);
				generatorModelEntryId = rebind(generatorModelId, generatorModelEntryId);
			}
			await persistModelConfig();
			serviceEditorOpen = false;
			editingServiceId = null;
		} finally {
			savingService = false;
		}
	}

	/** 删除服务；若某个角色正指向它，改绑到剩余第一条服务。 */
	async function deleteService(service: ModelService): Promise<void> {
		if (!window.confirm(`确定删除模型服务「${service.label}」？${service.apiKey ? '其 API Key 将一并移除。' : ''}`)) {
			return;
		}
		const remaining = services.filter((item) => item.id !== service.id);
		services = remaining;
		const fallback = remaining[0]?.id ?? '';
		const fallbackEntryId = remaining[0]?.models[0]?.id ?? '';
		if (chatModelId === service.id) {
			chatModelId = fallback;
			chatModelEntryId = fallbackEntryId;
		}
		if (judgeModelId === service.id) {
			judgeModelId = fallback;
			judgeModelEntryId = fallbackEntryId;
		}
		if (generatorModelId === service.id) {
			generatorModelId = fallback;
			generatorModelEntryId = fallbackEntryId;
		}
		if (editingServiceId === service.id) {
			serviceEditorOpen = false;
			editingServiceId = null;
		}
		void persistModelConfig();
	}

	/** 角色绑定：下拉值为 `服务id::模型条目id`。 */
	function setRole(role: ModelRole, value: string): void {
		const parsed = parseBindingValue(value);
		if (parsed === null) {
			return;
		}
		if (role === 'chat') {
			chatModelId = parsed.serviceId;
			chatModelEntryId = parsed.entryId;
		} else if (role === 'judge') {
			judgeModelId = parsed.serviceId;
			judgeModelEntryId = parsed.entryId;
		} else {
			generatorModelId = parsed.serviceId;
			generatorModelEntryId = parsed.entryId;
		}
		void persistModelConfig();
	}

	/** 某服务被哪些角色使用（徽标展示）。 */
	function rolesForService(serviceId: string): ModelRole[] {
		const roles: ModelRole[] = [];
		if (chatModelId === serviceId) {
			roles.push('chat');
		}
		if (judgeModelId === serviceId) {
			roles.push('judge');
		}
		if (generatorModelId === serviceId) {
			roles.push('generator');
		}
		return roles;
	}

	/** 全部角色（分配区遍历用）。 */
	const ALL_ROLES: ModelRole[] = ['chat', 'judge', 'generator'];

	/** 角色当前绑定下拉值（`服务id::模型条目id`）。 */
	function roleId(role: ModelRole): string {
		let serviceId = '';
		let entryId = '';
		if (role === 'chat') {
			serviceId = chatModelId;
			entryId = chatModelEntryId;
		} else if (role === 'judge') {
			serviceId = judgeModelId;
			entryId = judgeModelEntryId;
		} else {
			serviceId = generatorModelId;
			entryId = generatorModelEntryId;
		}
		if (serviceId === '' || entryId === '') {
			return '';
		}
		return bindingValue(serviceId, entryId);
	}

	/** 服务商展示名。 */
	function providerLabelFor(service: ModelService): string {
		if (service.provider === 'demo') {
			return '演示模式';
		}
		return findProviderPreset(service.providerId)?.label ?? '自定义';
	}

	/** 模型服务管理区改动即时落库（静默保存，失败由父级提示）。 */
	async function persistModelConfig(): Promise<void> {
		try {
			await onAutoSaveConfig(buildConfig());
		} catch (err) {
			// 父级已弹出错误提示，这里不再重复处理。
			void err;
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
		<h3 class="card-title">模型服务管理</h3>
		<p class="muted" style="margin: 0 0 12px;">
			把「服务商 + Key」保存为一个连接，下面挂多个可选模型（Key 只填一次）；
			再为三类任务分配「服务 + 模型」：
			对话用强模型、状态判断与生成用便宜模型，便于控制 token 与消费。API Key 仅保存在本地，
			不会随工作区导出或同步到服务器。
		</p>

		<div class="field">
			<span class="muted" style="display: block; margin-bottom: 4px;">
				任务角色分配（快速切换模型 = 换绑「服务 / 模型」）
			</span>
			<div class="row-actions" style="flex-wrap: wrap; gap: 8px;">
				{#each ALL_ROLES as role (role)}
					<div class="field" style="flex: 1; min-width: 180px;">
						<label for={`role-${role}`} class="muted">{MODEL_ROLE_LABELS[role]}</label>
						<select
							id={`role-${role}`}
							class="select"
							value={roleId(role)}
							onchange={(event) =>
								setRole(role, (event.currentTarget as HTMLSelectElement).value)}
						>
							{#each roleOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>
		</div>

		<div class="field">
			<span class="muted" style="display: block; margin-bottom: 4px;">已保存的模型服务</span>
			{#each services as service (service.id)}
				<div class="service-row">
					<div style="flex: 1; min-width: 0;">
						<div class="row-actions" style="gap: 6px;">
							<span class="service-name">{service.label}</span>
							{#each rolesForService(service.id) as role (role)}
								<span class="role-badge">{MODEL_ROLE_LABELS[role]}</span>
							{/each}
						</div>
						<p class="muted" style="margin: 3px 0 0; font-size: 12px;">
							{providerLabelFor(service)} · 共 {service.models.length} 个模型
						</p>
						<div class="row-actions" style="gap: 4px; flex-wrap: wrap; margin-top: 4px;">
							{#each service.models as entry (entry.id)}
								<span
									class="model-chip"
									title="窗口 {entry.contextWindow ?? '未知'} · Max {entry.maxTokens ?? '全局'}"
								>
									{entry.model}
									{#if entry.maxTokens !== undefined} ·{entry.maxTokens}{/if}
								</span>
							{/each}
						</div>
					</div>
					<div class="row-actions" style="gap: 4px;">
						<button class="btn btn-small" onclick={() => openServiceEditor(service)}>编辑</button>
						<button
							class="btn btn-danger btn-small"
							onclick={() => deleteService(service)}
							aria-label={`删除服务 ${service.label}`}>✕</button
						>
					</div>
				</div>
			{:else}
				<p class="empty-hint">还没有模型服务。点击下方「添加模型服务」创建第一个服务。</p>
			{/each}
		</div>

		{#if serviceEditorOpen}
			<div class="service-editor">
				<h3 class="card-title" style="margin-top: 0;">
					{editingServiceId === null ? '添加模型服务' : '编辑模型服务'}
				</h3>
				<div class="field">
					<label for="svc-label">名称（便于区分，如「DeepSeek 主模型」）</label>
					<input id="svc-label" class="input" bind:value={serviceLabel} placeholder="我的服务" />
				</div>
				<div class="field">
					<label for="svc-provider">服务商</label>
					<select
						id="svc-provider"
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
						<label for="svc-base-url">Base URL（OpenAI 兼容端点）</label>
						<input
							id="svc-base-url"
							class="input"
							bind:value={baseUrl}
							placeholder="https://api.example.com/v1"
						/>
					</div>
					<div class="field">
						<label for="svc-api-key">API Key</label>
						<input
							id="svc-api-key"
							class="input"
							type="password"
							bind:value={apiKey}
							placeholder={currentPreset?.requiresApiKey === false
								? '本地服务通常无需 Key'
								: 'your-api-key'}
						/>
					</div>
					{#if currentPreset?.notes}
						<p class="muted" style="margin-top: 2px;">{currentPreset.notes}</p>
					{/if}
					<div class="field">
						<span class="muted" style="display: block; margin-bottom: 4px;">
							模型列表（一个服务商下可多选多个模型）
						</span>
						{#each editorModels as entry, index (index)}
							<div class="model-row">
								<input
									class="input"
									value={entry.model}
									placeholder="模型 id"
									onchange={(event) =>
										updateEditorModel(index, {
											model: (event.currentTarget as HTMLInputElement).value
										})}
									aria-label="模型 id"
								/>
								<input
									class="input"
									style="width: 110px;"
									type="number"
									value={entry.contextWindow ?? ''}
									placeholder="窗口"
									onchange={(event) =>
										updateEditorModel(index, {
											contextWindow:
												Number((event.currentTarget as HTMLInputElement).value) > 0
													? Math.floor(Number((event.currentTarget as HTMLInputElement).value))
													: undefined
										})}
									aria-label="上下文窗口"
								/>
								<input
									class="input"
									style="width: 90px;"
									type="number"
									value={entry.maxTokens ?? ''}
									placeholder="Max"
									onchange={(event) =>
										updateEditorModel(index, {
											maxTokens:
												Number((event.currentTarget as HTMLInputElement).value) > 0
													? Math.floor(Number((event.currentTarget as HTMLInputElement).value))
													: undefined
										})}
									aria-label="Max Tokens"
								/>
								<button
									class="btn btn-danger btn-small"
									onclick={() => removeEditorModel(index)}
									aria-label="移除该模型">✕</button
								>
							</div>
						{/each}
						<div class="model-row" style="margin-top: 6px;">
							<ModelCombobox
								value={model}
								candidates={modelCandidates}
								inputId="svc-model"
								placeholder="输入/选择模型后加入"
								onChange={onModelChange}
							/>
							<input
								class="input"
								style="width: 110px;"
								type="number"
								value={modelContextWindow ?? ''}
								placeholder="窗口"
								onchange={(event) =>
									(modelContextWindow = Number((event.currentTarget as HTMLInputElement).value) > 0
										? Math.floor(Number((event.currentTarget as HTMLInputElement).value))
										: undefined)}
								aria-label="上下文窗口"
							/>
							<input
								class="input"
								style="width: 90px;"
								type="number"
								value={serviceMaxTokens ?? ''}
								placeholder="Max"
								onchange={(event) =>
									(serviceMaxTokens = Number((event.currentTarget as HTMLInputElement).value) > 0
										? Math.floor(Number((event.currentTarget as HTMLInputElement).value))
										: undefined)}
								aria-label="Max Tokens"
							/>
							<button class="btn btn-small" onclick={addEditorModel} disabled={model.trim() === ''}>
								＋ 加入
							</button>
						</div>
					</div>
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
						<div class="fetched-models">
							<p class="muted" style="margin: 0 0 6px;">
								已获取 {availableModels.length} 个模型，勾选后批量加入：
							</p>
							<div class="row-actions" style="gap: 4px; flex-wrap: wrap;">
								{#each availableModels as fetched (fetched)}
									<label class="row-actions" style="gap: 4px; font-size: 12px;">
										<input
											class="checkbox"
											type="checkbox"
											checked={selectedFetchedModels.includes(fetched)}
											onchange={(event) => {
												const checked = (event.currentTarget as HTMLInputElement).checked;
												selectedFetchedModels = checked
													? [...selectedFetchedModels, fetched]
													: selectedFetchedModels.filter((id) => id !== fetched);
											}}
										/>
										<span>{fetched}</span>
									</label>
								{/each}
							</div>
							<button
								class="btn btn-small"
								style="margin-top: 6px;"
								onclick={addFetchedModels}
								disabled={selectedFetchedModels.length === 0}
							>
								添加所选（{selectedFetchedModels.length}）
							</button>
						</div>
					{/if}
				{/if}
				<div class="field">
					<label for="svc-note">备注（可选）</label>
					<input id="svc-note" class="input" bind:value={serviceNote} placeholder="用途说明" />
				</div>
				<div class="row-actions" style="gap: 6px;">
					<button class="btn btn-small" onclick={saveService} disabled={savingService || editorModels.length === 0}>
						{savingService ? '保存中…' : '保存服务'}
					</button>
					<button
						class="btn btn-small"
						onclick={() => {
							serviceEditorOpen = false;
							editingServiceId = null;
						}}>取消</button
					>
				</div>
			</div>
		{:else}
			<button class="btn btn-small" onclick={() => openServiceEditor(null)}>＋ 添加模型服务</button>
		{/if}

		<div class="field" style="margin-top: 14px;">
			<label for="llm-temperature">全局 Temperature（{temperature.toFixed(1)}）</label>
			<input
				id="llm-temperature"
				type="range"
				min="0"
				max="2"
				step="0.1"
				bind:value={temperature}
				style="width: 100%;"
				onchange={() => void persistModelConfig()}
			/>
			<p class="muted" style="margin-top: 2px;">
				全局 Max Tokens（{maxTokens}）作为各服务未单独设置时的回退值；
				压缩触发时同样按该服务的预算预留输出空间。
			</p>
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
		<h3 class="card-title">长期记忆</h3>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input
				id="memory-enabled"
				class="checkbox"
				type="checkbox"
				bind:checked={memoryEnabled}
			/>
			<label for="memory-enabled" class="muted"
				>启用记忆召回（按关键词与重要度把相关记忆注入上下文）</label
			>
		</div>
		<div class="row-actions" style="margin-bottom: 10px;">
			<input
				id="memory-auto-extract"
				class="checkbox"
				type="checkbox"
				bind:checked={memoryAutoExtract}
				disabled={!memoryEnabled}
			/>
			<label for="memory-auto-extract" class="muted"
				>每次回复后自动提取新记忆（消耗少量 token，可在「记忆」页审核导入）</label
			>
		</div>
		<div class="field">
			<label for="memory-inject-limit">单次请求最多注入 {memoryInjectLimit} 条记忆</label>
			<input
				id="memory-inject-limit"
				type="range"
				min="1"
				max="12"
				step="1"
				bind:value={memoryInjectLimit}
				disabled={!memoryEnabled}
				style="width: 100%;"
			/>
		</div>
		<p class="muted" style="margin: 0;">
			上下文压缩只会保留摘要，长期记忆能把「值得记住的事实」从对话中抽取并持久化，
			下次请求时自动召回，避免压缩后丢失角色关系、偏好与重要约定。可在「记忆」页手动增删、置顶与编辑。
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
				<div class="field">
					<label for="theme-bg-blur">磨砂程度：{themeBlur}px</label>
					<input
						id="theme-bg-blur"
						type="range"
						min="0"
						max="50"
						value={themeBlur}
						oninput={(event) => {
							themeBlur = Number((event.currentTarget as HTMLInputElement).value);
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

<style>
	.service-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
	.service-row:last-of-type {
		border-bottom: none;
	}
	.service-name {
		font-weight: 600;
	}
	.role-badge {
		font-size: 11px;
		padding: 1px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.service-editor {
		margin: 12px 0;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--panel-2);
	}
	.model-chip {
		font-size: 11px;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.model-row {
		display: flex;
		gap: 6px;
		align-items: center;
		margin-bottom: 6px;
	}
	.model-row .input:first-child {
		flex: 1;
		min-width: 0;
	}
	.fetched-models {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px;
		margin-bottom: 10px;
		background: var(--panel);
	}
</style>
