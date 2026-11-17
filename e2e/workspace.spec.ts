import { expect, test } from '@playwright/test';
import { APP_URL, enterDefaultWorkspace } from './utils';

test('新建工作区：初始界面创建并进入，与原工作区数据隔离', async ({ page }) => {
	await page.goto(APP_URL);
	// 初始界面必须占据整个视口（回归护栏：曾被 .app 双行网格压成顶部 54px 细条）。
	const homeBox = await page.locator('.home').boundingBox();
	expect(homeBox).not.toBeNull();
	expect(homeBox!.height).toBeGreaterThan(500);
	const createBox = await page.locator('.ws-create').boundingBox();
	expect(createBox).not.toBeNull();
	expect(createBox!.width).toBeGreaterThan(500);
	await enterDefaultWorkspace(page);
	// 默认工作区先留一条消息。
	await page.getByPlaceholder(/输入消息/).fill('只属于默认工作区');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/我在听/)).toBeVisible();

	// 退出回初始界面。
	await page.getByRole('button', { name: '退出到工作区选择' }).click();
	await expect(page.getByText('选择一个工作区开始')).toBeVisible();

	// 新建工作区并进入。
	await page.getByPlaceholder('新工作区名称').fill('新故事');
	await page.getByRole('button', { name: '新建工作区' }).click();
	await expect(page.getByRole('banner').getByText('周一 08:00')).toBeVisible();
	// 新工作区没有旧消息。
	await expect(page.locator('.message.user').filter({ hasText: '只属于默认工作区' })).toHaveCount(
		0
	);
	await expect(page.getByText('开始一段新的故事吧')).toBeVisible();
	// 导航切换器显示新工作区名。
	await expect(page.locator('.nav-workspace-name')).toHaveText('新故事');
});

test('导航切换器：在应用内切换工作区，数据互相隔离', async ({ page }) => {
	await page.goto(APP_URL);
	await enterDefaultWorkspace(page);
	await page.getByPlaceholder(/输入消息/).fill('只属于默认工作区');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/我在听/)).toBeVisible();

	// 打开管理弹层 → 新建「第二」→ 自动进入。
	await page.locator('.nav-workspace-switch').click();
	await page.getByPlaceholder('新工作区名称').fill('第二');
	await page.getByRole('button', { name: '新建工作区' }).click();
	await expect(page.locator('.nav-workspace-name')).toHaveText('第二');
	await expect(page.locator('.message.user').filter({ hasText: '只属于默认工作区' })).toHaveCount(
		0
	);

	// 弹层切回默认：消息还在。
	await page.locator('.nav-workspace-switch').click();
	await page.locator('.ws-enter').filter({ hasText: '默认工作区' }).click();
	await expect(page.locator('.nav-workspace-name')).toHaveText('默认工作区');
	await expect(page.locator('.message.user').filter({ hasText: '只属于默认工作区' })).toHaveCount(
		1
	);
});

test('重命名工作区', async ({ page }) => {
	await page.goto(APP_URL);
	await enterDefaultWorkspace(page);
	await page.locator('.nav-workspace-switch').click();
	const row = page.locator('.ws-row').filter({ hasText: '默认工作区' });
	await row.getByRole('button', { name: '重命名' }).click();
	// 进入编辑态后行内只剩 input（input 的值不参与 hasText 匹配），改用编辑区定位。
	const editInput = page.locator('.ws-row .ws-edit input');
	await editInput.fill('改名后');
	await page.locator('.ws-row .ws-edit').getByRole('button', { name: '保存' }).click();
	await expect(page.locator('.ws-row').filter({ hasText: '改名后' })).toBeVisible();
	await expect(page.locator('.nav-workspace-name')).toHaveText('改名后');
});

test('复制工作区：副本包含原对话并自动切换', async ({ page }) => {
	await page.goto(APP_URL);
	await enterDefaultWorkspace(page);
	await page.getByPlaceholder(/输入消息/).fill('复制前的对话');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/我在听/)).toBeVisible();

	await page.locator('.nav-workspace-switch').click();
	await page
		.locator('.ws-row')
		.filter({ hasText: '默认工作区' })
		.getByRole('button', { name: '复制工作区' })
		.click();
	await expect(page.locator('.nav-workspace-name')).toHaveText('默认工作区 副本');
	await expect(page.locator('.message.user').filter({ hasText: '复制前的对话' })).toHaveCount(1);
});

test('删除非当前工作区', async ({ page }) => {
	await page.goto(APP_URL);
	await enterDefaultWorkspace(page);
	// 新建「待删除」（当前），再切回默认。
	await page.locator('.nav-workspace-switch').click();
	await page.getByPlaceholder('新工作区名称').fill('待删除');
	await page.getByRole('button', { name: '新建工作区' }).click();
	await page.locator('.nav-workspace-switch').click();
	await page.locator('.ws-enter').filter({ hasText: '默认工作区' }).click();
	await expect(page.locator('.nav-workspace-name')).toHaveText('默认工作区');

	// 删除「待删除」：确认弹窗 → 列表移除。
	await page.locator('.nav-workspace-switch').click();
	page.on('dialog', (dialog) => dialog.accept());
	await page
		.locator('.ws-row')
		.filter({ hasText: '待删除' })
		.getByRole('button', { name: '删除工作区' })
		.click();
	await expect(page.locator('.ws-row').filter({ hasText: '待删除' })).toHaveCount(0);
});

test('导出 .cbox 并导入为新工作区', async ({ page }) => {
	await page.goto(APP_URL);
	await enterDefaultWorkspace(page);
	await page.getByPlaceholder(/输入消息/).fill('导出前的对话');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/我在听/)).toBeVisible();

	// 设置 → 导出当前工作区（浏览器下载）。
	await page.getByRole('button', { name: /设置/ }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: '导出工作区' }).click();
	const download = await downloadPromise;
	const filePath = await download.path();

	// 退出回初始界面 → 导入为新工作区（名称与默认工作区冲突 → 自动追加编号）。
	await page.getByRole('button', { name: '退出到工作区选择' }).click();
	await expect(page.getByText('选择一个工作区开始')).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles(filePath!);
	await expect(page.locator('.nav-workspace-name')).toHaveText('默认工作区 2');
	// 导入后落在对话页，用户消息与回复完整。
	await expect(page.locator('.message.user').filter({ hasText: '导出前的对话' })).toHaveCount(1);
	await expect(page.getByText(/我在听/)).toBeVisible();
});
