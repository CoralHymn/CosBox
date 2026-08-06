<script lang="ts">
	import { onMount } from 'svelte';
	import type { ChatMessageView, ConfigPatch, StatePatch, WorldInfoEntry } from '../lib/core/types';
	import { formatWorldTime } from '../lib/core/state';
	import {
		buildContext,
		type ContextBundle,
		type ContextPipelineInput
	} from '../lib/context/pipeline';
	import { KvRepository } from '../lib/db/kv-repo';
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
	import {
		parseWorkspace,
		serializeWorkspace,
		type WorkspaceData
	} from '../lib/import-export/workspace';
	import {
		ChatService,
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
	import { resolveContextWindow } from '../lib/llm/model-info';
	import { sanitizeAssistantText } from '../lib/llm/message-time';
	import { OpenAiCompatibleClient } from '../lib/llm/openai-client';
	import { findProviderPreset } from '../lib/llm/providers';
	import { fetchModelList, testConnection, type FetchedModel } from '../lib/llm/model-service';
	import type { JudgeDebugView } from '../lib/llm/state-judge';
	import { STATE_TOOLS } from '../lib/llm/state-tools';
	import type { LlmConfig, TokenUsage } from '../lib/llm/types';
	import { rebuildFromNodes } from '../lib/core/snapshot';
	import { createInitialState } from '../lib/core/state';
	import type { SearchResult } from '../lib/search/types';
	import { WebSearchClient } from '../lib/search/search-client';
	import type { AppProfile } from '../lib/stores/settings.svelte';
	import { CharacterManager } from '../lib/manager/character-manager';
	import { applySlashCommand, parseSlashCommand, type SlashCommand } from '../lib/utils/slash';
	import { createCharacterSession } from '../lib/stores/character.svelte';
	import { createSettingsStore } from '../lib/stores/settings.svelte';
	import { createToasts, type TabId } from '../lib/stores/ui.svelte';
	import { createWorldInfoStore } from '../lib/stores/world-info.svelte';
	import { downloadBytes, downloadTextFile } from '../lib/utils/download';
	import ChatPanel from '../lib/components/ChatPanel.svelte';
	import ContextPanel from '../lib/components/ContextPanel.svelte';
	import ImportExportPanel from '../lib/components/ImportExportPanel.svelte';
	import LocationsPanel from '../lib/components/LocationsPanel.svelte';
	import NavRail from '../lib/components/NavRail.svelte';
	import SchedulePanel from '../lib/components/SchedulePanel.svelte';
	import SettingsPanel from '../lib/components/SettingsPanel.svelte';
	import StatePreview from '../lib/components/StatePreview.svelte';
	import StatePanel from '../lib/components/StatePanel.svelte';
	import Toasts from '../lib/components/Toasts.svelte';
	import VersionPanel from '../lib/components/VersionPanel.svelte';
	import WardrobePanel from '../lib/components/WardrobePanel.svelte';
	import WorldInfoPanel from '../lib/components/WorldInfoPanel.svelte';

	const db = getDb();
	const snapshotRepo = new SnapshotRepository(db);
	const manager = new CharacterManager({
		snapshots: snapshotRepo,
		kv: new KvRepository(db)
	});
	const session = createCharacterSession(manager);
	const settings = createSettingsStore(new KvRepository(db));
	const worldInfo = createWorldInfoStore(new WorldInfoRepository(db));
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
	let ready = $state(false);
	/** 开发者模式下展示的最近一次发送给 AI 的完整提示词。 */
	let debugPrompt = $state<DebugPromptView | null>(null);
	/** 最近一次请求的上下文包、用量与压缩状态（供侧栏上下文面板展示）。 */
	let lastContext = $state<{
		bundle: ContextBundle | null;
		usage: TokenUsage | null;
		compaction: CompactionState | null;
	}>({
		bundle: null,
		usage: null,
		compaction: null
	});
	/** 跨请求延续的压缩状态（摘要 + 边界）；只影响发送给模型的内容。 */
	let compactState = $state<CompactionState | null>(null);
	/** 正在执行手动压缩。 */
	let compacting = $state(false);
	/** 流式输出草稿：正在生成、尚未落快照的 assistant 文本。 */
	let streamingDraft = $state<string | null>(null);
	/** 最近一次 LLM 状态判断的调试视图（开发者模式查看）。 */
	let lastJudgeDebug = $state<JudgeDebugView | null>(null);

	const providerLabel = $derived.by(() => {
		if (settings.config.provider === 'demo') {
			return '演示模式';
		}
		const preset = findProviderPreset(settings.config.providerId);
		if (preset) {
			return `${preset.label} · ${settings.config.model}`;
		}
		return settings.config.model || 'OpenAI-compatible';
	});

	const searchSupported = $derived(
		settings.config.webSearch.enabled && settings.config.webSearch.apiKey.trim() !== ''
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

	onMount(async () => {
		try {
			await manager.init();
			await worldInfo.init();
			await settings.load();
		} catch (err) {
			toasts.error(err);
		} finally {
			ready = true;
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
				await handleSlashCommand(command);
				return;
			}
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
			const input: ContextPipelineInput = {
				state: session.state,
				conversation: session.conversation,
				worldInfo: worldInfo.entries,
				enableStateTools: settings.config.allowAiStateTools === true,
				characterName:
					settings.profile.name ||
					(typeof session.state.attributes.name === 'string'
						? session.state.attributes.name
						: undefined),
				systemPrompt: settings.profile.systemPrompt ?? undefined,
				...(searchResults !== undefined ? { searchResults } : {})
			};
			const service = new ChatService(
				settings.config.provider === 'demo' ? demoClient : openAiClient
			);
			const contextWindow = resolveContextWindow(
				settings.config.modelContextWindow,
				settings.config.model
			);
			const compactionOptions =
				settings.config.autoCompact === true
					? {
							contextWindow,
							threshold: settings.config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
							keepRecent: DEFAULT_KEEP_RECENT,
							state: compactState
						}
					: undefined;
			streamingDraft = '';
			const {
				reply,
				debug,
				bundle,
				usage,
				compaction,
				thinking,
				finishReason,
				judgeDebug,
				rounds
			} = await service.generateReply(input, settings.config, {
				onDelta: (delta) => {
					// 边生成边剔除模型误输出的时间标注，保持流式展示与最终落库一致。
					streamingDraft = sanitizeAssistantText(`${streamingDraft ?? ''}${delta}`);
				},
				tools: settings.config.allowAiStateTools === true ? [...STATE_TOOLS] : [],
				toolContext: {
					getState: () => session.state,
					update: (patch, metadata) => session.update(patch, metadata),
					advanceTime: (minutes) => session.advanceTime(minutes)
				},
				enableStateJudge: settings.config.llmStateConfirm === true,
				...(compactionOptions !== undefined ? { compaction: compactionOptions } : {})
			});
			debugPrompt = debug;
			lastJudgeDebug = judgeDebug;
			lastContext = { bundle, usage: usage ?? null, compaction };
			compactState = compaction;
			streamingDraft = null;
			// AI 一次回复可包含多段：每轮先落叙事文本，再把工具调用反馈持久化为
			// 系统消息（前端可见、后续上下文持续携带）。
			for (const round of rounds) {
				if (round.content !== null && round.content.trim() !== '') {
					await session.addMessage('assistant', round.content, {
						thinking: round.thinking
					});
				}
				for (const tool of round.tools) {
					await session.addMessage('system', `【工具调用】${tool.name}：${tool.output}`);
				}
			}
			const budgetExhausted = finishReason === 'length';
			if (reply.trim() !== '') {
				await session.addMessage('assistant', reply, { thinking });
			} else if (thinking !== undefined && thinking.trim() !== '') {
				// 模型只输出了思考过程、正文为空：保留思考（对话气泡可展开），正文留空。
				await session.addMessage('assistant', '', { thinking });
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
			} else {
				toasts.push(
					'info',
					budgetExhausted
						? '模型输出被 Max Tokens 上限截断，正文为空。请在「设置 → 模型服务」调大 Max Tokens（思考型模型建议 4096 以上）。'
						: '模型返回了空回复，本轮未追加消息，请重试或换一种说法。'
				);
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			streamingDraft = null;
			busy = false;
			searching = false;
		}
	}

	/** 手动压缩：立即把早期对话总结为摘要，供下次请求使用。 */
	async function handleCompactNow(): Promise<void> {
		if (busy || compacting) {
			return;
		}
		compacting = true;
		try {
			const service = new ChatService(
				settings.config.provider === 'demo' ? demoClient : openAiClient
			);
			const result = await service.compactConversation(session.conversation, settings.config, {
				state: compactState,
				keepRecent: DEFAULT_KEEP_RECENT
			});
			compactState = result.state;
			if (result.state === null) {
				toasts.push('info', '对话较短，暂无需压缩');
			} else {
				lastContext = { ...lastContext, compaction: result.state };
				toasts.success('已生成上下文摘要，将在下次请求使用');
			}
		} catch (err) {
			toasts.error(err);
		} finally {
			compacting = false;
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
			characterName:
				settings.profile.name ||
				(typeof session.state.attributes.name === 'string'
					? session.state.attributes.name
					: undefined),
			systemPrompt: settings.profile.systemPrompt ?? undefined,
			historyOptions: { maxMessages: Math.max(1, conversation.length) }
		};
		const bundle = buildContext(input);
		const notes: string[] = [];
		if (settings.config.autoCompact === true) {
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
					model: settings.config.model,
					maxTokens: settings.config.maxTokens,
					stream: settings.config.stream === true,
					toolsEnabled: settings.config.allowAiStateTools === true
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
		const service = new GeneratorService(
			settings.config.provider === 'demo' ? demoClient : openAiClient
		);
		return service.generate(request, settings.config);
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
	function handleExportConfig(kind: GeneratorKind, items: GeneratedItem[]): void {
		downloadTextFile(`${KIND_LABELS[kind]}-${stamp()}.json`, serializeConfigPart(kind, items));
		toasts.success(`已导出${KIND_LABELS[kind]}`);
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

	/** 导出工作区：除模型配置外的全部数据打包为 .cbox。 */
	function handleExportWorkspace(): void {
		const data: WorkspaceData = {
			profile: settings.profile,
			developerMode: settings.developerMode,
			worldInfo: worldInfo.entries,
			config: {
				places: session.state.places,
				wardrobe: session.state.outfit.wardrobe,
				scheduleEntries: session.state.schedule.entries
			},
			headId: session.headId,
			snapshots: session.snapshots
		};
		downloadBytes(`cosbox-${stamp()}.cbox`, serializeWorkspace(data));
		toasts.success('工作区已导出');
	}

	/** 导入工作区：校验后整体恢复（保留当前模型配置与 Key）。 */
	async function handleImportWorkspace(file: File): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const data = parseWorkspace(bytes);
		// 导入前校验快照链可重建，避免写入损坏数据。
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
		await settings.saveProfile(data.profile);
		await settings.saveDeveloperMode(data.developerMode);
		await manager.restoreWorkspace(data.config, data.headId);
		toasts.success('工作区已导入');
	}

	/** 生成文件名时间戳：YYYYMMDD-HHmm。 */
	function stamp(): string {
		const now = new Date();
		const pad = (value: number): string => String(value).padStart(2, '0');
		return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
	}

	function handleExport(): void {
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
			downloadTextFile(`${name}.chara-v3.json`, serializeCharaCard(card));
			toasts.success('角色卡已导出');
		} catch (err) {
			toasts.error(err);
		}
	}
</script>

<div class="app" class:nav-open={mobileNavOpen}>
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
		{#if ready && isMobile}
			<button
				class="mobile-state-toggle"
				aria-label="实时状态"
				title="实时状态"
				onclick={() => (mobileStateOpen = !mobileStateOpen)}
			>
				{formatWorldTime(session.state.schedule.time)} · {session.state.location.name}
			</button>
		{/if}
		{#if ready}
			<span class="chip"
				><span class="dot"></span>{formatWorldTime(session.state.schedule.time)}</span
			>
			<span class="chip ok"><span class="dot"></span>{providerLabel}</span>
			<span class="chip"><span class="dot"></span>{session.snapshots.length} 快照</span>
			{#if busy}
				<span class="chip busy"><span class="dot"></span>思考中…</span>
			{/if}
		{/if}
	</header>

	{#if isMobile && mobileStateOpen}
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
					config={settings.config}
					context={lastContext.bundle}
					usage={lastContext.usage}
					compaction={lastContext.compaction}
					autoCompact={settings.config.autoCompact === true}
					compactThreshold={settings.config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD}
					{compacting}
					onCompactNow={handleCompactNow}
				/>
			</div>
		</div>
	{/if}

	<div class="body">
		{#if isMobile}
			<div
				class="nav-backdrop"
				class:show={mobileNavOpen}
				role="presentation"
				onclick={() => (mobileNavOpen = false)}
			></div>
		{/if}
		<NavRail
			active={tab}
			onSelect={(next) => {
				tab = next;
				mobileNavOpen = false;
			}}
		/>
		<main class="content">
			{#if !ready}
				<div class="panel">
					<p class="empty-hint">正在加载本地数据库…</p>
				</div>
			{:else if tab === 'chat'}
				<ChatPanel
					conversation={session.conversation}
					characterState={session.state}
					config={settings.config}
					context={lastContext.bundle}
					usage={lastContext.usage}
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
					{streamingDraft}
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
			{:else if tab === 'transfer'}
				<ImportExportPanel onImport={handleImport} onExport={handleExport} />
			{:else}
				<SettingsPanel
					config={settings.config}
					profile={settings.profile}
					developerMode={settings.developerMode}
					onSaveConfig={handleSaveConfig}
					onSaveProfile={handleSaveProfile}
					onResetProfile={handleResetProfile}
					onSaveDeveloperMode={handleSaveDeveloperMode}
					onFetchModels={handleFetchModels}
					onTestConnection={handleTestConnection}
					onExportWorkspace={handleExportWorkspace}
					onImportWorkspace={handleImportWorkspace}
				/>
			{/if}
		</main>
	</div>

	<Toasts toasts={toasts.toasts} onDismiss={(id) => toasts.remove(id)} />
</div>
