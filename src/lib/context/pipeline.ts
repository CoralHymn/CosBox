import type { CharacterState, ChatMessageView, WorldInfoEntry } from '../core/types';
import type { ChatMessage } from '../llm/types';
import type { MemoryEntry } from '../memory/types';
import { recallMemories } from '../memory/recall';
import type { SearchResult } from '../search/types';
import {
	excludeFromContext,
	prepareHistory,
	type HistoryOptions,
	type HistoryResult
} from './history';
import { summarizeState } from './state-summary';
import { findWorldInfoHits, type WorldInfoHit } from './world-info';

/** 单次请求默认注入的长期记忆条数上限。 */
export const DEFAULT_MEMORY_INJECT_LIMIT = 5;

/** 上下文管道的输入：当前状态 + 最近对话 + 世界信息。 */
export interface ContextPipelineInput {
	state: CharacterState;
	conversation: ReadonlyArray<ChatMessageView>;
	worldInfo: ReadonlyArray<WorldInfoEntry>;
	/** 角色名（默认取 attributes.name）。 */
	characterName?: string;
	/** 自定义系统提示（默认使用内置角色扮演模板）。 */
	systemPrompt?: string;
	/** 历史压缩参数。 */
	historyOptions?: HistoryOptions;
	/** 允许 AI 调用状态工具时，在系统提示中注入工具使用说明。 */
	enableStateTools?: boolean;
	/** 最近一次工具执行反馈（agent 循环注入），让模型确认工具已调用并生效。 */
	toolFeedback?: string;
	/** 可选的网络搜索结果，命中时注入系统提示。 */
	searchResults?: ReadonlyArray<SearchResult>;
	/** 长期记忆库：按最近对话召回后注入系统提示，弥补压缩丢失的细节。 */
	memories?: ReadonlyArray<MemoryEntry>;
	/** 单次请求最多注入的记忆条数（默认 5）。 */
	memoryLimit?: number;
}

/** 上下文管道的结构化输出。 */
export interface ContextBundle {
	/** 最终系统消息：基础提示 + 状态摘要 + 世界信息命中。 */
	systemMessage: string;
	/** 可直接发给 OpenAI-compatible API 的消息数组。 */
	messages: ChatMessage[];
	stateSummary: string;
	worldInfoHits: WorldInfoHit[];
	/** 处理后的历史（可能含压缩占位）。 */
	history: ChatMessageView[];
	compressedCount: number;
	searchResults: SearchResult[];
	/** 本次实际召回注入的记忆条目（供 UI 标记使用情况）。 */
	recalledMemories: MemoryEntry[];
}

/** 默认角色扮演系统提示模板。 */
export function defaultSystemPrompt(name: string): string {
	return (
		`你是「${name}」，一名生活在虚拟学园中的角色。请以沉浸式角色扮演回应：\n` +
		`- 始终以角色身份说话，绝不承认自己是 AI 或模型。\n` +
		`- 下列【当前状态】是事实约束：穿着、地点、时间、日程与属性不得违背。\n` +
		`- 使用自然、简短的口语，符合角色年龄与性格。`
	);
}

/** 状态工具使用说明：让模型知道它可以主动调用工具更新剧情状态。 */
export function buildToolGuidance(): string {
	return [
		'【工具使用】',
		'你必须在剧情中主动调用工具来同步状态，不允许只口头描述或假设状态已变化：',
		'- 调用时机：当剧情需要状态变化时，先发出 tool_calls、收到工具反馈后再写正文；正文中描述的状态变化必须与工具调用结果一致；',
		'- 允许一次回复并行发出多个工具调用（如同时推进时间 + 换装 + 改地点），不必逐个等待；',
		'- 只要剧情暗示时间流逝（排队、等待、赶路、闲聊、用餐、入夜等）→ 立即调用 advance_time 推进到合理时刻；',
		'- 离开某地或到达新地点 → 立即调用 goto_location（优先从【已知地点】中选择）；',
		'- 穿上/脱下衣物 → 立即调用 set_outfit（必须从【衣柜】中选择，item 用精确名称；用「无」表示脱掉；配饰是多件列表，slot=配饰 可逐件添加、action=remove 移除指定一件）；',
		'- 属性发生变化 → 立即调用 set_attribute。',
		'- 工具调用必须通过 tool_calls 字段发出并带完整参数（advance_time 给 minutes、goto_location 给地点名、set_outfit 给 slot+item、set_attribute 给 key+value）；',
		'- 思考过程（reasoning）里写「我要调用 xxx」不算数：决定调用后立即在本次回复中发出结构化的 tool_calls。',
		'- 禁止把工具调用写成纯文本或 JSON 放在正文里（如 {"tool":"..."}）：正文只写台词/旁白，调用一律走 tool_calls 字段。',
		'- 未调用工具 = 状态未同步：正文中描述的时间/地点/穿着/属性变化若没有对应 tool_calls，将被视为剧情事实错误；',
		'每次调用工具都会立即生效并返回反馈；「我这就去」「过了几分钟」这类表述不算数，必须真的发出 tool_calls。'
	].join('\n');
}

/** 用户发言中的时间流逝信号（每轮提醒的针对性提示触发条件）。 */
const TIME_FLOW_HINT_PATTERNS: readonly RegExp[] = [
	/过了一?段时间|过了一?会儿|过了(?:很久|好久|许久|一阵子)/,
	/等了|等待|排队|赶路|耽误了/,
	/已经(?:是)?(?:下午|傍晚|晚上|入夜|深夜|凌晨|中午|黄昏|天黑)/,
	/过了?(?:一|两|几|\d+)?\s*(?:分钟|小时|钟头)/,
	/(?:一|两|几|\d+)\s*(?:分钟|小时|钟头)/,
	/(?:起床|睡觉|睡醒|晚安|早上好|中午好|放学|下课|午休|天黑了)/,
	/(?:快进|快转|跳到|来到|到了|已是|已经是|到了第)?(?:第二天|次日|隔天|过了一天|过了一夜|新的一天)/,
	/(?:快进|快转|跳到)(?:到)?(?:了)?(?:第?[一二三四五六日天]\s*天)?\s*(?:早上|上午|中午|下午|傍晚|晚上|凌晨|深夜|清晨)/,
	/天亮了|天亮|晨曦|黄昏|入夜|夜深/
];

/** 用户发言中的地点变化信号。 */
const LOCATION_HINT_PATTERNS: readonly RegExp[] = [
	/(?:去|回|离开|前往|来到|到达|出发|走出|走进|进了|去了|回家了?|回宿舍|回学校)/,
	/(?:到|去)(?:了)?(?:学校|教室|食堂|宿舍|图书馆|操场|游泳馆|家|商场|商店|超市|公园|医院|车站|咖啡|电影院|天台|走廊|校门)/,
	/(?:到了|赶到|冲向|跑向|走向|走回|回到|离开)(?:了)?/
];

/** 用户发言中的穿着变化信号。 */
const OUTFIT_HINT_PATTERNS: readonly RegExp[] = [
	/(?:穿上|脱下|脱掉|换上|换下|换掉|穿好|披上|系上|戴上|摘下|没穿|光着|不穿|穿着|衣服|衬衫|裙子|外套|袜子|鞋子|帽子|内衣|内裤|泳衣|校服|制服|睡衣)/,
	/(?:换了|脱了|穿了|换了衣服|换衣服|衣衫|裤子|上衣|围巾|领带|手套|耳环|项链|发卡|发带|腰带)/
];

/**
 * 每轮工具提醒（对齐 opencode 的逐轮 system-reminder 做法）：
 * 启用状态工具时，在每次请求注入一段简短提醒，让模型在输出正文前
 * 先判断本段剧情是否需要同步状态；当用户发言命中明确的状态信号
 * （时间流逝 / 地点变化 / 穿着变化）时，追加对应工具的针对性提醒。
 * 采用确定性关键词判断（非 LLM），避免额外请求与误判扩散。
 */
export function buildPerTurnToolReminder(lastUserContent: string | undefined): string {
	const hints: string[] = [];
	if (lastUserContent !== undefined && lastUserContent.trim() !== '') {
		if (TIME_FLOW_HINT_PATTERNS.some((pattern) => pattern.test(lastUserContent))) {
			hints.push(
				'- 本次发言涉及时间流逝或时段变化 → 请调用 advance_time（minutes 为具体分钟数）后再输出正文；'
			);
		}
		if (LOCATION_HINT_PATTERNS.some((pattern) => pattern.test(lastUserContent))) {
			hints.push(
				'- 本次发言涉及地点变化 → 请调用 goto_location（优先从【已知地点】中选择）后再输出正文；'
			);
		}
		if (OUTFIT_HINT_PATTERNS.some((pattern) => pattern.test(lastUserContent))) {
			hints.push(
				'- 本次发言涉及穿着变化 → 请调用 set_outfit（item 用【衣柜】中的精确名称，「无」表示脱掉）后再输出正文；'
			);
		}
	}
	return [
		'<system-reminder>',
		'本消息是状态同步提醒，不属于剧情内容：',
		'- 输出正文前，先判断本段剧情是否发生了时间流逝、地点变化、穿着变化或属性变化；',
		'- 需要同步状态时，必须先在本次回复中发出对应的工具调用（tool_calls），收到工具反馈后再输出正文；',
		'- 只口头描述状态变化而不调用工具，视为未完成状态同步，正文中的状态描述将与实际状态不一致。',
		...hints,
		'</system-reminder>'
	].join('\n');
}

/**
 * 世界时间元数据使用说明：注入系统提示，防止模型把【世界时间：…】标注
 * 当作台词、旁白而在回复中复述或模仿。
 */
export const TIME_MARKER_GUIDANCE =
	'对话消息中形如【世界时间：周一 09:00】的标注是剧情时间元数据，' +
	'用于帮助你感知每条消息发生的时刻，不是台词、旁白或输出格式；' +
	'回复正文中严禁出现【世界时间：…】或（周X HH:MM）等任何时间标注格式，' +
	'需要表达时刻时用自然叙述（如「已经中午了」），并配合 advance_time 工具推进世界时间。';

/**
 * 组装上下文：
 * 1) 世界信息关键词触发；
 * 2) 状态摘要注入；
 * 3) 历史压缩。
 */
export function buildContext(input: ContextPipelineInput): ContextBundle {
	// 只展示不给模型的消息（如 /help）不参与历史与世界信息触发。
	const contextConversation = excludeFromContext(input.conversation);
	const name =
		(input.characterName && input.characterName.trim()) ||
		(typeof input.state.attributes.name === 'string' ? input.state.attributes.name : '角色');
	const stateSummary = summarizeState(input.state);
	const historyResult: HistoryResult = prepareHistory(
		contextConversation,
		input.historyOptions ?? { maxMessages: 20 }
	);
	const worldInfoHits = findWorldInfoHits(
		contextConversation.map((message) => message.content),
		input.worldInfo
	);
	const recalledMemories = recallMemories(
		input.memories ?? [],
		[...contextConversation.map((message) => message.content), stateSummary],
		input.memoryLimit ?? DEFAULT_MEMORY_INJECT_LIMIT
	);
	const searchResults = [...(input.searchResults ?? [])];
	const lastUserMessage = [...contextConversation].reverse().find((message) => message.role === 'user');

	const worldInfoBlock =
		worldInfoHits.length > 0
			? `\n【世界设定】\n${worldInfoHits.map((hit) => `- ${hit.content}`).join('\n')}`
			: '';
	const memoryBlock =
		recalledMemories.length > 0
			? `\n【长期记忆】\n${recalledMemories
					.map((entry) => `- [${entry.category}] ${entry.content}`)
					.join('\n')}\n以上是角色过往经历中值得记住的事实，剧情需要时自然引用，不要生硬复述。`
			: '';
	const basePrompt = input.systemPrompt?.trim() || defaultSystemPrompt(name);
	const searchBlock =
		searchResults.length > 0
			? `\n【网络搜索结果】\n${searchResults
					.map((result) => `- ${result.title}：${result.snippet}（${result.url}）`)
					.join('\n')}`
		: '';
	const toolBlock = input.enableStateTools === true ? `\n\n${buildToolGuidance()}` : '';
	// 每轮工具提醒默认附在最后一条用户消息里（对齐 opencode：提醒紧贴本次发言，
	// 模型读到最新输入时注意力最强）；仅当上下文没有用户消息时回退到系统提示。
	const reminderText =
		input.enableStateTools === true
			? buildPerTurnToolReminder(lastUserMessage?.content)
			: '';
	const turnReminderBlock =
		reminderText !== '' && lastUserMessage === undefined ? `\n\n${reminderText}` : '';
	const feedbackBlock =
		input.toolFeedback !== undefined && input.toolFeedback.trim() !== ''
			? `\n\n${input.toolFeedback.trim()}`
			: '';
	const systemMessage = `${basePrompt}\n\n${stateSummary}${worldInfoBlock}${memoryBlock}${searchBlock}${toolBlock}${turnReminderBlock}${feedbackBlock}\n\n${TIME_MARKER_GUIDANCE}`;
	const messages: ChatMessage[] = [];
	for (const message of historyResult.messages) {
		// 分段消息（AI 一轮回复）：把思考/正文合并回 assistant 消息、工具调用还原为
		// 系统反馈，保持与旧落库一致的发送结构（assistant + 【工具调用】system）。
		if (
			message.role === 'assistant' &&
			message.segments !== undefined &&
			message.segments.length > 0
		) {
			messages.push(...expandSegmentedMessage(message));
			continue;
		}
		messages.push({
			role: message.role,
			content: message.content,
			...(message.worldTime !== undefined ? { worldTime: message.worldTime } : {}),
			// DeepSeek V4 思考模式要求历史中的 assistant 消息尽量带 reasoning_content
			// （部分部署对缺失字段会续答异常）；把落库的思考原样回传，非 DeepSeek 端点忽略。
			...(message.role === 'assistant' && message.thinking !== undefined
				? { reasoning: message.thinking }
				: {})
		});
	}
	// 把每轮提醒附到请求中的最后一条用户消息（仅影响本次发送，不落库）。
	if (reminderText !== '' && lastUserMessage !== undefined) {
		let lastUserIndex = -1;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			if (messages[index]!.role === 'user') {
				lastUserIndex = index;
				break;
			}
		}
		if (lastUserIndex !== -1) {
			const target = messages[lastUserIndex]!;
			messages[lastUserIndex] = {
				...target,
				content: `${target.content}\n\n${reminderText}`
			};
		}
	}

	return {
		systemMessage,
		messages,
		stateSummary,
		worldInfoHits,
		history: historyResult.messages,
		compressedCount: historyResult.compressedCount,
		searchResults,
		recalledMemories
	};
}

/**
 * 把一条分段 assistant 消息展开为发送给 LLM 的消息序列：
 * - 相邻的思考 + 正文合并为一条 assistant（思考挂 reasoning，序列化时回传）；
 * - 工具调用段还原为系统反馈消息（格式与旧落库一致），供模型感知状态已更新。
 * 世界时间标注与原实现一致：跟随消息注入。
 */
function expandSegmentedMessage(message: ChatMessageView): ChatMessage[] {
	const result: ChatMessage[] = [];
	let text = '';
	let reasoning: string | undefined;
	const worldTime = message.worldTime;
	/** 把当前累积的「思考 + 正文」作为一条 assistant 消息落盘。 */
	function flushAssistant(): void {
		if (text.trim() === '' && reasoning === undefined) {
			return;
		}
		result.push({
			role: 'assistant',
			content: text,
			...(worldTime !== undefined ? { worldTime } : {}),
			...(reasoning !== undefined ? { reasoning } : {})
		});
		text = '';
		reasoning = undefined;
	}
	for (const segment of message.segments ?? []) {
		if (segment.kind === 'thinking') {
			// 思考段意味着新一轮「思考 + 正文」的开始（interleaved thinking 场景
			// 会交替出现 思考→正文→思考→正文）：先把上一轮 flush，避免内容被覆盖。
			// 仅当上一轮已有正文时 flush，连续思考段（无正文）不产生空 assistant。
			if (text.trim() !== '') {
				flushAssistant();
			}
			reasoning = segment.content;
		} else if (segment.kind === 'text') {
			text = segment.content;
		} else if (segment.kind === 'tool') {
			flushAssistant();
			result.push({
				role: 'system',
				content: `【工具调用】${segment.toolName ?? ''}：${segment.content}`,
				...(worldTime !== undefined ? { worldTime } : {})
			});
		}
	}
	flushAssistant();
	return result;
}
