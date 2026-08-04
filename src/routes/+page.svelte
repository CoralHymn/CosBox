<script lang="ts">
	import { onMount } from 'svelte';
	import type { StatePatch, WorldInfoEntry } from '../lib/core/types';
	import { formatWorldTime } from '../lib/core/state';
	import type { ContextPipelineInput } from '../lib/context/pipeline';
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
	import { ChatService } from '../lib/llm/chat-service';
	import { DemoLlmClient } from '../lib/llm/demo-provider';
	import { OpenAiCompatibleClient } from '../lib/llm/openai-client';
	import { findProviderPreset } from '../lib/llm/providers';
	import { STATE_TOOLS } from '../lib/llm/state-tools';
	import type { SearchResult } from '../lib/search/types';
	import { WebSearchClient } from '../lib/search/search-client';
	import type { AppProfile } from '../lib/stores/settings.svelte';
	import { CharacterManager } from '../lib/manager/character-manager';
	import { applySlashCommand, parseSlashCommand, type SlashCommand } from '../lib/utils/slash';
	import { createCharacterSession } from '../lib/stores/character.svelte';
	import { createSettingsStore } from '../lib/stores/settings.svelte';
	import { createToasts, type TabId } from '../lib/stores/ui.svelte';
	import { createWorldInfoStore } from '../lib/stores/world-info.svelte';
	import { downloadTextFile } from '../lib/utils/download';
	import ChatPanel from '../lib/components/ChatPanel.svelte';
	import ImportExportPanel from '../lib/components/ImportExportPanel.svelte';
	import LocationsPanel from '../lib/components/LocationsPanel.svelte';
	import NavRail from '../lib/components/NavRail.svelte';
	import SchedulePanel from '../lib/components/SchedulePanel.svelte';
	import SettingsPanel from '../lib/components/SettingsPanel.svelte';
	import StatePanel from '../lib/components/StatePanel.svelte';
	import Toasts from '../lib/components/Toasts.svelte';
	import VersionPanel from '../lib/components/VersionPanel.svelte';
	import WardrobePanel from '../lib/components/WardrobePanel.svelte';
	import WorldInfoPanel from '../lib/components/WorldInfoPanel.svelte';

	const db = getDb();
	const manager = new CharacterManager({
		snapshots: new SnapshotRepository(db),
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
	let busy = $state(false);
	let searching = $state(false);
	let ready = $state(false);

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
			const { reply } = await service.generateReply(input, settings.config, {
				tools: settings.config.allowAiStateTools === true ? [...STATE_TOOLS] : [],
				toolContext: {
					getState: () => session.state,
					update: (patch, metadata) => session.update(patch, metadata),
					advanceTime: (minutes) => session.advanceTime(minutes)
				}
			});
			await session.addMessage('assistant', reply);
		} catch (err) {
			toasts.error(err);
		} finally {
			busy = false;
			searching = false;
		}
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
			await session.addMessage('system', result.helpText);
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

<div class="app">
	<header class="header">
		<div class="brand">
			<span class="brand-mark">C</span>
			<span>CosBox</span>
		</div>
		<div class="header-spacer"></div>
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

	<div class="body">
		<NavRail active={tab} onSelect={(next) => (tab = next)} />
		<main class="content">
			{#if !ready}
				<div class="panel">
					<p class="empty-hint">正在加载本地数据库…</p>
				</div>
			{:else if tab === 'chat'}
				<ChatPanel
					conversation={session.conversation}
					characterState={session.state}
					{busy}
					{searchSupported}
					{searching}
					onSend={handleSend}
				/>
			{:else if tab === 'state'}
				<StatePanel characterState={session.state} onUpdate={handleStateUpdate} />
			{:else if tab === 'locations'}
				<LocationsPanel
					places={session.state.places}
					location={session.state.location}
					onUpdate={handleStateUpdate}
				/>
			{:else if tab === 'wardrobe'}
				<WardrobePanel outfit={session.state.outfit} onUpdate={handleStateUpdate} />
			{:else if tab === 'schedule'}
				<SchedulePanel
					schedule={session.state.schedule}
					onUpdate={handleStateUpdate}
					onAdvance={handleAdvance}
				/>
			{:else if tab === 'versions'}
				<VersionPanel
					snapshots={session.snapshots}
					headId={session.headId}
					branches={session.branches}
					onCheckout={handleCheckout}
					onAddCheckpoint={handleCheckpoint}
					onDeleteBranch={handleDeleteBranch}
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
					onSaveConfig={handleSaveConfig}
					onSaveProfile={handleSaveProfile}
				/>
			{/if}
		</main>
	</div>

	<Toasts toasts={toasts.toasts} onDismiss={(id) => toasts.remove(id)} />
</div>
