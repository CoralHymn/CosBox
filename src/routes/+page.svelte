<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		ChatMessageView,
		ConfigPatch,
		MessageSegment,
		StatePatch,
		WorldInfoEntry
	} from '../lib/core/types';
	import { formatWorldTime } from '../lib/core/state';
	import {
		buildContext,
		DEFAULT_MEMORY_INJECT_LIMIT,
		type ContextBundle,
		type ContextPipelineInput
	} from '../lib/context/pipeline';
	import { summarizeState } from '../lib/context/state-summary';
	import { KvRepository } from '../lib/db/kv-repo';
	import { MemoryRepository } from '../lib/db/memory-repo';
	import { getDb } from '../lib/db/schema';
	import { SnapshotRepository } from '../lib/db/snapshot-repo';
	import { WorldInfoRepository } from '../lib/db/world-info-repo';
	import {
		buildCharaCardV3,
		mapCardToCosBox,
		parseCharaCard,
		serializeCharaCard
	} from '../lib/import-export/chara-card-v3';
	import { parseConfigPart, serializeConfigPart } from '../lib/import-export/config-transfer';
	import { parseWorkspace, type WorkspaceData } from '../lib/import-export/workspace';
	import {
		ChatService,
		formatToolArguments,
		type DebugPromptView,
		type PromptPreviewResult
	} from '../lib/llm/chat-service';
	import {
		DEFAULT_COMPACT_THRESHOLD,
		DEFAULT_KEEP_RECENT,
		type CompactionState
	} from '../lib/llm/compaction';
	import { DemoLlmClient } from '../lib/llm/demo-provider';
	import {
		buildImportPatch,
		GeneratorService,
		itemKeyFor,
		KIND_LABELS,
		type GeneratedItem,
		type GenerationRequest,
		type GenerationResult,
		type GeneratorKind
	} from '../lib/llm/generator';
	import { estimateMessagesTokens, resolveContextWindow } from '../lib/llm/model-info';
	import { extractMemoriesFromConversation } from '../lib/memory/extract';
	import type { ExtractedMemory, MemoryEntry } from '../lib/memory/types';
	import { sanitizeAssistantText } from '../lib/llm/message-time';
	import { OpenAiCompatibleClient } from '../lib/llm/openai-client';
	import { findProviderPreset } from '../lib/llm/providers';
	import { resolveServiceConfig } from '../lib/llm/model-services';
	import { fetchModelList, testConnection, type FetchedModel } from '../lib/llm/model-service';
	import type { JudgeDebugView } from '../lib/llm/state-judge';
	import { STATE_TOOLS, isToolErrorOutput, type ExecutedToolCall } from '../lib/llm/state-tools';
	import type { LlmConfig, ModelRole, ToolCall, TokenUsage } from '../lib/llm/types';
	import { SyncService, type SyncResult } from '../lib/sync/sync-service';
	import type { SyncSettings } from '../lib/sync/types';
	import { applyThemeToDocument, type ThemeConfig } from '../lib/theme/theme';
	import { checkForUpdate, isTauri } from '../lib/platform/updater';
	import { rebuildFromNodes } from '../lib/core/snapshot';
	import { createInitialState } from '../lib/core/state';
	import type { SearchResult } from '../lib/search/types';
	import { WebSearchClient } from '../lib/search/search-client';
	import type { AppProfile } from '../lib/stores/settings.svelte';
	import { CharacterManager } from '../lib/manager/character-manager';
	import { applySlashCommand, parseSlashCommand, type SlashCommand } from '../lib/utils/slash';
	import { createCharacterSession } from '../lib/stores/character.svelte';
	import { createContextUsageStore } from '../lib/stores/context-usage.svelte';
	import { createMemoryStore } from '../lib/stores/memory.svelte';
	import { createMetricsStore } from '../lib/stores/metrics.svelte';
	import { createSettingsStore } from '../lib/stores/settings.svelte';
	import { createToasts, type TabId } from '../lib/stores/ui.svelte';
	import { createWorldInfoStore } from '../lib/stores/world-info.svelte';
	import { downloadBytes, downloadTextFile } from '../lib/utils/download';
	import { createScopeKv } from '../lib/db/scoped-kv';
	import { WorkspaceScope } from '../lib/db/workspace-scope';
	import { WorkspaceRegistry } from '../lib/workspace/workspace-registry';
	import { WorkspaceService } from '../lib/workspace/workspace-service';
	import type { WorkspaceMeta } from '../lib/workspace/types';
	import ChatPanel from '../lib/components/ChatPanel.svelte';
	import ContextPanel from '../lib/components/ContextPanel.svelte';
	import ImportExportPanel from '../lib/components/ImportExportPanel.svelte';
	import LocationsPanel from '../lib/components/LocationsPanel.svelte';
	import MemoryPanel from '../lib/components/MemoryPanel.svelte';
	import MonitorPanel from '../lib/components/MonitorPanel.svelte';
	import NavRail from '../lib/components/NavRail.svelte';
	import SchedulePanel from '../lib/components/SchedulePanel.svelte';
	import SettingsPanel from '../lib/components/SettingsPanel.svelte';
	import StatePreview from '../lib/components/StatePreview.svelte';
	import StatePanel from '../lib/components/StatePanel.svelte';
	import Toasts from '../lib/components/Toasts.svelte';
	import VersionPanel from '../lib/components/VersionPanel.svelte';
	import WardrobePanel from '../lib/components/WardrobePanel.svelte';
	import WorldInfoPanel from '../lib/components/WorldInfoPanel.svelte';
	import WorkspaceHome from '../lib/components/WorkspaceHome.svelte';
	import WorkspaceModal from '../lib/components/WorkspaceModal.svelte';

	/** 自动记忆提取的固定触发阈值：累计 N 条新对话消息后提取一次（用户/角色各算一条）。 */
	const AUTO_MEMORY_EXTRACT_EVERY_MSGS = 10;

	const db = getDb();
	const kv = new KvRepository(db);
	/** 当前工作区定位器：三表仓储按它过滤，切换工作区 = set + 重载。 */
	const scope = new WorkspaceScope();
	const scopedKv = createScopeKv(kv, scope);
	const snapshotRepo = new SnapshotRepository(db, scope);
	const manager = new CharacterManager({
		snapshots: snapshotRepo,
		kv: scopedKv
	});
	const contextUsage = createContextUsageStore(scopedKv);
	const memoryRepo = new MemoryRepository(db, scope);
	const memoryStore = createMemoryStore(memoryRepo);
	const metrics = createMetricsStore(kv);
	const session = createCharacterSession(manager);
	const settings = createSettingsStore(kv, scopedKv);
	const worldInfoRepo = new WorldInfoRepository(db, scope);
	const worldInfo = createWorldInfoStore(worldInfoRepo);
	const syncService = new SyncService(scopedKv);
	const workspaces = new WorkspaceRegistry(kv);
	const workspaceService = new WorkspaceService({
		registry: workspaces,
		scope,
		snapshots: snapshotRepo,
		worldInfo: worldInfoRepo,
		memories: memoryRepo,
		kv,
		manager,
		onSwitched: () => reloadStoresAfterSwitch()
	});
	const toasts = createToasts();
	const demoClient = new DemoLlmClient();
	const openAiClient = new OpenAiCompatibleClient();
	const searchClient = new WebSearchClient();

	let tab = $state<TabId>('chat');
	/** 是否处于移动端视口（≤768px）：决定是否渲染抽屉/状态浮层等移动端元素。 */
	let isMobile = $state(false);
	/** 移动端左侧抽屉导航是否打开。 */
	let mobileNavOpen = $state(false);
	/** 移动端顶栏「实时状态」下拉是否打开。 */
	let mobileStateOpen = $state(false);
	let busy = $state(false);
	let searching = $state(false);
	/** LLM 记忆提取进行中（面板按钮与自动提取共用）。 */
	let memoryExtracting = $state(false);
	/** 最近一次成功提取已覆盖的非系统消息数，避免无新消息时重复调用 LLM。 */
	let lastAutoExtractCount = 0;
	/** 注册表与设置已加载：初始界面（工作区选择）可用。 */
	let booted = $state(false);
	/** 已进入某个工作区（主界面显示）；false 时显示工作区选择初始界面。 */
	let entered = $state(false);
	/** 正在进入/切换/创建/复制/删除工作区（禁用相关操作，防竞态）。 */
	let switchingWorkspace = $state(false);
	/** 应用内的工作区管理弹层。 */
	let workspaceModalOpen = $state(false);
	/** 工作区列表的响应式镜像（注册表 subscribe 同步）。 */
	let workspaceList = $state<WorkspaceMeta[]>([]);
	/** 当前工作区 id 的响应式镜像。 */
	let currentWorkspaceId = $state<string | null>(null);
	/** 当前工作区名（导航栏切换器展示）。 */
	let currentWorkspaceName = $state('');
	/** 开发者模式下展示的最近一次发送给 AI 的完整提示词。 */
	let debugPrompt = $state<DebugPromptView | null>(null);
	/** 最近一次请求的上下文包、用量与压缩状态（供侧栏上下文面板展示）。 */
	let lastContext = $state<{
		bundle: ContextBundle | null;
		usage: TokenUsage | null;
		compaction: CompactionState | null;
		/** 压缩时保留的最近完整消息数；重启后由持久化数据恢复。 */
		keptRecent: number;
	}>({
		bundle: null,
		usage: null,
		compaction: null,
		keptRecent: 0
	});
	/** 跨请求延续的压缩状态（摘要 + 边界）；只影响发送给模型的内容。 */
	let compactState = $state<CompactionState | null>(null);
	/** 正在执行手动压缩。 */
	let compacting = $state(false);
	/**
	 * 流式分段草稿：正在生成、尚未落快照的 assistant 分段（思考 / 正文 / 工具调用
	 * 按流中实际顺序排列）；null 表示未在生成。
	 */
	let streamingSegments = $state<MessageSegment[] | null>(null);
	/**
	 * 后处理阶段文案（补调重试/状态判断/确认等）：正文已输出后仍可见
	 * 「AI 还在做什么」；null 表示无进行中的后处理。
	 */
	let streamingPhase = $state<string | null>(null);
	/** 当前生成任务的取消控制器（发送按钮在 busy 时变为「停止」）。 */
	let abortController: AbortController | null = null;
	/** 最近消息日志：从最近一次用户发言开始实时记录，再次发言时重置。 */
	let recentLog = $state('');
	/** 本次发送是否发生过流式输出（决定完成后是否需要补记未流式的正文）。 */
	let streamedAny = false;
	/** 最近一次 LLM 状态判断的调试视图（开发者模式查看）。 */
	let lastJudgeDebug = $state<JudgeDebugView | null>(null);

	/** 按角色解析出实际请求配置：角色绑定服务优先，未绑定/服务缺失时回退主配置。 */
	function roleConfig(role: ModelRole): LlmConfig {
		return resolveServiceConfig(settings.config, role);
	}
	/** 当前实际使用的对话模型配置（上下文用量面板按它展示模型/窗口/费用）。 */
	const activeChatConfig = $derived(roleConfig('chat'));

	const providerLabel = $derived.by(() => {
		const chat = roleConfig('chat');
		if (chat.provider === 'demo') {
			return '演示模式';
		}
		const preset = findProviderPreset(chat.providerId);
		if (preset) {
			return `${preset.label} · ${chat.model}`;
		}
		return chat.model || 'OpenAI-compatible';
	});

	const searchSupported = $derived(
		settings.config.webSearch.enabled && settings.config.webSearch.apiKey.trim() !== ''
	);

	/** 重启恢复的用量摘要：bundle 为空但 usage 存在时表示数据来自本地持久化。 */
	const restoredContextSummary = $derived(
		lastContext.bundle === null && lastContext.usage !== null
			? { keptRecent: lastContext.keptRecent }
			: null
	);

	/** 监听视口宽度，移动端才渲染汉堡菜单与状态浮层（桌面端 DOM 不受影响）。 */
	$effect(() => {
		const query = window.matchMedia('(max-width: 768px)');
		const update = (): void => {
			isMobile = query.matches;
		};
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	/** 主题（颜色变量 + 背景图）即时应用到文档根节点。 */
	$effect(() => {
		applyThemeToDocument(settings.theme);
	});

	/** 移动端抽屉打开时支持 Esc 关闭。 */
	$effect(() => {
		if (!mobileNavOpen) {
			return;
		}
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				mobileNavOpen = false;
			}
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	/** 启动远程同步：读取设置、开始轮询并订阅本地变化。 */
	function startSync(): void {
		syncService.start({
			getSettings: () => settings.sync,
			getWorkspaceId: () => scope.get(),
			collect: () => workspaceService.collectWorkspaceData(scope.get()),
			apply: async (data) => applyWorkspaceData(data),
			onChange: () => syncService.notifyChanged()
		});
	}

	/** 同步工作区列表的响应式镜像（注册表变化时调用）。 */
	function refreshWorkspaceList(): void {
		workspaceList = workspaces.getWorkspaces();
		currentWorkspaceId = workspaces.getCurrentId();
		const current = workspaces.getById(currentWorkspaceId ?? '');
		currentWorkspaceName = current?.name ?? '';
	}

	/** 切换工作区后由 service 触发的宿主重载：stores、瞬态、同步全部复位。 */
	async function reloadStoresAfterSwitch(): Promise<void> {
		await worldInfo.init();
		await memoryStore.load();
		await contextUsage.load();
		await settings.reloadWorkspaceScoped();
		const restored = contextUsage.usage;
		lastContext =
			restored !== null
				? {
						bundle: null,
						usage: restored.usage,
						compaction: restored.compaction,
						keptRecent: restored.keptRecent
					}
				: { bundle: null, usage: null, compaction: null, keptRecent: 0 };
		compactState = restored?.compaction ?? null;
		debugPrompt = null;
		lastJudgeDebug = null;
		lastAutoExtractCount = 0;
		streamingSegments = null;
		streamingPhase = null;
		recentLog = '';
		refreshWorkspaceList();
		syncService.stop();
		await syncService.reloadForWorkspace();
		startSync();
	}

	onMount(async () => {
		try {
			await workspaces.migrateLegacy();
			await workspaces.load();
			workspaces.subscribe(refreshWorkspaceList);
			refreshWorkspaceList();
			await settings.load();
			await metrics.load();
			await syncService.load();
			session.subscribe(() => syncService.notifyChanged());
			worldInfo.subscribe(() => syncService.notifyChanged());
			settings.subscribe(() => syncService.notifyChanged());
			// 桌面版启动时静默检查更新：仅在新版本可用时提示，去「设置 → 关于」更新。
			if (isTauri()) {
				void checkForUpdate()
					.then((info) => {
						if (info !== null) {
							toasts.push('info', `发现新版本 v${info.version}，可在「设置 → 关于」中更新。`);
						}
					})
					.catch(() => undefined);
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			booted = true;
		}
	});

	async function handleSend(content: string, options: { search: boolean }): Promise<void> {
		if (busy) {
			return;
		}
		busy = true;
		let searchResults: SearchResult[] | undefined;
		try {
			const command = parseSlashCommand(content);
			if (command !== null) {
				// 斜杠命令也是用户输入：重置日志并记录其产生的系统反馈。
				const beforeCount = session.conversation.length;
				recentLog = `[用户] ${content}`;
				await handleSlashCommand(command);
				for (const message of session.conversation.slice(beforeCount)) {
					if (message.role === 'system') {
						recentLog += `\n\n[系统] ${message.content}`;
					}
				}
				return;
			}
			// 普通发言：重置最近日志，从本条用户发言开始实时记录。
			recentLog = `[用户] ${content}`;
			if (options.search) {
				searching = true;
				try {
					searchResults = await searchClient.search(content, settings.config.webSearch);
				} catch (err) {
					toasts.error(err);
				} finally {
					searching = false;
				}
			}
			await session.addMessage('user', content);
			await runAiReply(searchResults);
		} catch (err) {
			// 用户主动停止：请求按 AbortError 结束，不弹错误提示。
			if (abortController?.signal.aborted !== true) {
				toasts.error(err);
			}
		} finally {
			streamingSegments = null;
			streamingPhase = null;
			abortController = null;
			busy = false;
			searching = false;
		}
	}

	/** 打断生成：中止当前请求；busy 时发送按钮变为「停止」。 */
	function handleStop(): void {
		if (!busy) {
			return;
		}
		abortController?.abort();
		streamingSegments = null;
		streamingPhase = null;
		busy = false;
		toasts.push('info', '已停止生成');
	}

	/** 流式正文增量：同类型续接最后一段、异类型新开段；同步清洗时间标注。 */
	function appendStreamText(segments: MessageSegment[], delta: string): MessageSegment[] {
		const list = [...segments];
		const last = list[list.length - 1];
		if (last !== undefined && last.kind === 'text') {
			list[list.length - 1] = { ...last, content: sanitizeAssistantText(last.content + delta) };
		} else {
			list.push({ kind: 'text', content: sanitizeAssistantText(delta) });
		}
		return list;
	}

	/** 流式思考增量：同类型续接最后一段、异类型新开段（保留 思考→正文→思考 的交替顺序）。 */
	function appendStreamThinking(segments: MessageSegment[], delta: string): MessageSegment[] {
		const list = [...segments];
		const last = list[list.length - 1];
		if (last !== undefined && last.kind === 'thinking') {
			list[list.length - 1] = { ...last, content: last.content + delta };
		} else {
			list.push({ kind: 'thinking', content: delta });
		}
		return list;
	}

	/** 工具执行完成：把结果写入对应的「执行中」工具段（工具串行执行，按名称倒序匹配）。 */
	function markStreamToolResult(
		segments: MessageSegment[],
		result: ExecutedToolCall
	): MessageSegment[] {
		for (let index = segments.length - 1; index >= 0; index -= 1) {
			const segment = segments[index]!;
			if (
				segment.kind === 'tool' &&
				segment.status === 'running' &&
				segment.toolName === result.name
			) {
				const next = [...segments];
				next[index] = {
					...segment,
					content: result.output,
					...(isToolErrorOutput(result.output)
						? { status: 'error' as const }
						: { status: undefined })
				};
				return next;
			}
		}
		return [
			...segments,
			{
				kind: 'tool',
				toolName: result.name,
				content: result.output,
				...(isToolErrorOutput(result.output) ? { status: 'error' as const } : {})
			}
		];
	}

	/** 用当前会话状态生成回复并落库（普通发送与消息重试共用）；调用方需已设置 busy。 */
	async function runAiReply(searchResults?: SearchResult[]): Promise<void> {
		streamedAny = false;
		streamingSegments = [];
		const turnStartAt = Date.now();
		let turnRetries = 0;
		let turnFallbacks = 0;
		const controller = new AbortController();
		abortController = controller;
		const input: ContextPipelineInput = {
			state: session.state,
			conversation: session.conversation,
			worldInfo: worldInfo.entries,
			memories: settings.config.memoryEnabled === false ? [] : memoryStore.entries,
			memoryLimit: settings.config.memoryInjectLimit ?? DEFAULT_MEMORY_INJECT_LIMIT,
			enableStateTools: settings.config.allowAiStateTools === true,
			characterName:
				settings.profile.name ||
				(typeof session.state.attributes.name === 'string'
					? session.state.attributes.name
					: undefined),
			systemPrompt: settings.profile.systemPrompt ?? undefined,
			...(searchResults !== undefined ? { searchResults } : {})
		};
		const chatConfig = roleConfig('chat');
		const service = new ChatService(chatConfig.provider === 'demo' ? demoClient : openAiClient);
		const contextWindow = resolveContextWindow(chatConfig.modelContextWindow, chatConfig.model);
		const compactionOptions =
			chatConfig.autoCompact === true
				? {
						contextWindow,
						threshold: chatConfig.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
						keepRecent: DEFAULT_KEEP_RECENT,
						state: compactState
					}
				: undefined;
		const {
			reply,
			debug,
			bundle,
			usage,
			compaction,
			thinking,
			finishReason,
			judgeDebug,
			rounds,
			replySegments,
			executedTools
		} = await service.generateReply(
			input,
			chatConfig,
			{
				onDelta: (delta) => {
					// 边生成边剔除模型误输出的时间标注，保持流式展示与最终落库一致。
					// 分段维护（同类型续接、异类型新开段），保留 思考→正文→思考→正文 的交替顺序。
					streamingSegments = appendStreamText(streamingSegments ?? [], delta);
					// 实时记录原始流式内容（不覆盖、不清洗），供排查流式专属问题。
					recentLog += delta;
					streamedAny = true;
				},
				onThinkingDelta: (delta) => {
					// 思考增量实时展示（流式气泡的工作过程区），让用户知道 AI 正在思考。
					streamingSegments = appendStreamThinking(streamingSegments ?? [], delta);
				},
				onToolStart: (call: ToolCall) => {
					// 工具开始执行：气泡里立即出现「工具调用中」，避免长时间无反馈。
					const argsText = formatToolArguments(call.arguments);
					streamingSegments = [
						...(streamingSegments ?? []),
						{
							kind: 'tool',
							toolName: call.name,
							...(argsText !== '' ? { toolArgs: argsText } : {}),
							content: '',
							status: 'running'
						}
					];
				},
				onToolResult: (result: ExecutedToolCall) => {
					streamingSegments = markStreamToolResult(streamingSegments ?? [], result);
				},
				onRestart: () => {
					// 思考循环中断重启：首次请求已流式输出的内容不会落库，清空草稿保持一致。
					streamingSegments = [];
				},
				onPhase: (label) => {
					streamingPhase = label;
				},
				onMetric: (name) => {
					metrics.record(name);
					if (name.startsWith('retry.') && name.endsWith('.triggered')) {
						turnRetries += 1;
					}
					if (name.includes('text_fallback')) {
						turnFallbacks += 1;
					}
				},
				textToolFallback: settings.config.textToolFallback !== false,
				tools: settings.config.allowAiStateTools === true ? [...STATE_TOOLS] : [],
				toolContext: {
					getState: () => session.state,
					update: (patch, metadata) => session.update(patch, metadata),
					advanceTime: (minutes) => session.advanceTime(minutes)
				},
				enableStateJudge: settings.config.llmStateConfirm === true,
				judgeConfig: roleConfig('judge'),
				...(compactionOptions !== undefined ? { compaction: compactionOptions } : {})
			},
			controller.signal
		);
		debugPrompt = debug;
		lastJudgeDebug = judgeDebug;
		const keptRecent = bundle.history.filter((message) => message.id !== 'context-summary').length;
		lastContext = { bundle, usage: usage ?? null, compaction, keptRecent };
		void persistCurrentContextUsage();
		compactState = compaction;
		streamingSegments = null;
		streamingPhase = null;
		// 监控：记录一轮样本（耗时/用量/工具与兜底计数），供监控 tab 图表展示。
		metrics.recordTurn({
			t: Date.now(),
			latencyMs: Date.now() - turnStartAt,
			promptTokens: usage?.promptTokens ?? 0,
			completionTokens: usage?.completionTokens ?? 0,
			toolCalls: executedTools.length,
			retries: turnRetries,
			textFallbacks: turnFallbacks,
			...(finishReason !== undefined ? { finishReason } : {})
		});
		// AI 一轮回复合并为单条 assistant 消息：思考 / 正文 / 工具调用按序
		// 保存为 segments，气泡内分段展示——不再把每个工具轮次拆成独立消息，
		// 避免「一个思考绑一个输出」导致中间内容被吞。
		const mergedSegments: MessageSegment[] = [];
		for (const round of rounds) {
			if (round.thinking !== undefined && round.thinking.trim() !== '') {
				mergedSegments.push({ kind: 'thinking', content: round.thinking.trim() });
			}
			if (round.content !== null && round.content.trim() !== '') {
				mergedSegments.push({ kind: 'text', content: round.content.trim() });
			}
			for (const tool of round.tools) {
				mergedSegments.push({
					kind: 'tool',
					content: tool.output,
					toolName: tool.name,
					...(tool.args !== undefined && tool.args !== '' ? { toolArgs: tool.args } : {}),
					...(isToolErrorOutput(tool.output) ? { status: 'error' as const } : {})
				});
			}
		}
		// 最终回复若携带思考/正文交替顺序（interleaved thinking），按序分段展示，
		// 避免「思考→正文→思考→正文」被折叠成一段思考 + 一段正文。
		const replySegmentsList = replySegments ?? [];
		// 重试/兜底替换 result 时，替换结果的 segments 可能只剩正文、丢失首轮思考：
		// 若整个 replySegments 不含思考段而最终 thinking 非空，在首个正文段前补回。
		const replyHasThinking = replySegmentsList.some((segment) => segment.kind === 'thinking');
		let replyThinkingInjected = false;
		let replyTextPushed = false;
		if (replySegmentsList.length > 0) {
			for (const segment of replySegmentsList) {
				if (segment.kind === 'thinking') {
					mergedSegments.push({ kind: 'thinking', content: segment.content.trim() });
				} else if (segment.kind === 'text') {
					if (
						!replyHasThinking &&
						!replyThinkingInjected &&
						thinking !== undefined &&
						thinking.trim() !== ''
					) {
						mergedSegments.push({ kind: 'thinking', content: thinking.trim() });
						replyThinkingInjected = true;
					}
					mergedSegments.push({
						kind: 'text',
						content: sanitizeAssistantText(segment.content.trim())
					});
					replyTextPushed = true;
				}
			}
		} else if (thinking !== undefined && thinking.trim() !== '') {
			mergedSegments.push({ kind: 'thinking', content: thinking.trim() });
		}
		const budgetExhausted = finishReason === 'length';
		if (!replyTextPushed && reply.trim() !== '') {
			mergedSegments.push({ kind: 'text', content: reply.trim() });
		}
		if (mergedSegments.length > 0) {
			// content 保留纯正文（供导出/记忆/搜索等消费方使用），展示走 segments。
			const plainText = mergedSegments
				.filter((segment) => segment.kind === 'text')
				.map((segment) => segment.content)
				.join('\n');
			await session.addMessage('assistant', plainText, {
				segments: mergedSegments,
				...(thinking !== undefined && thinking.trim() !== '' ? { thinking: thinking.trim() } : {})
			});
		} else {
			toasts.push(
				'info',
				budgetExhausted
					? '模型输出被 Max Tokens 上限截断，正文为空。请在「设置 → 模型服务」调大 Max Tokens（思考型模型建议 4096 以上）。'
					: '模型返回了空回复，本轮未追加消息，请重试或换一种说法。'
			);
		}
		if (
			mergedSegments.every((segment) => segment.kind !== 'text') &&
			thinking !== undefined &&
			thinking.trim() !== ''
		) {
			// 模型只输出了思考过程、正文为空：消息已保留思考，另提示正文缺失原因。
			if (finishReason === 'length') {
				toasts.push(
					'info',
					'思考耗尽了 Max Tokens 预算，正文被截断。请在「设置 → 模型服务」调大 Max Tokens（思考型模型建议 4096 以上）。'
				);
			} else if (finishReason === 'stop') {
				toasts.push(
					'info',
					'模型只输出思考、未生成正文就结束了（finish_reason=stop）。这通常是模型/端点的思考模式异常：可尝试关闭模型的思考模式、检查代理是否正确转发正文，或换用 DeepSeek 官方端点。'
				);
			}
		}
		// 生成完成：追加未流式输出但应记录的部分（思考、工具反馈），
		// 以及非流式模式下没有实时记录的正文——绝不覆盖已实时记录的流式内容。
		const additions: string[] = [];
		for (const round of rounds) {
			if (!streamedAny && round.content !== null && round.content.trim() !== '') {
				additions.push(`[角色] ${round.content}`);
			}
			if (round.thinking !== undefined && round.thinking.trim() !== '') {
				additions.push(`[角色思考] ${round.thinking}`);
			}
			for (const tool of round.tools) {
				additions.push(`[工具] ${tool.name}：${tool.output}`);
			}
		}
		if (!streamedAny && reply.trim() !== '') {
			additions.push(`[角色] ${reply}`);
		}
		if (thinking !== undefined && thinking.trim() !== '') {
			additions.push(`[角色思考] ${thinking}`);
		}
		if (additions.length > 0) {
			recentLog += `\n\n${additions.join('\n\n')}`;
		}
		// 记忆：标记本次召回注入的条目（供排序衰减），并按设置后台自动提取新事实。
		if (bundle.recalledMemories.length > 0) {
			void memoryStore
				.markUsed(bundle.recalledMemories.map((entry) => entry.id))
				.catch(() => undefined);
		}
		maybeAutoMemoryExtract();
	}

	/** 消息重试（用户气泡）：回溯到该条用户消息并重新生成其回复；旧分支保留为备选。 */
	async function handleRetry(messageId: string): Promise<void> {
		if (busy) {
			return;
		}
		const index = session.conversation.findIndex((message) => message.id === messageId);
		const message = session.conversation[index];
		if (message === undefined || message.role !== 'user') {
			return;
		}
		busy = true;
		try {
			await session.checkout(message.id);
			// 日志从回溯后最近一条用户发言重新开始（与普通发送语义一致）。
			recentLog = `[用户] ${message.content}`;
			toasts.push('info', '已回溯到该回复之前，正在重新生成…');
			await runAiReply();
		} catch (err) {
			// 用户主动停止：请求按 AbortError 结束，不弹错误提示。
			if (abortController?.signal.aborted !== true) {
				toasts.error(err);
			}
		} finally {
			streamingSegments = null;
			streamingPhase = null;
			abortController = null;
			busy = false;
		}
	}

	/** 手动 LLM 状态确认：对指定 assistant 消息的那一轮运行状态判断并补执行工具。 */
	async function handleConfirmState(messageId: string): Promise<void> {
		if (busy || settings.config.allowAiStateTools !== true) {
			return;
		}
		const index = session.conversation.findIndex((message) => message.id === messageId);
		const assistant = session.conversation[index];
		if (assistant === undefined || assistant.role !== 'assistant') {
			return;
		}
		const lastUser = [...session.conversation.slice(0, index)]
			.reverse()
			.find((message) => message.role === 'user');
		busy = true;
		streamingPhase = '正在判断是否需要同步状态…';
		try {
			// 用该轮发生时的状态（含世界配置覆盖）做判断，避免被后续消息污染。
			const stateAt = await session.getStateAt(assistant.id);
			const judgeConfig = roleConfig('judge');
			const service = new ChatService(judgeConfig.provider === 'demo' ? demoClient : openAiClient);
			const { executed, debug } = await service.confirmStateForTurn({
				state: stateAt,
				lastUser,
				lastAssistant: assistant,
				config: judgeConfig,
				tools: [...STATE_TOOLS],
				toolContext: {
					getState: () => session.state,
					update: (patch, metadata) => session.update(patch, metadata),
					advanceTime: (minutes) => session.advanceTime(minutes)
				},
				onPhase: (label) => {
					streamingPhase = label;
				},
				onMetric: (name) => metrics.record(name),
				textToolFallback: settings.config.textToolFallback !== false
			});
			lastJudgeDebug = debug;
			// 工具反馈追加进原 AI 气泡的分段：前端可见，后续上下文展开为系统反馈。
			if (executed.length > 0) {
				await session.appendSegments(
					assistant.id,
					executed.map((tool) => ({
						kind: 'tool',
						content: tool.output,
						toolName: tool.name,
						...(isToolErrorOutput(tool.output) ? { status: 'error' as const } : {})
					}))
				);
			}
			if (executed.length === 0) {
				toasts.push('info', 'LLM 状态判断：本轮无需变更状态');
			} else {
				toasts.success(`LLM 状态判断已同步 ${executed.length} 项变更`);
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			streamingPhase = null;
			busy = false;
		}
	}

	/** 从消息气泡下方快速切换分支（< >）。 */
	async function handleSwitchBranch(tipId: string): Promise<void> {
		if (busy) {
			return;
		}
		try {
			await session.checkout(tipId);
			toasts.success('已切换到该分支');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 手动压缩：立即把早期对话总结为摘要，供下次请求使用。 */
	async function handleCompactNow(): Promise<void> {
		if (busy || compacting) {
			return;
		}
		compacting = true;
		try {
			const chatConfig = roleConfig('chat');
			const service = new ChatService(chatConfig.provider === 'demo' ? demoClient : openAiClient);
			const result = await service.compactConversation(session.conversation, chatConfig, {
				state: compactState,
				keepRecent: DEFAULT_KEEP_RECENT
			});
			compactState = result.state;
			if (result.state === null) {
				toasts.push('info', '对话较短，暂无需压缩');
			} else {
				lastContext = { ...lastContext, compaction: result.state };
				void persistCurrentContextUsage();
				toasts.success('已生成上下文摘要，将在下次请求使用');
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			compacting = false;
		}
	}

	/**
	 * 把当前 lastContext 的用量摘要持久化，重启后仍可显示。
	 * API 未返回 usage 时，用上下文包本地估算输入 token，避免恢复后用量面板为空。
	 */
	async function persistCurrentContextUsage(): Promise<void> {
		try {
			if (lastContext.bundle === null) {
				if (lastContext.usage !== null) {
					// 重启恢复的场景：仅更新压缩状态等字段。
					await contextUsage.save({
						usage: lastContext.usage,
						compaction: lastContext.compaction,
						keptRecent: lastContext.keptRecent,
						savedAt: Date.now()
					});
				}
				return;
			}
			const effectiveUsage: TokenUsage = lastContext.usage ?? {
				promptTokens: estimateMessagesTokens([
					{ role: 'system', content: lastContext.bundle.systemMessage },
					...lastContext.bundle.messages
				]),
				completionTokens: 0,
				cachedTokens: 0
			};
			await contextUsage.save({
				usage: effectiveUsage,
				compaction: lastContext.compaction,
				keptRecent: lastContext.keptRecent,
				savedAt: Date.now()
			});
		} catch (err) {
			// 用量持久化失败不阻断聊天流程，仅提示用户。
			toasts.error(err);
		}
	}

	/** 手动添加一条记忆。 */
	async function handleMemoryAdd(draft: {
		content: string;
		category: string;
		keywords: string[];
		importance: number;
		pinned: boolean;
	}): Promise<void> {
		try {
			await memoryStore.add(draft);
			toasts.success('记忆已保存');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 局部更新一条记忆。 */
	async function handleMemoryUpdate(
		id: string,
		patch: Partial<Omit<MemoryEntry, 'id'>>
	): Promise<void> {
		try {
			await memoryStore.update(id, patch);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 删除一条记忆。 */
	async function handleMemoryRemove(id: string): Promise<void> {
		try {
			await memoryStore.remove(id);
			toasts.success('记忆已删除');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 触发 LLM 从最近对话提取候选记忆；失败或取消返回 null。 */
	async function handleMemoryExtract(): Promise<ExtractedMemory[] | null> {
		if (memoryExtracting) {
			return null;
		}
		memoryExtracting = true;
		try {
			// 记忆由对话模型管理（生成模型仅用于地点/衣柜/日程生成）。
			const chatConfig = roleConfig('chat');
			const client = chatConfig.provider === 'demo' ? demoClient : openAiClient;
			const result = await extractMemoriesFromConversation({
				client,
				config: chatConfig,
				conversation: session.conversation.slice(-12),
				existing: memoryStore.entries,
				stateSummary: summarizeState(session.state)
			});
			lastAutoExtractCount = session.conversation.filter(
				(message) => message.role !== 'system'
			).length;
			if (result.items.length === 0) {
				toasts.push('info', '未从最近对话中提取到新的记忆');
				return null;
			}
			return result.items;
		} catch (err) {
			toasts.error(err);
			return null;
		} finally {
			memoryExtracting = false;
		}
	}

	/** 导入勾选的提取候选；返回导入/跳过数量供面板提示。 */
	async function handleMemoryImportExtracted(
		items: ExtractedMemory[]
	): Promise<{ imported: number; skipped: number }> {
		try {
			const result = await memoryStore.importExtracted(items);
			toasts.success(
				result.skipped > 0
					? `已导入 ${result.imported} 条记忆，跳过重复 ${result.skipped} 条`
					: `已导入 ${result.imported} 条记忆`
			);
			return result;
		} catch (err) {
			toasts.error(err);
			return { imported: 0, skipped: 0 };
		}
	}

	/**
	 * 按固定消息数触发自动记忆提取：累计 N 条新对话（用户/角色各算一条）后
	 * 才调用一次 LLM，避免每条消息都提取；失败不推进计数，等下一个窗口重试，
	 * 不会形成连续轮询。
	 */
	function maybeAutoMemoryExtract(): void {
		if (settings.config.memoryEnabled !== true || settings.config.memoryAutoExtract !== true) {
			return;
		}
		const nonSystemCount = session.conversation.filter(
			(message) => message.role !== 'system'
		).length;
		if (nonSystemCount - lastAutoExtractCount >= AUTO_MEMORY_EXTRACT_EVERY_MSGS) {
			void runAutoMemoryExtract();
		}
	}

	/** 自动提取：按固定消息数窗口运行，重复条目自动跳过；失败仅提示一次。 */
	async function runAutoMemoryExtract(): Promise<void> {
		if (memoryExtracting) {
			return;
		}
		// 防御性检查：没有新对话时不重复调用 LLM（正常由 maybeAutoMemoryExtract 把关）。
		const nonSystemCount = session.conversation.filter(
			(message) => message.role !== 'system'
		).length;
		if (nonSystemCount <= lastAutoExtractCount) {
			return;
		}
		memoryExtracting = true;
		try {
			// 记忆由对话模型管理（生成模型仅用于地点/衣柜/日程生成）。
			const chatConfig = roleConfig('chat');
			const client = chatConfig.provider === 'demo' ? demoClient : openAiClient;
			const result = await extractMemoriesFromConversation({
				client,
				config: chatConfig,
				conversation: session.conversation.slice(-8),
				existing: memoryStore.entries,
				stateSummary: summarizeState(session.state)
			});
			lastAutoExtractCount = nonSystemCount;
			if (result.items.length > 0) {
				const imported = await memoryStore.importExtracted(result.items);
				if (imported.imported > 0) {
					toasts.push(
						'info',
						`已自动记录 ${imported.imported} 条新记忆${
							imported.skipped > 0 ? `，跳过重复 ${imported.skipped} 条` : ''
						}`
					);
				}
			}
		} catch (err) {
			toasts.push('info', `自动记忆提取失败：${err instanceof Error ? err.message : '未知错误'}`);
		} finally {
			memoryExtracting = false;
		}
	}

	/**
	 * 预览「如果现在点击发送，会发送给 AI 什么」：把输入框内容当作待发送的用户消息，
	 * 走与真实发送相同的上下文组装（状态摘要 + 世界信息 + 历史），但不调用 LLM、
	 * 不落快照、不触发网络搜索。
	 */
	function handlePreview(draft: string): PromptPreviewResult {
		const trimmed = draft.trim();
		if (parseSlashCommand(trimmed) !== null) {
			return {
				kind: 'notice',
				text: `「${trimmed}」将以斜杠命令执行，不会调用 LLM；执行后会在对话中追加一条系统提示让 AI 感知。`
			};
		}
		if (trimmed === '') {
			return { kind: 'notice', text: '输入为空：点击发送不会调用 LLM。' };
		}
		const pending: ChatMessageView = {
			id: 'preview-pending',
			role: 'user',
			content: trimmed,
			timestamp: Date.now(),
			worldTime: session.state.schedule.time
		};
		const conversation = [...session.conversation, pending];
		const input: ContextPipelineInput = {
			state: session.state,
			conversation,
			worldInfo: worldInfo.entries,
			memories: settings.config.memoryEnabled === false ? [] : memoryStore.entries,
			memoryLimit: settings.config.memoryInjectLimit ?? DEFAULT_MEMORY_INJECT_LIMIT,
			characterName:
				settings.profile.name ||
				(typeof session.state.attributes.name === 'string'
					? session.state.attributes.name
					: undefined),
			systemPrompt: settings.profile.systemPrompt ?? undefined,
			historyOptions: { maxMessages: Math.max(1, conversation.length) }
		};
		const bundle = buildContext(input);
		const chatConfig = roleConfig('chat');
		const notes: string[] = [];
		if (chatConfig.autoCompact === true) {
			notes.push('若发送时达到压缩阈值，系统消息前还会插入模型生成的上下文摘要（预览未包含）。');
		}
		if (searchSupported) {
			notes.push('若勾选网络搜索，发送时还会注入实时搜索结果（预览未包含）。');
		}
		return {
			kind: 'prompt',
			debug: {
				systemMessage: bundle.systemMessage,
				messages: [{ role: 'system', content: bundle.systemMessage }, ...bundle.messages],
				request: {
					model: chatConfig.model,
					maxTokens: chatConfig.maxTokens,
					stream: chatConfig.stream === true,
					toolsEnabled: chatConfig.allowAiStateTools === true
				}
			},
			note: notes.join('\n')
		};
	}

	/** 斜杠命令：直接改状态并生成快照，再补一条系统提示让 AI 感知。 */
	async function handleSlashCommand(command: SlashCommand): Promise<void> {
		const result = applySlashCommand(session.state, command);
		if (result.error !== undefined) {
			toasts.error(result.error);
			return;
		}
		if (result.patch !== undefined) {
			await session.update(result.patch, { desc: `斜杠命令：${command.kind}` });
		}
		if (result.minutes !== undefined) {
			await session.advanceTime(result.minutes);
		}
		if (result.checkpointDesc !== undefined) {
			await session.addCheckpoint(result.checkpointDesc);
		}
		if (result.helpText !== undefined) {
			// 帮助文本只给用户看，不进入发送给 AI 的上下文。
			await session.addMessage('system', result.helpText, { skipContext: true });
		} else if (result.message !== '') {
			await session.addMessage('system', `（命令）${result.message}`);
		}
	}

	async function handleStateUpdate(patch: StatePatch, desc: string): Promise<void> {
		try {
			await session.update(patch, { desc });
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 编辑已有消息正文：原地改写该消息快照（不新增快照）。失败时上抛保持编辑态。 */
	async function handleEditMessage(id: string, content: string): Promise<void> {
		try {
			await session.editMessage(id, content);
			toasts.success('消息已更新');
		} catch (err) {
			toasts.error(err);
			throw err;
		}
	}

	/** 世界配置覆盖（地点库/衣柜/日程条目）：不生成快照。 */
	async function handleConfigUpdate(patch: ConfigPatch): Promise<void> {
		try {
			await session.applyConfig(patch);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleAdvance(minutes: number): Promise<void> {
		try {
			await session.advanceTime(minutes);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleCheckout(id: string): Promise<void> {
		try {
			await session.checkout(id);
			toasts.success('已切换到该快照');
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleCheckpoint(desc: string): Promise<void> {
		try {
			await session.addCheckpoint(desc);
			toasts.success('检查点已保存');
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleDeleteBranch(tipId: string): Promise<void> {
		if (!window.confirm('删除该分支将移除从分支点到末端的所有快照，且不可恢复。确定删除？')) {
			return;
		}
		try {
			const deleted = await session.deleteBranch(tipId);
			toasts.success(`已删除 ${deleted} 个快照`);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 批量删除分支（每个分支只删除其独有快照）。 */
	async function handleDeleteBranches(tipIds: string[]): Promise<void> {
		if (tipIds.length === 0) {
			return;
		}
		try {
			const removed = await session.deleteBranches(tipIds);
			toasts.success(`已删除 ${removed} 个快照`);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleWorldUpsert(entry: WorldInfoEntry): Promise<void> {
		try {
			await worldInfo.upsert(entry);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleWorldRemove(id: string): Promise<void> {
		try {
			await worldInfo.remove(id);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleSaveConfig(
		config: Parameters<typeof settings.saveConfig>[0]
	): Promise<void> {
		try {
			await settings.saveConfig(config);
			toasts.success('模型设置已保存');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 模型服务管理的即时保存（换绑/保存服务/调温度等），静默持久化、失败才提示。 */
	async function handleAutoSaveConfig(
		config: Parameters<typeof settings.saveConfig>[0]
	): Promise<void> {
		try {
			await settings.saveConfig(config);
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleSaveProfile(profile: AppProfile): Promise<void> {
		try {
			await settings.saveProfile(profile);
			toasts.success('角色档案已保存');
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleResetProfile(): Promise<void> {
		try {
			await settings.resetProfile();
			toasts.success('角色档案已恢复默认');
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleSaveDeveloperMode(enabled: boolean): Promise<void> {
		try {
			await settings.saveDeveloperMode(enabled);
			toasts.success(enabled ? '开发者功能已开启' : '开发者功能已关闭');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 保存远程同步设置；启用时立即开始轮询同步。 */
	async function handleSaveSync(next: SyncSettings): Promise<void> {
		try {
			await settings.saveSync(next);
			if (next.enabled) {
				startSync();
			} else {
				syncService.stop();
			}
			toasts.success('数据同步设置已保存');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 进入/切换工作区：切换成功后进入主界面。 */
	async function handleEnterWorkspace(id: string): Promise<void> {
		if (switchingWorkspace) {
			return;
		}
		switchingWorkspace = true;
		try {
			await workspaceService.switchTo(id);
			entered = true;
			tab = 'chat';
			workspaceModalOpen = false;
			mobileNavOpen = false;
			mobileStateOpen = false;
		} catch (err) {
			toasts.error(err);
		} finally {
			switchingWorkspace = false;
		}
	}

	/** 新建工作区并进入。 */
	async function handleCreateWorkspace(name: string): Promise<void> {
		try {
			const meta = await workspaceService.createWorkspace(name);
			entered = true;
			tab = 'chat';
			workspaceModalOpen = false;
			toasts.success(`工作区「${meta.name}」已创建`);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 重命名工作区。 */
	async function handleRenameWorkspace(id: string, name: string): Promise<void> {
		try {
			await workspaces.rename(id, name);
			refreshWorkspaceList();
			toasts.success('工作区已重命名');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 复制工作区：service 自动生成不重名的「xx 副本」并切换过去。 */
	async function handleDuplicateWorkspace(id: string): Promise<void> {
		if (switchingWorkspace) {
			return;
		}
		const source = workspaces.getById(id);
		if (source === undefined) {
			return;
		}
		switchingWorkspace = true;
		try {
			const meta = await workspaceService.duplicateWorkspace(id, `${source.name} 副本`);
			entered = true;
			workspaceModalOpen = false;
			toasts.success(`已复制为「${meta.name}」并切换过去`);
		} catch (err) {
			toasts.error(err);
		} finally {
			switchingWorkspace = false;
		}
	}

	/** 删除工作区（确认弹窗展示数据量；删除当前工作区会自动切走）。 */
	async function handleDeleteWorkspace(id: string): Promise<void> {
		const meta = workspaces.getById(id);
		if (meta === undefined) {
			return;
		}
		try {
			const [snapshotCount, worldInfoCount, memoryCount] = await Promise.all([
				snapshotRepo.count(id),
				worldInfoRepo.getAll(id).then((entries) => entries.length),
				memoryRepo.getAll(id).then((entries) => entries.length)
			]);
			if (
				!window.confirm(
					`删除工作区「${meta.name}」？将移除 ${snapshotCount} 个快照、${worldInfoCount} 条世界信息、${memoryCount} 条记忆，且不可恢复。`
				)
			) {
				return;
			}
		} catch (err) {
			toasts.error(err);
			return;
		}
		if (switchingWorkspace) {
			return;
		}
		switchingWorkspace = true;
		try {
			await workspaceService.removeWorkspace(id);
			toasts.success(`工作区「${meta.name}」已删除`);
		} catch (err) {
			toasts.error(err);
		} finally {
			switchingWorkspace = false;
		}
	}

	/** 导出任意工作区（含非当前工作区）为 .cbox。 */
	async function handleExportWorkspaceById(id: string): Promise<void> {
		try {
			const meta = workspaces.getById(id);
			const safeName = (meta?.name ?? 'workspace').replace(/[\\/:*?"<>|]/g, '_');
			const bytes = await workspaceService.exportWorkspace(id);
			const saved = await downloadBytes(`cosbox-${safeName}-${stamp()}.cbox`, bytes);
			toasts.success(saved !== null ? `工作区已导出，保存于：${saved}` : '工作区已导出');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 导入 .cbox 为新工作区并切换过去。 */
	async function handleImportAsNewWorkspace(file: File): Promise<void> {
		if (switchingWorkspace) {
			return;
		}
		switchingWorkspace = true;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const data = parseWorkspace(bytes);
			const meta = await workspaceService.importAsNewWorkspace(data);
			entered = true;
			tab = 'chat';
			workspaceModalOpen = false;
			toasts.success(`已导入为新工作区「${meta.name}」`);
		} catch (err) {
			toasts.error(err);
		} finally {
			switchingWorkspace = false;
		}
	}

	/** 退出到工作区选择初始界面（生成中不可退出）。 */
	function handleExitToLanding(): void {
		if (busy) {
			toasts.push('info', '请先停止当前生成，再退出到工作区选择');
			return;
		}
		syncService.stop();
		workspaceModalOpen = false;
		mobileNavOpen = false;
		mobileStateOpen = false;
		entered = false;
	}

	/** 保存主题（即时生效，SettingsPanel 在每次修改时调用）。 */
	async function handleSaveTheme(next: ThemeConfig): Promise<void> {
		try {
			await settings.saveTheme(next);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 连接测试：用当前草稿配置验证服务器可用。 */
	async function handleTestSync(draft: SyncSettings): Promise<SyncResult> {
		return syncService.testConnection(draft);
	}

	/** 手动立即同步（先拉远端较新数据，再推送本地）。 */
	async function handleSyncNow(): Promise<SyncResult> {
		return syncService.syncNow();
	}

	/** 获取模型列表（使用设置面板当前草稿配置）。失败返回空列表并由面板显示 toast。 */
	async function handleFetchModels(draft: LlmConfig): Promise<FetchedModel[]> {
		try {
			const models = await fetchModelList(draft.baseUrl, draft.apiKey);
			toasts.success(`获取到 ${models.length} 个模型`);
			return models;
		} catch (err) {
			toasts.error(err);
			return [];
		}
	}

	/** 连接测试：验证当前草稿配置的端点与 API Key 是否可用。 */
	async function handleTestConnection(draft: LlmConfig): Promise<void> {
		try {
			await testConnection(draft.baseUrl, draft.apiKey);
			toasts.success('连接成功，API 可用');
		} catch (err) {
			toasts.error(err);
		}
	}

	async function handleImport(text: string): Promise<void> {
		try {
			const card = parseCharaCard(text);
			const mapped = mapCardToCosBox(card);
			await session.update(mapped.statePatch, { desc: `导入角色卡「${card.data.name}」` });
			await worldInfo.importEntries(mapped.worldInfo);
			if (mapped.systemPrompt !== null) {
				await settings.saveProfile({ name: card.data.name, systemPrompt: mapped.systemPrompt });
			}
			if (mapped.greeting !== null) {
				await session.addMessage('assistant', mapped.greeting);
			}
			toasts.success(`角色卡「${card.data.name}」导入成功`);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** AI 生成（地点/衣柜/日程）：走当前模型服务 + review_generation 审查循环。 */
	async function handleAiGenerate(request: GenerationRequest): Promise<GenerationResult> {
		const genConfig = roleConfig('generator');
		const service = new GeneratorService(genConfig.provider === 'demo' ? demoClient : openAiClient);
		return service.generate(request, genConfig);
	}

	/** AI 生成结果批量导入：合并去重后作为世界配置（不生成快照）。 */
	async function handleAiImport(kind: GeneratorKind, items: GeneratedItem[]): Promise<void> {
		const existing: GeneratedItem[] =
			kind === 'locations'
				? session.state.places
				: kind === 'wardrobe'
					? session.state.outfit.wardrobe
					: session.state.schedule.entries;
		const patch = buildImportPatch(kind, items, existing);
		await session.applyConfig(patch);
		toasts.success(`已导入 ${items.length} 项到${KIND_LABELS[kind]}`);
	}

	/** 导出单个配置段（地点/衣柜/日程）为 JSON 模板。 */
	async function handleExportConfig(kind: GeneratorKind, items: GeneratedItem[]): Promise<void> {
		try {
			const saved = await downloadTextFile(
				`${KIND_LABELS[kind]}-${stamp()}.json`,
				serializeConfigPart(kind, items)
			);
			toasts.success(
				saved !== null
					? `已导出${KIND_LABELS[kind]}，保存于：${saved}`
					: `已导出${KIND_LABELS[kind]}`
			);
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 导入单个配置段：解析、去重合并进世界配置。 */
	async function handleImportConfig(kind: GeneratorKind, raw: string): Promise<void> {
		const parsed = parseConfigPart(kind, raw);
		if (parsed.issues.length > 0) {
			toasts.error(parsed.issues.join('；'));
			return;
		}
		const existing: GeneratedItem[] =
			kind === 'locations'
				? session.state.places
				: kind === 'wardrobe'
					? session.state.outfit.wardrobe
					: session.state.schedule.entries;
		const names = new Set(existing.map((item) => itemKeyFor(kind, item)));
		const freshCount = parsed.items.filter((item) => !names.has(itemKeyFor(kind, item))).length;
		await session.applyConfig(buildImportPatch(kind, parsed.items, existing));
		toasts.success(`已导入 ${freshCount} 项到${KIND_LABELS[kind]}`);
	}

	/**
	 * 应用工作区数据到当前工作区：校验快照链后整体恢复本地
	 * （保留当前模型配置与 Key）。仅用于「导入到当前工作区」。
	 */
	async function applyWorkspaceData(data: WorkspaceData): Promise<void> {
		if (data.headId !== null) {
			rebuildFromNodes(
				new Map(data.snapshots.map((node) => [node.id, node])),
				data.headId,
				createInitialState()
			);
		}
		await snapshotRepo.clearAll();
		await snapshotRepo.bulkAdd(data.snapshots);
		await worldInfo.clear();
		await worldInfo.importEntries(data.worldInfo);
		await memoryRepo.clear();
		await memoryRepo.bulkPut(data.memories ?? []);
		await memoryStore.load();
		await settings.saveProfile(data.profile);
		await settings.saveDeveloperMode(data.developerMode);
		await manager.restoreWorkspace(data.config, data.headId);
		// 导入整体替换了剧情数据：压缩边界/调试视图/最近日志一并复位。
		compactState = null;
		debugPrompt = null;
		lastJudgeDebug = null;
		lastAutoExtractCount = 0;
		recentLog = '';
		lastContext = { bundle: null, usage: null, compaction: null, keptRecent: 0 };
	}

	/** 导出当前工作区：除模型配置外的全部数据打包为 .cbox。 */
	async function handleExportWorkspace(): Promise<void> {
		try {
			const bytes = await workspaceService.exportWorkspace(scope.get());
			const saved = await downloadBytes(`cosbox-${stamp()}.cbox`, bytes);
			toasts.success(saved !== null ? `工作区已导出，保存于：${saved}` : '工作区已导出');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 导入工作区到当前工作区：校验后整体恢复（保留当前模型配置与 Key）。 */
	async function handleImportWorkspace(file: File): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const data = parseWorkspace(bytes);
		await applyWorkspaceData(data);
		toasts.success('工作区已导入');
	}

	/** 生成文件名时间戳：YYYYMMDD-HHmm。 */
	function stamp(): string {
		const now = new Date();
		const pad = (value: number): string => String(value).padStart(2, '0');
		return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
	}

	async function handleExport(): Promise<void> {
		try {
			const attributes = session.state.attributes;
			const name =
				settings.profile.name || (typeof attributes.name === 'string' ? attributes.name : '角色');
			const tags =
				typeof attributes.tags === 'string'
					? attributes.tags
							.split(',')
							.map((tag) => tag.trim())
							.filter((tag) => tag !== '')
					: undefined;
			const card = buildCharaCardV3({
				name,
				systemPrompt: settings.profile.systemPrompt,
				worldInfo: worldInfo.entries,
				conversation: session.conversation,
				creator: typeof attributes.creator === 'string' ? attributes.creator : undefined,
				characterVersion:
					typeof attributes.character_version === 'string'
						? attributes.character_version
						: undefined,
				tags
			});
			const saved = await downloadTextFile(`${name}.chara-v3.json`, serializeCharaCard(card));
			toasts.success(saved !== null ? `角色卡已导出，保存于：${saved}` : '角色卡已导出');
		} catch (err) {
			toasts.error(err);
		}
	}

	/** 导出最近消息日志（从最近一次用户发言开始的全部文本）。 */
	async function handleExportLog(): Promise<void> {
		if (recentLog.trim() === '') {
			toasts.push('info', '暂无最近日志，发送一条消息后即可导出');
			return;
		}
		try {
			const saved = await downloadTextFile(`cosbox-log-${stamp()}.txt`, recentLog);
			toasts.success(saved !== null ? `最近日志已导出，保存于：${saved}` : '最近日志已导出');
		} catch (err) {
			toasts.error(err);
		}
	}
</script>

<div class="app" class:nav-open={mobileNavOpen}>
	<!-- 主题背景图图层：图片与透明度由 JS 直接设置，不走 CSS 变量
	     （超长 data URL 存 CSS 变量在部分浏览器会解析失败）。 -->
	<div class="theme-backdrop" aria-hidden="true"></div>
	{#if entered}
		<header class="header">
			{#if isMobile}
				<button
					class="mobile-nav-toggle"
					aria-label="打开菜单"
					title="菜单"
					onclick={() => (mobileNavOpen = !mobileNavOpen)}
				>
					☰
				</button>
			{/if}
			<div class="brand">
				<span class="brand-mark">C</span>
				<span>CosBox</span>
			</div>
			<div class="header-spacer"></div>
			{#if isMobile}
				<button
					class="mobile-state-toggle"
					aria-label="实时状态"
					title="实时状态"
					onclick={() => (mobileStateOpen = !mobileStateOpen)}
				>
					{formatWorldTime(session.state.schedule.time)} · {session.state.location.name}
				</button>
			{/if}
			<span class="chip"
				><span class="dot"></span>{formatWorldTime(session.state.schedule.time)}</span
			>
			<span class="chip ok"><span class="dot"></span>{providerLabel}</span>
			<span class="chip"><span class="dot"></span>{session.snapshots.length} 快照</span>
			{#if busy}
				<span class="chip busy"><span class="dot"></span>思考中…</span>
			{/if}
		</header>
	{/if}

	{#if entered && isMobile && mobileStateOpen}
		<div class="mobile-state-panel" role="dialog" aria-label="实时状态">
			<div class="mobile-state-head">
				<span>实时状态</span>
				<button
					class="btn btn-small"
					aria-label="关闭状态面板"
					onclick={() => (mobileStateOpen = false)}>关闭</button
				>
			</div>
			<div class="mobile-state-body">
				<StatePreview characterState={session.state} />
				<ContextPanel
					config={activeChatConfig}
					context={lastContext.bundle}
					usage={lastContext.usage}
					restored={restoredContextSummary}
					compaction={lastContext.compaction}
					autoCompact={settings.config.autoCompact === true}
					compactThreshold={settings.config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD}
					{compacting}
					onCompactNow={handleCompactNow}
				/>
			</div>
		</div>
	{/if}

	<div class="body" class:landing={!entered}>
		{#if entered && isMobile}
			<div
				class="nav-backdrop"
				class:show={mobileNavOpen}
				role="presentation"
				onclick={() => (mobileNavOpen = false)}
			></div>
		{/if}
		{#if entered}
			<NavRail
				active={tab}
				workspaceName={currentWorkspaceName}
				onOpenWorkspace={() => (workspaceModalOpen = true)}
				onExitToLanding={handleExitToLanding}
				onSelect={(next) => {
					tab = next;
					mobileNavOpen = false;
				}}
			/>
		{/if}
		<main class="content" class:full={!entered}>
			{#if !booted}
				<div class="panel">
					<p class="empty-hint">正在加载本地数据库…</p>
				</div>
			{:else if !entered}
				<WorkspaceHome
					workspaces={workspaceList}
					currentId={currentWorkspaceId}
					busy={switchingWorkspace}
					onEnter={handleEnterWorkspace}
					onCreate={handleCreateWorkspace}
					onRename={handleRenameWorkspace}
					onDuplicate={handleDuplicateWorkspace}
					onDelete={handleDeleteWorkspace}
					onExport={handleExportWorkspaceById}
					onImportFile={handleImportAsNewWorkspace}
				/>
			{:else if tab === 'chat'}
				<ChatPanel
					conversation={session.conversation}
					characterState={session.state}
					config={activeChatConfig}
					context={lastContext.bundle}
					usage={lastContext.usage}
					restored={restoredContextSummary}
					compaction={lastContext.compaction}
					autoCompact={settings.config.autoCompact === true}
					compactThreshold={settings.config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD}
					{compacting}
					onCompactNow={handleCompactNow}
					{busy}
					{searchSupported}
					{searching}
					developerMode={settings.developerMode}
					{debugPrompt}
					judgeDebug={lastJudgeDebug}
					onPreview={handlePreview}
					onSend={handleSend}
					onEditMessage={handleEditMessage}
					{recentLog}
					onExportLog={handleExportLog}
					{streamingSegments}
					{streamingPhase}
					branches={session.branches}
					snapshots={session.snapshots}
					headId={session.headId}
					allowStateTools={settings.config.allowAiStateTools === true}
					onRetry={handleRetry}
					onConfirmState={handleConfirmState}
					onSwitchBranch={handleSwitchBranch}
					onStop={handleStop}
				/>
			{:else if tab === 'state'}
				<StatePanel characterState={session.state} onUpdate={handleStateUpdate} />
			{:else if tab === 'locations'}
				<LocationsPanel
					places={session.state.places}
					location={session.state.location}
					onUpdate={handleStateUpdate}
					onConfig={handleConfigUpdate}
					onAiGenerate={handleAiGenerate}
					onAiImport={handleAiImport}
					onExportConfig={handleExportConfig}
					onImportConfig={handleImportConfig}
				/>
			{:else if tab === 'wardrobe'}
				<WardrobePanel
					outfit={session.state.outfit}
					onUpdate={handleStateUpdate}
					onConfig={handleConfigUpdate}
					onAiGenerate={handleAiGenerate}
					onAiImport={handleAiImport}
					onExportConfig={handleExportConfig}
					onImportConfig={handleImportConfig}
				/>
			{:else if tab === 'schedule'}
				<SchedulePanel
					schedule={session.state.schedule}
					onAdvance={handleAdvance}
					onConfig={handleConfigUpdate}
					onAiGenerate={handleAiGenerate}
					onAiImport={handleAiImport}
					onExportConfig={handleExportConfig}
					onImportConfig={handleImportConfig}
				/>
			{:else if tab === 'versions'}
				<VersionPanel
					snapshots={session.snapshots}
					headId={session.headId}
					branches={session.branches}
					onCheckout={handleCheckout}
					onAddCheckpoint={handleCheckpoint}
					onDeleteBranch={handleDeleteBranch}
					onDeleteBranches={handleDeleteBranches}
				/>
			{:else if tab === 'world'}
				<WorldInfoPanel
					entries={worldInfo.entries}
					onUpsert={handleWorldUpsert}
					onRemove={handleWorldRemove}
				/>
			{:else if tab === 'memory'}
				<MemoryPanel
					entries={memoryStore.sorted}
					extracting={memoryExtracting}
					onAdd={handleMemoryAdd}
					onUpdate={handleMemoryUpdate}
					onRemove={handleMemoryRemove}
					onExtract={handleMemoryExtract}
					onImportExtracted={handleMemoryImportExtracted}
				/>
			{:else if tab === 'monitor'}
				<MonitorPanel
					counters={metrics.counters}
					turns={metrics.turns}
					events={metrics.events}
					onReset={() => {
						void metrics.reset().then(() => toasts.success('已清空监控数据'));
					}}
				/>
			{:else if tab === 'transfer'}
				<ImportExportPanel onImport={handleImport} onExport={handleExport} />
			{:else}
				<SettingsPanel
					config={settings.config}
					profile={settings.profile}
					developerMode={settings.developerMode}
					syncSettings={settings.sync}
					onSaveConfig={handleSaveConfig}
					onSaveProfile={handleSaveProfile}
					onResetProfile={handleResetProfile}
					onSaveDeveloperMode={handleSaveDeveloperMode}
					onSaveSync={handleSaveSync}
					onTestSync={handleTestSync}
					onSyncNow={handleSyncNow}
					theme={settings.theme}
					onSaveTheme={handleSaveTheme}
					onAutoSaveConfig={handleAutoSaveConfig}
					onFetchModels={handleFetchModels}
					onTestConnection={handleTestConnection}
					onExportWorkspace={handleExportWorkspace}
					onImportWorkspace={handleImportWorkspace}
				/>
			{/if}
		</main>
	</div>

	{#if entered && workspaceModalOpen}
		<WorkspaceModal
			workspaces={workspaceList}
			currentId={currentWorkspaceId}
			busy={busy || switchingWorkspace}
			onClose={() => (workspaceModalOpen = false)}
			onEnter={handleEnterWorkspace}
			onCreate={handleCreateWorkspace}
			onRename={handleRenameWorkspace}
			onDuplicate={handleDuplicateWorkspace}
			onDelete={handleDeleteWorkspace}
			onExport={handleExportWorkspaceById}
			onImportFile={handleImportAsNewWorkspace}
		/>
	{/if}

	<Toasts toasts={toasts.toasts} onDismiss={(id) => toasts.remove(id)} />
</div>
