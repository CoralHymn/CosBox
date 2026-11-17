import { expect, test } from '@playwright/test';
import { APP_URL } from './utils';

// 移动端视口：微信式会话列表首屏、底部「对话/设置」栏、聊天沉浸页 + 「⋯」功能抽屉、无横向溢出
test.use({ viewport: { width: 390, height: 844 } });

test('移动端：会话列表首屏 + 底部标签栏 + 聊天沉浸页 + 功能抽屉 + 无横向溢出', async ({ page }) => {
	await page.goto(APP_URL);
	await expect(page.getByText('CosBox').first()).toBeVisible();

	// 首屏 = 工作区会话列表（微信式）：列表项与底部「对话/设置」标签栏。
	const listItem = page.locator('.ws-home-item').filter({ hasText: '默认工作区' });
	await expect(listItem).toBeVisible();
	await expect(page.getByRole('button', { name: '管理工作区' })).toBeVisible();
	const chatTab = page.locator('.mobile-home-tab', { hasText: '对话' });
	const settingsTab = page.locator('.mobile-home-tab', { hasText: '设置' });
	await expect(chatTab).toBeVisible();
	await expect(settingsTab).toBeVisible();

	// 底部「设置」tab：分区菜单 → 全屏设置详情 → 返回。
	await settingsTab.click();
	await expect(page.locator('.mobile-settings-title')).toHaveText('设置');
	await page.locator('.mobile-settings-item').first().click();
	await expect(page.getByText('模型服务管理')).toBeVisible();
	await page.getByRole('button', { name: '返回设置菜单' }).click();
	await expect(page.locator('.mobile-settings-title')).toBeVisible();
	await chatTab.click();
	await expect(listItem).toBeVisible();

	// 点头像打开头像编辑器（全屏形态），可直接关闭。
	await listItem.getByRole('button', { name: /编辑「默认工作区」的头像/ }).click();
	await expect(page.getByRole('dialog', { name: '编辑角色头像' })).toBeVisible();
	await page.getByRole('dialog', { name: '编辑角色头像' }).getByText('恢复默认').click();
	// 保存后回到列表（toast 提示头像已保存）。
	await expect(page.getByText('头像已保存')).toBeVisible();

	// 点会话进入聊天沉浸页：顶栏 = 返回 + 工作区名 + 「⋯」。
	await listItem.locator('.ws-home-main').click();
	await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
	const chatHead = page.locator('.mobile-chat-head');
	await expect(chatHead).toBeVisible();
	await expect(chatHead).toContainText('默认工作区');
	await expect(chatHead).toContainText('周一 08:00');

	// 「⋯」打开功能抽屉：选「状态」进入对应面板。
	await page.getByRole('button', { name: '功能菜单' }).click();
	const drawer = page.getByRole('dialog', { name: '功能菜单' });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText('角色与世界')).toBeVisible();
	await drawer.getByRole('button', { name: '状态' }).click();
	await expect(page.getByRole('heading', { name: '角色状态编辑器' })).toBeVisible();

	// 顶栏返回箭头：功能页回到对话。
	await page.getByRole('button', { name: '返回对话' }).click();
	await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();

	// 聊天可用：发送消息并收到演示回复。
	await page.getByPlaceholder(/输入消息/).fill('你好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/我在听/)).toBeVisible();

	// 返回箭头回到会话列表，且列表预览更新为最近消息。
	await page.getByRole('button', { name: '返回会话列表' }).click();
	await expect(listItem).toBeVisible();
	await expect(listItem).toContainText('我在听');

	// 无横向溢出
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	expect(overflow).toBe(false);
});

// Android 硬件返回键在 Tauri 里等价于 webView.goBack()，所以浏览器后退能覆盖同一条路径：
// 逐层退出设置详情 / 功能页 / 工作区，而不是一路退到桌面。
test('移动端：返回键逐层回退（设置详情 → 设置 → 会话列表，工作区 → 功能页 → 对话）', async ({
	page
}) => {
	await page.goto(APP_URL);
	const listItem = page.locator('.ws-home-item').filter({ hasText: '默认工作区' });
	await expect(listItem).toBeVisible();

	// 首屏：设置 tab → 全屏设置详情，返回键逐层退回会话列表。
	await page.locator('.mobile-home-tab', { hasText: '设置' }).click();
	await expect(page.locator('.mobile-settings-title')).toBeVisible();
	await page.locator('.mobile-settings-item').first().click();
	await expect(page.getByText('模型服务管理')).toBeVisible();

	await page.goBack();
	await expect(page.locator('.mobile-settings-title')).toBeVisible();
	await page.goBack();
	await expect(listItem).toBeVisible();

	// 进入工作区 → 「⋯」里的功能全屏页：返回键先回对话，再回会话列表。
	await listItem.locator('.ws-home-main').click();
	await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();
	await page.getByRole('button', { name: '功能菜单' }).click();
	await page
		.getByRole('dialog', { name: '功能菜单' })
		.getByRole('button', { name: '状态' })
		.click();
	await expect(page.getByRole('heading', { name: '角色状态编辑器' })).toBeVisible();

	await page.goBack();
	await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();

	await page.goBack();
	await expect(listItem).toBeVisible();
});
