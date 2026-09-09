// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHistoryBackSync, type HistoryBackSync } from './back-nav';

/**
 * 等 history 遍历落地：jsdom 派发 popstate 会跨多个宏任务，光等 setTimeout 不够。
 * 没有事件时（例如已经在首条还继续 back）由超时兜底。
 */
function settled(): Promise<void> {
	return new Promise((resolve) => {
		window.addEventListener('popstate', () => resolve(), { once: true });
		setTimeout(resolve, 30);
	});
}

describe('createHistoryBackSync', () => {
	let depth = 0;
	const pop = vi.fn();
	let sync: HistoryBackSync;

	function create(): HistoryBackSync {
		sync = createHistoryBackSync({ depth: () => depth, pop });
		return sync;
	}

	beforeEach(() => {
		depth = 0;
		pop.mockClear();
	});

	afterEach(async () => {
		sync.destroy();
		// 回到最初那条，避免用例之间的 history 互相污染。
		history.go(1 - history.length);
		await settled();
	});

	it('层数增加后，返回键能逐层退到根界面', async () => {
		create();
		depth = 2;
		sync.sync();

		history.back();
		await settled();
		expect(pop).toHaveBeenCalledTimes(1);

		history.back();
		await settled();
		expect(pop).toHaveBeenCalledTimes(2);

		// 已见底：再按返回不该由本模块处理（Android 上交给 Tauri 退出到桌面）。
		history.back();
		await settled();
		expect(pop).toHaveBeenCalledTimes(2);
	});

	it('界面自己退层时只追平 history，不重复触发 pop', async () => {
		const go = vi.spyOn(history, 'go');
		create();
		depth = 2;
		sync.sync();

		// 用户点了界面里的「‹」，层数是先变的。
		depth = 0;
		sync.sync();
		expect(go).toHaveBeenCalledWith(-2);

		await settled();
		expect(pop).not.toHaveBeenCalled();
		go.mockRestore();
	});

	it('history.go 落地前忽略层数变化，落地后再补对齐', async () => {
		const push = vi.spyOn(history, 'pushState');
		create();
		depth = 3;
		sync.sync();

		depth = 1;
		sync.sync();
		depth = 2;
		sync.sync();
		expect(push).toHaveBeenCalledTimes(3);

		await settled();
		expect(push).toHaveBeenCalledTimes(4);
		push.mockRestore();
	});

	it('前进到更深的条目时不误触发 pop', async () => {
		create();
		depth = 2;
		sync.sync();

		history.back();
		await settled();
		pop.mockClear();

		history.forward();
		await settled();
		expect(pop).not.toHaveBeenCalled();
	});

	it('组件重建时以 history 的实际位置为起点，首次 sync 收平', async () => {
		const first = createHistoryBackSync({ depth: () => 2, pop });
		first.sync();
		first.destroy();

		// 相当于刷新后界面回到根，但 history 仍停在第 2 层。
		sync = create();
		sync.sync();

		await settled();
		expect(pop).not.toHaveBeenCalled();
	});

	it('destroy 后不再响应返回键', async () => {
		create();
		depth = 1;
		sync.sync();
		sync.destroy();

		history.back();
		await settled();
		expect(pop).not.toHaveBeenCalled();
	});
});
