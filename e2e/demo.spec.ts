import { expect, test } from '@playwright/test';

// 手机浏览器打开 Web 的首访引导：介绍、导览、七步剧本与结尾卡片都不横向溢出。
test.use({ viewport: { width: 390, height: 844 } });

test('移动端 Web：首访介绍、功能导览、剧本与结尾卡片', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('一个会记住角色此刻处境的叙事引擎')).toBeVisible();
	await page.waitForTimeout(700);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
	).toBe(false);
	await page.screenshot({ path: 'test-results/demo-mobile-intro.png' });

	await page.getByRole('button', { name: '开始 3 分钟体验' }).click();
	await expect(page.getByRole('dialog', { name: '功能导览' })).toBeVisible();
	await page.waitForTimeout(700);
	await page.screenshot({ path: 'test-results/demo-mobile-tour.png' });

	// 导览第 2 站应聚光到顶栏的「实时状态」按钮。
	await page.getByRole('button', { name: '下一步' }).click();
	await page.waitForTimeout(700);
	await expect(page.getByText('状态是真的状态')).toBeVisible();
	await page.getByRole('button', { name: '跳过导览' }).click();

	await expect(page.getByText('演示剧本')).toBeVisible();
	await expect(page.getByRole('button', { name: /风把展板吹倒了/ })).toBeVisible();
	await page.waitForTimeout(500);
	await page.screenshot({ path: 'test-results/demo-mobile-dock.png' });
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
	).toBe(false);

	// 依次走完七步，进入结尾卡片。
	const labels = [
		'现在几点？',
		'去食堂',
		'换件卫衣',
		'半小时后',
		'去主楼大厅',
		'风把展板吹倒了',
		'一起修好它'
	];
	for (const label of labels) {
		await page.getByRole('button', { name: new RegExp(label) }).click();
		await page.waitForTimeout(900);
	}
	await page.getByRole('button', { name: /看时间线/ }).click();
	await expect(page.getByText('刚才的每一步')).toBeVisible();
	await page.waitForTimeout(600);
	await page.screenshot({ path: 'test-results/demo-mobile-cue.png' });
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
	).toBe(false);
});