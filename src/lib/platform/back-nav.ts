/**
 * 移动端返回键适配：把「界面上还能退几层」镜像到浏览器 history。
 *
 * Tauri 在 Android 上的返回键默认行为是 `webView.canGoBack() ? goBack() : 结束 Activity`，
 * 而 CosBox 是单页应用，设置详情 / 工作区 / 功能页等层级全在组件状态里，history 始终只有一条，
 * 于是任何界面按返回都直接退到桌面。补出等量的 history 条目后：返回键 → goBack → popstate →
 * 退一层；退到根界面时 history 也正好见底，交回 Tauri 默认行为（退出到桌面）。
 */

/** history.state 上标记层级的键；缺失（如 SvelteKit 的根条目）即为第 0 层。 */
const LEVEL_KEY = 'cosboxBackLevel';

function levelOf(state: unknown): number {
	const value = (state as Record<string, unknown> | null | undefined)?.[LEVEL_KEY];
	return typeof value === 'number' ? value : 0;
}

export interface HistoryBackSync {
	/** 按当前层数对齐 history。界面状态变化后由调用方触发（Svelte 里放在 $effect 中）。 */
	sync(): void;
	/** 摘掉 popstate 监听。 */
	destroy(): void;
}

/**
 * 创建 history 与界面层级的双向同步器。
 * @param options.depth 当前可回退层数，0 表示已在根界面。
 * @param options.pop 退掉最上面一层（硬件返回键触发）。
 */
export function createHistoryBackSync(options: { depth(): number; pop(): void }): HistoryBackSync {
	// 刷新后 history.state 可能仍停在深层，起点取实际位置，首次 sync 会自动收平。
	let level = levelOf(history.state);
	// history.go 异步生效：popstate 落地前不能再推条目，否则层级计数会错位。
	let awaitingGo = false;

	function sync(): void {
		// 先读层数再判断：Svelte $effect 依赖这次读取来订阅状态，提前 return 会丢依赖。
		const target = options.depth();
		if (awaitingGo || target === level) {
			return;
		}
		if (target > level) {
			for (let next = level + 1; next <= target; next += 1) {
				history.pushState({ [LEVEL_KEY]: next }, '');
			}
			level = target;
			return;
		}
		// 界面已经先退了（点「‹」等），这里只是把 history 追平，不该再触发一次 pop。
		const delta = target - level;
		level = target;
		awaitingGo = true;
		history.go(delta);
	}

	function onPopState(event: PopStateEvent): void {
		const next = levelOf(event.state);
		if (awaitingGo) {
			awaitingGo = false;
			level = next;
			// 等待期间界面可能又变了，落地后补一次对齐。
			sync();
			return;
		}
		if (next >= level) {
			// 前进或与本模块无关的条目（SvelteKit 自己的路由状态）。
			return;
		}
		level = next;
		options.pop();
	}

	window.addEventListener('popstate', onPopState);

	return {
		sync,
		destroy(): void {
			window.removeEventListener('popstate', onPopState);
		}
	};
}
