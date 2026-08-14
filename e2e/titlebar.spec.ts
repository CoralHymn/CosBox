import { expect, test } from '@playwright/test';
import { enterDefaultWorkspace } from './utils';

// 注入 Tauri 桌面环境标识：isTauri() 为 true，UA 不含 Android → 自定义标题栏模式。
test.beforeEach(async ({ page }) => {
	await page.addInitScript('window.__TAURI_INTERNALS__ = {};');
});

test('Tauri 桌面：自定义标题栏承载窗口控制与工作区切换，内容占满剩余空间', async ({ page }) => {
	await page.goto('/');
	// 标题栏：40px，含工作区切换器与最小化/最大化/关闭。
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

	// 进入工作区后：顶栏 + 内容区都正常（回归护栏：曾被压成 54px 细条）。
	await expect(page.getByRole('banner')).toBeVisible();
	const bodyBox = await page.locator('.body').boundingBox();
	expect(bodyBox).not.toBeNull();
	expect(bodyBox!.height).toBeGreaterThan(500);
	await expect(page.getByText('开始一段新的故事吧')).toBeVisible();

	// 标题栏里的切换器能打开管理弹层。
	await page.locator('.titlebar-ws').click();
	await expect(page.getByRole('dialog', { name: '管理工作区' })).toBeVisible();
});
