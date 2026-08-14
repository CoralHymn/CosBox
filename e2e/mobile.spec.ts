import { expect, test } from '@playwright/test';
import { enterDefaultWorkspace } from './utils';

// 移动端视口：验证左侧抽屉导航、右上角状态浮层、聊天可用、无横向溢出
test.use({ viewport: { width: 390, height: 844 } });

test('移动端：左侧抽屉导航 + 右上角状态浮层 + 聊天可用 + 无横向溢出', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('CosBox')).toBeVisible();
	await enterDefaultWorkspace(page);

	// 汉堡按钮打开左侧抽屉
	const menuToggle = page.getByRole('button', { name: '打开菜单' });
	await expect(menuToggle).toBeVisible();
	await menuToggle.click();
	const navRail = page.locator('.nav-rail');
	await expect(navRail).toBeVisible();
	await expect(page.locator('.nav-backdrop.show')).toBeVisible();
	// 等待抽屉滑入动画完成
	await expect.poll(() => navRail.evaluate((el) => el.getBoundingClientRect().left)).toBe(0);
	await expect(page.locator('.nav-item')).toHaveCount(11);

	// 点击抽屉里的「状态」：抽屉关闭并切换页面
	await navRail.getByRole('button', { name: /状态/ }).click();
	await expect(page.locator('.nav-backdrop.show')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: '角色状态编辑器' })).toBeVisible();

	// 回到对话
	await menuToggle.click();
	await page.locator('.nav-rail').getByRole('button', { name: /对话/ }).click();
	await expect(page.getByPlaceholder(/输入消息/)).toBeVisible();

	// 顶栏状态开关显示时间 + 地点，点击展开浮层
	const stateToggle = page.getByRole('button', { name: '实时状态' });
	await expect(stateToggle).toBeVisible();
	await expect(stateToggle).toContainText('周一 08:00');
	await expect(stateToggle).toContainText('学院正门');
	await stateToggle.click();
	const stateDialog = page.getByRole('dialog', { name: '实时状态' });
	await expect(stateDialog).toBeVisible();
	await expect(stateDialog.getByText('实时状态预览')).toBeVisible();
	await stateDialog.getByRole('button', { name: '关闭状态面板' }).click();
	await expect(page.getByRole('dialog', { name: '实时状态' })).toHaveCount(0);

	// 聊天可用：发送消息并收到演示回复
	await page.getByPlaceholder(/输入消息/).fill('你好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	// 无横向溢出
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	expect(overflow).toBe(false);
});
