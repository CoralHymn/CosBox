import { expect, test } from '@playwright/test';

// 移动端视口：验证底部导航、聊天可用、无横向溢出
test.use({ viewport: { width: 390, height: 844 } });

test('移动端：底部导航 + 聊天可用 + 无横向溢出', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('CosBox')).toBeVisible();

	// 导航为底部横向标签栏（9 个 tab）
	await expect(page.locator('.nav-rail')).toBeVisible();
	await expect(page.locator('.nav-item')).toHaveCount(9);
	const layout = await page.evaluate(() => {
		const nav = document.querySelector('.nav-rail')!.getBoundingClientRect();
		const content = document.querySelector('.content')!.getBoundingClientRect();
		return {
			navTop: nav.top,
			contentTop: content.top,
			flexDirection: getComputedStyle(document.querySelector('.nav-rail')!).flexDirection
		};
	});
	expect(layout.flexDirection).toBe('row');
	expect(layout.navTop).toBeGreaterThan(layout.contentTop);

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
