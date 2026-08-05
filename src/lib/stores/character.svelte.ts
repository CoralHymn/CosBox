import type {
	BranchSummary,
	CharacterState,
	ChatMessageView,
	ConfigPatch,
	MessageRole,
	SnapshotNode,
	StatePatch
} from '../core/types';
import type { CharacterManager } from '../manager/character-manager';

/** 会话 store 的对外接口：响应式视图 + 受控变更方法。 */
export interface CharacterSessionStore {
	readonly state: CharacterState;
	readonly headId: string | null;
	readonly conversation: ChatMessageView[];
	readonly snapshots: SnapshotNode[];
	readonly branches: BranchSummary[];
	update: (patch: StatePatch, metadata: { desc: string }) => Promise<SnapshotNode>;
	addMessage: (
		role: MessageRole,
		content: string,
		options?: { skipContext?: boolean; thinking?: string }
	) => Promise<SnapshotNode>;
	/** 原地编辑一条消息快照的正文（不新增快照）。 */
	editMessage: (id: string, content: string) => Promise<void>;
	checkout: (targetId: string) => Promise<void>;
	advanceTime: (minutes: number) => Promise<SnapshotNode>;
	addCheckpoint: (desc: string) => Promise<SnapshotNode>;
	deleteBranch: (tipId: string) => Promise<number>;
	/** 世界配置覆盖（地点库/衣柜/日程条目）：不生成快照、不进版本历史。 */
	applyConfig: (patch: ConfigPatch) => Promise<void>;
}

/**
 * 把框架无关的 CharacterManager 包装为 Svelte 5 runes 响应式 store。
 * UI 只能通过 update/addMessage/checkout 等受控入口变更数据。
 */
export function createCharacterSession(manager: CharacterManager): CharacterSessionStore {
	let state = $state<CharacterState>(manager.getState());
	let headId = $state<string | null>(manager.getHeadId());
	let conversation = $state<ChatMessageView[]>(manager.getConversation());
	let snapshots = $state<SnapshotNode[]>(manager.getSnapshots());
	let branches = $state<BranchSummary[]>(manager.getBranches());

	manager.subscribe(() => {
		state = manager.getState();
		headId = manager.getHeadId();
		conversation = manager.getConversation();
		snapshots = manager.getSnapshots();
		branches = manager.getBranches();
	});

	return {
		get state() {
			return state;
		},
		get headId() {
			return headId;
		},
		get conversation() {
			return conversation;
		},
		get snapshots() {
			return snapshots;
		},
		get branches() {
			return branches;
		},
		update: (patch, metadata) => manager.update(patch, metadata),
		addMessage: (role, content, options) => manager.addMessage(role, content, options),
		editMessage: (id, content) => manager.editMessage(id, content),
		checkout: (targetId) => manager.checkout(targetId),
		advanceTime: (minutes) => manager.advanceTime(minutes),
		addCheckpoint: (desc) => manager.addCheckpoint(desc),
		deleteBranch: (tipId) => manager.deleteBranch(tipId),
		applyConfig: (patch) => manager.applyConfig(patch)
	};
}
