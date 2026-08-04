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
	import type { AppProfile } from '../lib/stores/settings.svelte';
	import { CharacterManager } from '../lib/manager/character-manager';
	import { createCharacterSession } from '../lib/stores/character.svelte';
	import { createSettingsStore } from '../lib/stores/settings.svelte';
	import { createToasts, type TabId } from '../lib/stores/ui.svelte';
	import { createWorldInfoStore } from '../lib/stores/world-info.svelte';
	import { downloadTextFile } from '../lib/utils/download';
	import ChatPanel from '../lib/components/ChatPanel.svelte';
	import ImportExportPanel from '../lib/components/ImportExportPanel.svelte';
	import NavRail from '../lib/components/NavRail.svelte';
	import SchedulePanel from '../lib/components/SchedulePanel.svelte';
	import SettingsPanel from '../lib/components/SettingsPanel.svelte';
	import StatePanel from '../lib/components/StatePanel.svelte';
	import Toasts from '../lib/components/Toasts.svelte';
	import VersionPanel from '../lib/components/VersionPanel.svelte';
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

	let tab = $state<TabId>('chat');
	let busy = $state(false);
	let ready = $state(false);

	const providerLabel = $derived(
		settings.config.provider === 'demo' ? '演示模式' : settings.config.model || 'OpenAI-compatible'
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

	async function handleSend(content: string): Promise<void> {
		if (busy) {
			return;
		}
		busy = true;
		try {
			await session.addMessage('user', content);
			const input: ContextPipelineInput = {
				state: session.state,
				conversation: session.conversation,
				worldInfo: worldInfo.entries,
				characterName:
					settings.profile.name ||
					(typeof session.state.attributes.name === 'string' ? session.state.attributes.name : undefined),
				systemPrompt: settings.profile.systemPrompt ?? undefined
			};
			const service = new ChatService(settings.config.provider === 'demo' ? demoClient : openAiClient);
			const { reply } = await service.generateReply(input, settings.config);
			await session.addMessage('assistant', reply);
		} catch (err) {
			toasts.error(err);
		} finally {
			busy = false;
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

	async function handleSaveConfig(config: Parameters<typeof settings.saveConfig>[0]): Promise<void> {
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
					typeof attributes.character_version === 'string' ? attributes.character_version : undefined,
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
			<span class="chip"><span class="dot"></span>{formatWorldTime(session.state.schedule.time)}</span>
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
					onSend={handleSend}
				/>
			{:else if tab === 'state'}
				<StatePanel characterState={session.state} onUpdate={handleStateUpdate} />
			{:else if tab === 'schedule'}
				<SchedulePanel schedule={session.state.schedule} onUpdate={handleStateUpdate} onAdvance={handleAdvance} />
			{:else if tab === 'versions'}
				<VersionPanel
					snapshots={session.snapshots}
					headId={session.headId}
					branches={session.branches}
					onCheckout={handleCheckout}
					onAddCheckpoint={handleCheckpoint}
				/>
			{:else if tab === 'world'}
				<WorldInfoPanel entries={worldInfo.entries} onUpsert={handleWorldUpsert} onRemove={handleWorldRemove} />
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
