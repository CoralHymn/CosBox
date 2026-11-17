import type { ClothingItem, LocationDef, ScheduleEntry, WorldTime } from '../core/types';
import type { KvRepository } from '../db/kv-repo';
import type { CharacterSessionStore } from '../stores/character.svelte';
import type { createMemoryStore } from '../stores/memory.svelte';
import type { createSettingsStore } from '../stores/settings.svelte';
import type { createWorldInfoStore } from '../stores/world-info.svelte';
import { newId } from '../utils/id';
import type { WorkspaceRegistry } from './workspace-registry';
import type { WorkspaceService } from './workspace-service';

/**
 * 首访演示：一套已经发生过的剧本，评委打开就能顺着走完
 * 「状态 → 联动 → 版本回滚」，不需要配置模型或学习界面。
 *
 * 内容约束：成年角色、校园日常、全年龄；只使用 Web 版允许的穿着槽位。
 */

/** 演示播种标记（应用级 kv）：记录示例工作区 id，避免重复创建。 */
export const DEMO_MARKER_KEY = 'demo.scene.v1';
/** 开场介绍是否已看过（应用级 kv）：只放一次，刷新不再挡路。 */
export const DEMO_INTRO_KEY = 'demo.intro.v1';

export const DEMO_WORKSPACE_NAME = '示例：校庆前夜';

/** 播种标记；workspaceId 为空表示「已判定无需播种」。 */
export interface DemoMarker {
	workspaceId: string;
	seededAt: number;
}

/** 演示 Dock 的一步：评委点一下，剧本往前走一步。 */
export interface DemoChip {
	label: string;
	text: string;
	/** 这一步让什么发生变化（Dock 状态条展示）。 */
	note: string;
}

/** 演示 Dock 的完整视图模型（由宿主组装，组件只负责展示）。 */
export interface DemoDockModel {
	chips: readonly DemoChip[];
	/** 每一步是否已落库（按下标对应 chips），乱序点击也不会错标。 */
	done: readonly boolean[];
	/** 下一步建议执行的下标；全部完成时为 -1。 */
	activeIndex: number;
	note: string;
	busy: boolean;
	autoRunning: boolean;
	completed: boolean;
	onPick: (text: string) => void;
	onAuto: () => void;
	onStopAuto: () => void;
	onSkip: () => void;
	onVersions: () => void;
	onOwnStory: () => void;
}

const DEMO_TIME: WorldTime = { day: 4, hour: 18, minute: 40 };

/** 四个动作恰好覆盖演示模型的四条确定性分支（时间 / 地点 / 换装 / 推进）。 */
export const DEMO_CHIPS: readonly DemoChip[] = [
	{ label: '现在几点？', text: '现在几点了？', note: '回答会引用当前世界时间' },
	{ label: '去食堂', text: '我们去食堂吧', note: '地点：活动室 → 食堂' },
	{ label: '换件衣服', text: '换装', note: '上衣：白衬衫 → 黑色卫衣' },
	{ label: '半小时后', text: '半小时后出发', note: '世界时间 +30 分钟' }
];

const DEMO_PLACES: LocationDef[] = [
	{
		id: 'demo-club-room',
		category: '学校',
		name: '社团活动室',
		description: '堆着纸箱和半成品展板的活动室，灯管偶尔闪一下'
	},
	{
		id: 'demo-canteen',
		category: '学校',
		name: '食堂',
		description: '七点收档的二食堂，窗口还亮着最后一排灯'
	},
	{
		id: 'demo-library',
		category: '学校',
		name: '图书馆',
		description: '闭馆前很安静，三楼靠窗的位置能看到主楼'
	},
	{
		id: 'demo-dorm',
		category: '生活区',
		name: '宿舍楼下',
		description: '路灯下的快递架和共享单车，晚上风有点凉'
	}
];

const DEMO_WARDROBE: ClothingItem[] = [
	{
		id: 'demo-cloth-shirt',
		category: '常服',
		kind: 'top',
		name: '白色衬衫',
		description: '洗得发白的棉衬衫，袖口挽到小臂'
	},
	{
		id: 'demo-cloth-hoodie',
		category: '常服',
		kind: 'top',
		name: '黑色卫衣',
		description: '宽松的黑色连帽卫衣，袖口有洗旧的痕迹'
	},
	{
		id: 'demo-cloth-pants',
		category: '常服',
		kind: 'bottom',
		name: '深灰长裤',
		description: '直筒长裤，膝盖上有搬展板蹭到的灰'
	},
	{
		id: 'demo-cloth-shoes',
		category: '常服',
		kind: 'shoes',
		name: '帆布鞋',
		description: '白色帆布鞋，鞋头有点脏'
	},
	{
		id: 'demo-cloth-cap',
		category: '配饰',
		kind: 'headwear',
		name: '棒球帽',
		description: '深蓝色棒球帽，帽檐压得很低'
	},
	{
		id: 'demo-cloth-bag',
		category: '配饰',
		kind: 'accessory',
		name: '帆布袋',
		description: '印着社团标志的帆布袋，里面塞着胶带和裁纸刀'
	}
];

const DEMO_SCHEDULE: ScheduleEntry[] = [
	{
		id: 'demo-schedule-1',
		day: 4,
		start: 19 * 60 + 30,
		end: 21 * 60,
		title: '校庆布展碰头',
		locationId: 'demo-library'
	}
];

/** 预置对话：两轮来回，最后一句把话题引向时间与食堂。 */
const DEMO_MESSAGES: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> = [
	{
		role: 'assistant',
		content: '布展的胶带又用完了。你来得正好——入口那块展板还差一半。'
	},
	{ role: 'user', content: '还差多少？' },
	{
		role: 'assistant',
		content: '就差最后一块。先别管了，食堂七点收档，你吃饭了吗？'
	}
];

/** 已预置的用户消息条数：Dock 的进度从这里起算。 */
export const DEMO_SEEDED_USER_MESSAGES = 1;

const DEMO_MEMORIES = [
	{
		content: '答应林夏今晚帮她把入口展板搬到主楼大厅',
		category: '约定',
		keywords: ['展板', '帮忙', '今晚'],
		importance: 4,
		pinned: true
	},
	{
		content: '林夏忙起来会忘记吃饭，食堂七点收档',
		category: '习惯',
		keywords: ['食堂', '吃饭', '林夏'],
		importance: 3,
		pinned: false
	}
] as const;

const DEMO_WORLD_INFO = [
	{
		keys: ['校庆', '展板', '展陈'],
		content: '三天后是校庆。展陈组负责主楼大厅的入口装置，需要在明晚前完成。',
		enabled: true,
		priority: 6,
		comment: '示例场景背景'
	}
] as const;

const DEMO_PROFILE = {
	name: '林夏',
	systemPrompt:
		'你是「林夏」，21 岁，大三学生，校庆展陈组负责人。' +
		'请始终以第一人称回应，语气干脆、偶尔自嘲；不要替对方说话，也不要输出旁白。',
	characterPrompt: '林夏，21 岁，大三，校庆展陈组负责人。忙起来会忘记吃饭，说话不绕弯子。',
	userPrompt: '对方是你的同学，今晚来帮你搬展板。认识两年，说话不用客套。',
	worldPrompt: '现代大学城，校庆前夜的周五傍晚。主楼大厅正在布展。',
	stylePrompt: '短句、口语化，每次回复不超过三句。'
};

export interface DemoSeedDeps {
	workspaces: WorkspaceRegistry;
	workspaceService: WorkspaceService;
	settings: ReturnType<typeof createSettingsStore>;
	session: CharacterSessionStore;
	memories: ReturnType<typeof createMemoryStore>;
	worldInfo: ReturnType<typeof createWorldInfoStore>;
	kv: KvRepository;
}

/**
 * 首访播种示例工作区。返回应进入的工作区 id；返回 null 表示跳过。
 * 幂等：已有标记时只做存在性检查；已有用户数据时只记录「不播种」。
 */
export async function ensureDemoWorkspace(deps: DemoSeedDeps): Promise<string | null> {
	const marker = await deps.kv.get<DemoMarker>(DEMO_MARKER_KEY);
	if (marker !== undefined) {
		return marker.workspaceId !== '' && deps.workspaces.getById(marker.workspaceId) !== undefined
			? marker.workspaceId
			: null;
	}
	// 老用户：有任意消息记录就不打扰，只落标记避免下次重复判断。
	const hasUserData = deps.workspaces
		.getWorkspaces()
		.some((meta) => meta.lastMessageAt !== undefined || meta.lastMessagePreview !== undefined);
	if (hasUserData) {
		await deps.kv.set(DEMO_MARKER_KEY, { workspaceId: '', seededAt: Date.now() });
		return null;
	}

	const meta = await deps.workspaceService.createWorkspace(DEMO_WORKSPACE_NAME);
	try {
		await seedDemoContent(deps);
		await deps.kv.set(DEMO_MARKER_KEY, { workspaceId: meta.id, seededAt: Date.now() });
		return meta.id;
	} catch (err) {
		// 播种失败不留半个示例：删除刚建的工作区，回到普通首屏。
		await deps.workspaceService.removeWorkspace(meta.id).catch(() => undefined);
		throw err;
	}
}

async function seedDemoContent(deps: DemoSeedDeps): Promise<void> {
	// 工作区级设置：五段提示词决定示例角色的说话方式。
	await deps.settings.saveProfile(DEMO_PROFILE);
	// 世界配置（地点 / 衣柜 / 日程）：只进配置覆盖，不产生快照。
	await deps.session.applyConfig({
		places: DEMO_PLACES,
		wardrobe: DEMO_WARDROBE,
		scheduleEntries: DEMO_SCHEDULE
	});
	// 开场状态：周五 18:40、活动室、白衬衫与长裤（不用私密槽位）。
	await deps.session.update(
		{
			location: {
				id: 'demo-club-room',
				category: '学校',
				name: '社团活动室',
				description: '堆着纸箱和半成品展板的活动室，灯管偶尔闪一下'
			},
			schedule: { time: { ...DEMO_TIME } },
			outfit: {
				headwear: null,
				top: '白色衬衫',
				underwear: null,
				underpants: null,
				bottom: '深灰长裤',
				socks: null,
				shoes: '帆布鞋',
				accessories: []
			},
			attributes: {
				name: '林夏',
				age: 21,
				class: '大三 · 校庆展陈组',
				mood: '专注',
				energy: 72,
				affection: 60,
				trust: 55,
				money: 80
			}
		},
		{ desc: '示例开场：周五傍晚的活动室' }
	);
	for (const message of DEMO_MESSAGES) {
		await deps.session.addMessage(message.role, message.content);
	}
	for (const memory of DEMO_MEMORIES) {
		await deps.memories.add({ ...memory, keywords: [...memory.keywords] });
	}
	for (const entry of DEMO_WORLD_INFO) {
		await deps.worldInfo.upsert({
			id: newId(),
			keys: [...entry.keys],
			content: entry.content,
			enabled: entry.enabled,
			priority: entry.priority,
			comment: entry.comment
		});
	}
}

/** 每一步是否已落库：只认脚本原句，评委自由输入不会误推进度。 */
export function demoChipDone(
	conversation: ReadonlyArray<{ role: string; content: string }>
): boolean[] {
	return DEMO_CHIPS.map((chip) =>
		conversation.some(
			(message) => message.role === 'user' && message.content.trim() === chip.text
		)
	);
}
