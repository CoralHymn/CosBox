import { expect, type Page } from '@playwright/test';

/**
 * 自动化测试入口：显式关闭首访演示（介绍 + 示例工作区），
 * 直接落到工作区选择首屏。正常访问仍会展示演示。
 */
export const APP_URL = '/?demo=off';

/**
 * 多工作区后的启动流程：每次打开/刷新都会先进入工作区选择初始界面，
 * 需要点选「默认工作区」进入主界面（主界面以顶栏状态条（时间 周一 08:00）为标志，
 * Web 在 header、Tauri 桌面在标题栏，均为 `.chip`）。
 */
export async function enterDefaultWorkspace(page: Page): Promise<void> {
	const entry = page.locator('.ws-enter').filter({ hasText: '默认工作区' });
	await expect(entry).toBeVisible();
	await entry.click();
	await expect(page.locator('.chip').first()).toContainText('周一 08:00');
}
