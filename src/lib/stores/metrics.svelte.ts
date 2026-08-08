import type { KvRepository } from '../db/kv-repo';

/** 每次 AI 回复完成后记录一条的轮次样本（时间序列图表数据源）。 */
export interface TurnSample {
	/** 完成时间戳（ms）。 */
	t: number;
	/** 从发送到完成的耗时（ms，含补调/状态确认等后处理）。 */
	latencyMs: number;
	promptTokens: number;
	completionTokens: number;
	/** 本轮实际执行的工具调用数。 */
	toolCalls: number;
	/** 本轮触发的补调/重试次数。 */
	retries: number;
	/** 本轮文本兜底通道采纳的调用次数。 */
	textFallbacks: number;
	/** 端点 finish_reason（length 表示被 Max Tokens 截断）。 */
	finishReason?: string;
}

/** 最近事件流水（调试用，按时间倒序展示）。 */
export interface MetricEvent {
	t: number;
	name: string;
}

/** 监控面板持久化数据。 */
export interface MetricsData {
	counters: Record<string, number>;
	turns: TurnSample[];
	events: MetricEvent[];
}

const KEY = 'metrics.v1';
/** 轮次样本滚动窗口：保留最近 N 条，防止无限膨胀。 */
const MAX_TURNS = 300;
/** 事件流水滚动窗口。 */
const MAX_EVENTS = 500;

/** 校验轮次样本形状，忽略损坏数据。 */
function isTurnSample(value: unknown): value is TurnSample {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.t === 'number' &&
		typeof record.latencyMs === 'number' &&
		typeof record.promptTokens === 'number' &&
		typeof record.completionTokens === 'number' &&
		typeof record.toolCalls === 'number'
	);
}

/**
 * 监控指标 store：计数器 + 轮次时间序列 + 事件流水，写入 IndexedDB 持久化。
 * 供「监控」tab 的折线图与计数卡展示；文本兜底触发次数等指标飙升时，
 * 可在设置里关闭双通道强制模型只走结构化 tool_calls。
 */
export function createMetricsStore(kv: KvRepository) {
	let counters = $state<Record<string, number>>({});
	let turns = $state<TurnSample[]>([]);
	let events = $state<MetricEvent[]>([]);
	/** 防抖持久化：高频事件合并为一次写入。 */
	let persistTimer: ReturnType<typeof setTimeout> | null = null;

	function schedulePersist(): void {
		if (persistTimer !== null) {
			return;
		}
		persistTimer = setTimeout(() => {
			persistTimer = null;
			const data: MetricsData = { counters, turns, events };
			void kv.set(KEY, data).catch(() => undefined);
		}, 600);
	}

	/** 从本地库恢复；缺失或损坏时保持空态。 */
	async function load(): Promise<void> {
		try {
			const saved = await kv.get<MetricsData>(KEY);
			if (saved === undefined || typeof saved !== 'object' || saved === null) {
				return;
			}
			if (typeof saved.counters === 'object' && saved.counters !== null) {
				counters = { ...saved.counters };
			}
			if (Array.isArray(saved.turns)) {
				turns = saved.turns.filter(isTurnSample);
			}
			if (Array.isArray(saved.events)) {
				events = saved.events.filter(
					(event): event is MetricEvent =>
						typeof event === 'object' &&
						event !== null &&
						typeof (event as MetricEvent).t === 'number' &&
						typeof (event as MetricEvent).name === 'string'
				);
			}
		} catch {
			// 读取失败不阻断启动。
		}
	}

	/** 计数器 +1，并追加一条事件流水。 */
	function record(name: string): void {
		counters = { ...counters, [name]: (counters[name] ?? 0) + 1 };
		events = [...events.slice(-(MAX_EVENTS - 1)), { t: Date.now(), name }];
		schedulePersist();
	}

	/** 记录一轮完整回复的样本（图表数据）。 */
	function recordTurn(sample: TurnSample): void {
		turns = [...turns.slice(-(MAX_TURNS - 1)), sample];
		schedulePersist();
	}

	/** 清空全部监控数据。 */
	async function reset(): Promise<void> {
		counters = {};
		turns = [];
		events = [];
		try {
			await kv.remove(KEY);
		} catch {
			// 删除失败不影响内存态清空。
		}
	}

	return {
		get counters() {
			return counters;
		},
		get turns() {
			return turns;
		},
		get events() {
			return events;
		},
		load,
		record,
		recordTurn,
		reset
	};
}
