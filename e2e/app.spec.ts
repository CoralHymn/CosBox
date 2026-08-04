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
	await page.locator('#outfit-top').selectOption('custom');
	await page.locator('#outfit-top-custom').fill('红色风衣');
	await page.getByRole('button', { name: '确定' }).click();

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
	await page.locator('#outfit-top').selectOption('黑色卫衣');

	await page.getByRole('button', { name: /版本/ }).click();
	await expect(page.getByText('更新穿着').first()).toBeVisible();
	await expect(page.getByText('分支', { exact: false }).first()).toBeVisible();

	// 切换回根快照（第一个「切换」按钮即根节点）
	await page.getByRole('button', { name: '切换' }).first().click();
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText('白色衬衫').first()).toBeVisible();
	await expect(page.getByText(/早上好/)).not.toBeVisible();
});

test('版本页删除分支后快照数减少且分支消失', async ({ page }) => {
	await page.goto('/');

	// 分支 A：早上好
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	// 切回根，再开分支 B：中午好
	await page.getByRole('button', { name: /版本/ }).click();
	await page.getByRole('button', { name: '切换' }).first().click();
	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('中午好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await page.getByRole('button', { name: /版本/ }).click();
	await expect(page.locator('.list-row')).toHaveCount(2);
	const snapshotsBefore = await page
		.locator('.chip')
		.filter({ hasText: '快照' })
		.textContent();

	page.on('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: '删除' }).first().click();

	await expect(page.locator('.list-row')).toHaveCount(1);
	await expect
		.poll(async () => page.locator('.chip').filter({ hasText: '快照' }).textContent())
		.toContain(String((snapshotsBefore ? parseInt(snapshotsBefore, 10) : 5) - 2));
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

test('开启 AI 状态工具后，演示模式按剧情自主切换地点', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#ai-tools-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();

	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('我们去食堂吧');
	await page.getByRole('button', { name: '发送' }).click();

	await expect(page.getByText(/好，那我们过去吧/)).toBeVisible();
	await expect(page.getByText('学校 > 食堂')).toBeVisible();
});

test('RP 斜杠命令：/goto /wear /time /help 直接修改状态', async ({ page }) => {
	await page.goto('/');

	await page.getByPlaceholder(/输入消息/).fill('/goto 食堂');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText('（命令）切换地点：学校 > 食堂')).toBeVisible();
	await expect(page.getByText('学校 > 食堂', { exact: true })).toBeVisible();

	await page.getByPlaceholder(/输入消息/).fill('/wear 上衣=黑色卫衣');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText('黑色卫衣').first()).toBeVisible();

	await page.getByPlaceholder(/输入消息/).fill('/time +30');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByRole('banner').getByText('周一 08:30')).toBeVisible();

	await page.getByPlaceholder(/输入消息/).fill('/help');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/可用 RP 快捷命令/)).toBeVisible();
});

test('地点库与衣柜可维护并反映到状态', async ({ page }) => {
	await page.goto('/');

	// 地点 tab：新增地点并设为当前所在地
	await page.getByRole('button', { name: /地点/ }).click();
	await page.locator('#new-place-category').fill('校外');
	await page.locator('#new-place-name').fill('海边');
	await page.locator('#new-place-desc').fill('午后涨潮，可以听到海浪声');
	await page.getByRole('button', { name: '添加地点' }).click();
	await expect(page.locator('input[placeholder="地点名"]').last()).toHaveValue('海边');
	await expect(page.locator('input[placeholder="分类"]').last()).toHaveValue('校外');
	await expect(page.locator('#current-place option').filter({ hasText: '海边' })).toHaveCount(1);
	await page.locator('#current-place').selectOption({ label: '校外 > 海边' });

	// 衣柜 tab：新增衣物并作为当前上衣
	await page.getByRole('button', { name: /衣柜/ }).click();
	await page.locator('#new-item-category').fill('常服');
	await page.locator('#new-item-name').fill('白色连衣裙');
	await page.locator('#new-item-desc').fill('白色碎花连衣裙，及膝，裙摆很轻');
	await page.getByRole('button', { name: '添加衣物' }).click();
	await expect(page.locator('#wardrobe-top option[value="白色连衣裙"]')).toHaveCount(1);
	await expect(page.locator('#wardrobe-top option[value="白色棉质内裤"]')).toHaveCount(0);
	const changfuGroup = page
		.locator('div.group')
		.filter({ has: page.locator('.group-name', { hasText: '常服' }) });
	await expect(changfuGroup.locator('input[placeholder="衣物名"]').last()).toHaveValue(
		'白色连衣裙'
	);
	await expect(changfuGroup.locator('input[placeholder="分类"]').last()).toHaveValue('常服');
	await page.locator('#wardrobe-top').selectOption('白色连衣裙');
	await expect(page.getByText('白色连衣裙：白色碎花连衣裙，及膝，裙摆很轻')).toBeVisible();

	// 对话 tab 的实时预览反映新地点与衣柜
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText('校外 > 海边')).toBeVisible();
	await expect(page.getByText('白色连衣裙').first()).toBeVisible();
});
