import { expect, test } from '@playwright/test';
import { APP_URL, enterDefaultWorkspace } from './utils';

// 注入 Tauri 桌面环境标识：isTauri() 为 true，UA 不含 Android → 自定义标题栏模式。
test.beforeEach(async ({ page }) => {
	await page.addInitScript('window.__TAURI_INTERNALS__ = {};');
});

test('Tauri 桌面：自定义标题栏承载窗口控制/工作区切换/状态信息，内容占满剩余空间', async ({
	page
}) => {
	await page.goto(APP_URL);
	// 标题栏：40px，含工作区切换器、窗口控制。
	const titlebarBox = await page.locator('.titlebar').boundingBox();
	expect(titlebarBox).not.toBeNull();
	expect(titlebarBox!.height).toBe(40);
	await expect(page.getByRole('button', { name: '最小化' })).toBeVisible();
	await expect(page.getByRole('button', { name: '最大化/还原' })).toBeVisible();
	await expect(page.getByRole('button', { name: '关闭' })).toBeVisible();

	// 初始界面占满标题栏以下的空间。
	const homeBox = await page.locator('.home').boundingBox();
	expect(homeBox).not.toBeNull();
	expect(homeBox!.height).toBeGreaterThan(500);

	await enterDefaultWorkspace(page);

	// 进入工作区后：不再有独立 54px 顶栏，状态 chips 并入标题栏，
	// 内容区占满剩余空间（回归护栏：曾被压成 54px 细条）。
	await expect(page.locator('.header')).toHaveCount(0);
	await expect(page.locator('.titlebar').locator('.chip').first()).toContainText('周一 08:00');
	await expect(page.locator('.titlebar').getByText('演示模式')).toBeVisible();
	await expect(page.locator('.titlebar').getByText(/快照/)).toBeVisible();
	const bodyBox = await page.locator('.body').boundingBox();
	expect(bodyBox).not.toBeNull();
	expect(bodyBox!.height).toBeGreaterThan(500);
	await expect(page.getByText('开始一段新的故事吧')).toBeVisible();

	// 标题栏里的切换器打开下拉面板（搜索/预览/快捷操作），「管理全部…」再打开全量管理弹层。
	await page.locator('.titlebar-ws').click();
	const dropdown = page.getByRole('dialog', { name: '切换工作区' });
	await expect(dropdown).toBeVisible();
	await expect(dropdown.getByText('默认工作区')).toBeVisible();
	await expect(dropdown.getByText('当前')).toBeVisible();
	await dropdown.getByRole('button', { name: '管理全部…' }).click();
	await expect(page.getByRole('dialog', { name: '管理工作区' })).toBeVisible();
});
