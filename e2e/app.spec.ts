import { expect, test } from '@playwright/test';

/** 示例角色卡 JSON（chara_card_v3 规范）。 */
const SAMPLE_CARD = JSON.stringify({
	spec: 'chara_card_v3',
	spec_version: '3.0',
	data: {
		name: '测试角色',
		description: '来自测试卡的角色背景',
		first_mes: '你好，我是测试角色。'
	}
});

test('应用加载并展示初始角色状态', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('CosBox')).toBeVisible();
	await expect(page.getByRole('banner').getByText('周一 08:00')).toBeVisible();
	await expect(page.getByRole('banner').getByText('演示模式')).toBeVisible();
	await expect(page.getByText('开始一段新的故事吧')).toBeVisible();
});

test('发送消息：演示模式回复并追加快照', async ({ page }) => {
	await page.goto('/');
	const snapshotsBefore = await page.locator('.chip').filter({ hasText: '快照' }).textContent();

	await page.getByPlaceholder(/输入消息/).fill('你好，绫音');
	await page.getByRole('button', { name: '发送' }).click();

	await expect(page.getByText(/演示模式回应/)).toBeVisible();
	await expect(page.locator('.message.user')).toHaveCount(1);
	await expect(page.locator('.message.assistant')).toHaveCount(1);

	await expect
		.poll(async () => page.locator('.chip').filter({ hasText: '快照' }).textContent())
		.toContain(String((snapshotsBefore ? parseInt(snapshotsBefore, 10) : 1) + 2));
});

test('状态编辑生成快照并在预览中反映', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /状态/ }).click();
	await page.locator('#outfit-top').fill('红色风衣');
	await page.locator('#outfit-top').blur();

	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText('红色风衣')).toBeVisible();
});

test('版本页切换回退状态与对话', async ({ page }) => {
	await page.goto('/');

	// 先产生一条消息与一次状态变更
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await page.getByRole('button', { name: /状态/ }).click();
	await page.locator('#outfit-top').fill('运动外套');
	await page.locator('#outfit-top').blur();

	await page.getByRole('button', { name: /版本/ }).click();
	await expect(page.getByText('更新穿着').first()).toBeVisible();
	await expect(page.getByText('分支', { exact: false }).first()).toBeVisible();

	// 切换回根快照（第一个「切换」按钮即根节点）
	await page.getByRole('button', { name: '切换' }).first().click();
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText('白色衬衫').first()).toBeVisible();
	await expect(page.getByText(/早上好/)).not.toBeVisible();
});

test('日程：时间推进自动生成快照', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();
	await page.getByRole('button', { name: '+15m' }).click();
	await expect(page.getByRole('banner').getByText('周一 08:15')).toBeVisible();
});

test('导入 SillyTavern V3 角色卡并写入世界书', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /导入导出/ }).click();
	await page.locator('#import-text').fill(SAMPLE_CARD);
	await page.getByRole('button', { name: '导入角色卡' }).click();

	await expect(page.getByText(/导入成功/)).toBeVisible();
	await page.getByRole('button', { name: /世界书/ }).click();
	await expect(page.locator('.card textarea').first()).toHaveValue('来自测试卡的角色背景');
});

test('设置页选择主流服务商预设自动填充地址与模型', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#llm-provider').selectOption('deepseek');
	await expect(page.locator('#llm-base-url')).toHaveValue('https://api.deepseek.com/v1');
	await expect(page.locator('#llm-model')).toHaveValue('deepseek-v4-flash');

	await page.locator('#llm-provider').selectOption('ollama');
	await expect(page.locator('#llm-base-url')).toHaveValue('http://localhost:11434/v1');
	await expect(page.locator('#llm-model')).toHaveValue('qwen3:8b');

	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();
});

test('地点库与衣柜可维护并反映到状态', async ({ page }) => {
	await page.goto('/');

	// 地点 tab：新增地点并设为当前所在地
	await page.getByRole('button', { name: /地点/ }).click();
	await page.locator('#new-place-name').fill('海边');
	await page.locator('#new-place-desc').fill('午后涨潮，可以听到海浪声');
	await page.getByRole('button', { name: '添加地点' }).click();
	await expect(page.locator('input[placeholder="地点名"]').last()).toHaveValue('海边');
	await expect(page.locator('#current-place option').filter({ hasText: '海边' })).toHaveCount(1);
	await page.locator('#current-place').selectOption({ label: '海边' });

	// 衣柜 tab：新增衣物并作为当前上衣
	await page.getByRole('button', { name: /衣柜/ }).click();
	await page.locator('#new-item-name').fill('白色连衣裙');
	await page.locator('#new-item-desc').fill('白色碎花连衣裙，及膝，裙摆很轻');
	await page.getByRole('button', { name: '添加衣物' }).click();
	await expect(page.locator('input[placeholder="衣物名"]').last()).toHaveValue('白色连衣裙');
	await expect(page.locator('#wardrobe-names option[value="白色连衣裙"]')).toHaveCount(1);
	await page.locator('#wardrobe-top').fill('白色连衣裙');
	await page.locator('#wardrobe-top').blur();
	await expect(page.getByText('白色连衣裙：白色碎花连衣裙，及膝，裙摆很轻')).toBeVisible();

	// 对话 tab 的实时预览反映新地点与衣柜
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText('海边').first()).toBeVisible();
	await expect(page.getByText('白色连衣裙').first()).toBeVisible();
});
