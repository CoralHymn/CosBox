import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('导出最近消息日志：从最近用户发言开始包含回复', async ({ page }) => {
	await page.goto('/');
	// 导出日志属于开发者功能：先开启开发者模式
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await page.getByRole('button', { name: /对话/ }).click();

	await page.getByPlaceholder(/输入消息/).fill('你好，绫音');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /导出最近日志/ }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^cosbox-log-\d{8}-\d{4}\.txt$/);
	const path = await download.path();
	const content = readFileSync(path!, 'utf8');
	expect(content).toContain('[用户] 你好，绫音');
	expect(content).toContain('[角色] （演示模式回应）');
});

test('编辑 assistant 回复正文并原地落库', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder(/输入消息/).fill('你好，绫音');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	const bubble = page.locator('.message.assistant').first();
	const assistantRow = page.locator('.message-row.assistant').first();
	// 操作条位于气泡下方，悬浮才显示：先 hover 整行再点编辑
	await assistantRow.hover();
	await assistantRow.getByRole('button', { name: '编辑消息' }).click();
	const inlineEdit = bubble.locator('textarea.inline-edit');
	// 等待编辑区进入可编辑状态（原文由 effect 填充）
	await expect(inlineEdit).toBeAttached();
	await inlineEdit.fill('（编辑后）新的回应文本');
	await expect(inlineEdit).toHaveValue('（编辑后）新的回应文本');
	await assistantRow.getByRole('button', { name: '保存' }).click();

	await expect(bubble.getByText('（编辑后）新的回应文本')).toBeVisible();
	await expect(bubble.getByText(/演示模式回应/)).not.toBeVisible();

	// 刷新后编辑内容仍保留（快照原地改写）
	await page.reload();
	await expect(
		page.locator('.message.assistant').first().getByText('（编辑后）新的回应文本')
	).toBeVisible();
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

test('消息重试：回溯重新生成并可切换分支', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder(/输入消息/).fill('你好，绫音');
	await page.getByRole('button', { name: '发送' }).click();
	const reply = page.locator('.message.assistant').first();
	const userRow = page.locator('.message-row.user').first();
	const assistantRow = page.locator('.message-row.assistant').first();
	await expect(reply.getByText(/演示模式回应/)).toBeVisible();

	// 先把旧回复改成可区分的文本，便于验证分支切换
	await assistantRow.hover();
	await assistantRow.getByRole('button', { name: '编辑消息' }).click();
	await reply.locator('textarea.inline-edit').fill('（编辑后）旧分支回复');
	await expect(reply.locator('textarea.inline-edit')).toHaveValue('（编辑后）旧分支回复');
	await assistantRow.getByRole('button', { name: '保存' }).click();
	await expect(reply.getByText('（编辑后）旧分支回复')).toBeVisible();

	// 重试挂在用户气泡：回溯到该条用户消息并重新生成（演示模式恢复确定性原文）
	await userRow.hover();
	await userRow.getByRole('button', { name: '重新生成' }).click();
	await expect(reply.getByText(/演示模式回应/)).toBeVisible();

	// 分支切换：< > 悬浮出现在用户气泡下方，可在旧分支与新分支之间往返
	await userRow.hover();
	await userRow.getByRole('button', { name: '切换为更早的分支' }).click();
	await expect(reply.getByText('（编辑后）旧分支回复')).toBeVisible();

	await userRow.hover();
	await userRow.getByRole('button', { name: '切换为更新的分支' }).click();
	await expect(reply.getByText(/演示模式回应/)).toBeVisible();
});

test('手动 LLM 状态确认：灯泡按钮补执行状态工具', async ({ page }) => {
	await page.goto('/');
	// 灯泡按钮依赖「允许 AI 自主修改状态」开关
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#ai-tools-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await page.getByRole('button', { name: /对话/ }).click();

	await page.getByPlaceholder(/输入消息/).fill('时间推进，过了一段时间');
	await page.getByRole('button', { name: '发送' }).click();
	const bubble = page.locator('.message.assistant').first();
	await expect(bubble.getByText(/演示模式回应/)).toBeVisible();

	const toolFeedback = page.locator('.message.system', { hasText: '【工具调用】' });
	// 原生 demo 已按关键词调用一次 advance_time
	await expect(toolFeedback).toHaveCount(1);

	// 点击灯泡（AI 气泡下方）：LLM 判断需要变更并补执行 advance_time
	const assistantRow = page.locator('.message-row.assistant').first();
	await assistantRow.hover();
	await assistantRow.getByRole('button', { name: 'LLM 状态确认' }).click();

	await expect(toolFeedback).toHaveCount(2);
	await expect(page.getByText('LLM 状态判断已同步 1 项变更')).toBeVisible();
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
	await expect(page.getByText('分支列表').first()).toBeVisible();

	// 分支默认收起：先展开，验证链内「新的在上、旧的在下」，再切换回根快照
	await page.getByRole('button', { name: '展开' }).first().click();
	const chainRows = page.locator('.branch-chain .version-row');
	await expect(chainRows.first()).toContainText('更新穿着');
	await expect(chainRows.last()).toContainText('初始状态');
	await chainRows.locator('button', { hasText: '切换' }).last().click();
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
	await page.getByRole('button', { name: '展开' }).first().click();
	await page
		.locator('.branch-chain .version-row')
		.locator('button', { hasText: '切换' })
		.last()
		.click();
	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('中午好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await page.getByRole('button', { name: /版本/ }).click();
	await expect(page.locator('.branch-card')).toHaveCount(2);
	const snapshotsBefore = await page.locator('.chip').filter({ hasText: '快照' }).textContent();

	page.on('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: '删除', exact: true }).first().click();

	await expect(page.locator('.branch-card')).toHaveCount(1);
	await expect
		.poll(async () => page.locator('.chip').filter({ hasText: '快照' }).textContent())
		.toContain(String((snapshotsBefore ? parseInt(snapshotsBefore, 10) : 5) - 2));
});

test('版本页批量删除：勾选分支后删除所选分支', async ({ page }) => {
	await page.goto('/');
	// 分支 A
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	// 切回根，再开分支 B
	await page.getByRole('button', { name: /版本/ }).click();
	await page.getByRole('button', { name: '展开' }).first().click();
	await page
		.locator('.branch-chain .version-row')
		.locator('button', { hasText: '切换' })
		.last()
		.click();
	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('中午好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await page.getByRole('button', { name: /版本/ }).click();
	await expect(page.locator('.branch-card')).toHaveCount(2);
	await page.getByRole('button', { name: '批量删除' }).click();
	await expect(page.locator('.batch-bar')).toBeVisible();

	// 勾选一条分支并接受确认框
	page.once('dialog', (dialog) => void dialog.accept());
	await page.locator('.branch-card .branch-header input[type="checkbox"]').first().check();
	await page.getByRole('button', { name: /删除所选/ }).click();

	await expect(page.locator('.batch-bar')).not.toBeVisible();
	await expect(page.locator('.branch-card')).toHaveCount(1);
});

test('输入 / 触发快捷命令补全：/goto 补地点、/wear 先补槽位再补衣物', async ({ page }) => {
	await page.goto('/');
	const input = page.getByPlaceholder(/输入消息/);

	// / 显示命令候选，选择 /goto
	await input.fill('/');
	await expect(page.getByRole('option', { name: /\/goto 地点/ })).toBeVisible();
	await input.press('Enter');
	await expect(input).toHaveValue('/goto ');

	// /goto 补地点：选「学校 > 食堂」
	await expect(page.getByRole('option', { name: /学校 > 食堂/ })).toBeVisible();
	await input.press('ArrowDown');
	await input.press('ArrowDown');
	await input.press('Enter');
	await expect(input).toHaveValue('/goto 学校 > 食堂');
	await input.press('Enter');
	await expect(page.getByText('（命令）切换地点：学校 > 食堂')).toBeVisible();
	await expect(page.getByText('学校 > 食堂', { exact: true })).toBeVisible();

	// /wear 先补槽位，再补该槽位的衣物
	await input.fill('/wear ');
	await expect(page.getByRole('option', { name: /上衣=/ })).toBeVisible();
	await input.press('ArrowDown');
	await input.press('Enter');
	await expect(input).toHaveValue('/wear 上衣=');
	await expect(page.getByRole('option', { name: /黑色卫衣/ })).toBeVisible();
	await input.press('ArrowDown');
	await input.press('ArrowDown');
	await input.press('Enter');
	await expect(input).toHaveValue('/wear 上衣=黑色卫衣');
	await input.press('Enter');
	await expect(page.getByText('黑色卫衣').first()).toBeVisible();
});

test('日程：时间推进自动生成快照', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();
	await page.getByRole('button', { name: '+15m' }).click();
	await expect(page.getByRole('banner').getByText('周一 08:15')).toBeVisible();
});

test('日程：条目编辑属于配置，不生成版本快照', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();

	// 修改最后一条（午休）的星期：自动排序后仍在末尾，状态更新但不生成快照
	await page.locator('.list-row select').last().selectOption('6');
	await expect(page.locator('.list-row select').last()).toHaveValue('6');
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);

	// 新增条目：行出现但快照数不变
	await page.locator('#entry-title').fill('晚自习');
	await page.locator('#entry-start').fill('19:00');
	await page.locator('#entry-end').fill('20:30');
	await page.getByRole('button', { name: '添加条目' }).click();
	await expect(page.locator('.list-row')).toHaveCount(4);
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('地点库与衣柜的维护编辑不生成版本快照', async ({ page }) => {
	await page.goto('/');

	// 地点：添加地点是配置编辑，不生成快照；设为当前所在地才是剧情状态
	await page.getByRole('button', { name: /地点/ }).click();
	await page.locator('#new-place-category').fill('校外');
	await page.locator('#new-place-name').fill('海边');
	await page.locator('#new-place-desc').fill('涨潮');
	await page.getByRole('button', { name: '添加地点' }).click();
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
	await page.locator('#current-place').selectOption({ label: '校外 > 海边' });
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/2 快照/);

	// 衣柜：添加衣物是配置编辑，不生成快照；更换当前穿着才是剧情状态
	await page.getByRole('button', { name: /衣柜/ }).click();
	await page.locator('#new-item-category').fill('常服');
	await page.locator('#new-item-name').fill('红色风衣');
	await page.locator('#new-item-desc').fill('修身款');
	await page.getByRole('button', { name: '添加衣物' }).click();
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/2 快照/);
	await page.locator('#wardrobe-top').selectOption('红色风衣');
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/3 快照/);
});

test('地点分类在失焦/回车时才提交，输入过程不实时分组', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /地点/ }).click();
	await page.locator('#new-place-category').fill('市中心');
	await page.locator('#new-place-name').fill('测试地点A');
	await page.getByRole('button', { name: '添加地点' }).click();

	const rowCategory = page.locator('input[placeholder="分类"]').last();
	await expect(rowCategory).toHaveValue('市中心');

	// 输入新分类时仍是原分组：旧实现每敲一个字就换分组，打断中文输入
	await rowCategory.click();
	await rowCategory.fill('商业街');
	await expect(page.locator('.group-name', { hasText: '市中心' })).toBeVisible();
	await expect(page.locator('.group-name', { hasText: '商业街' })).toHaveCount(0);

	// 回车提交后才移动到新分类并保存
	await rowCategory.press('Enter');
	const businessGroup = page.locator('div.group').filter({
		has: page.locator('.group-name', { hasText: '商业街' })
	});
	await expect(businessGroup.locator('input[placeholder="分类"]').last()).toHaveValue('商业街');
	await expect(businessGroup.locator('input[placeholder="地点名"]').last()).toHaveValue('测试地点A');
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

	// 点击模型输入框弹出候选下拉，可用键盘选择
	await page.locator('#llm-model').click();
	await expect(
		page.locator('.combobox-item').filter({ hasText: 'deepseek-v4-flash' })
	).toBeVisible();
	await expect(page.locator('.combobox-item').filter({ hasText: 'deepseek-v4-pro' })).toBeVisible();
	await page.keyboard.press('Escape');

	await page.locator('#llm-provider').selectOption('ollama');
	await expect(page.locator('#llm-base-url')).toHaveValue('http://localhost:11434/v1');
	await expect(page.locator('#llm-model')).toHaveValue('qwen3:8b');

	// 上下文压缩默认开启，可关闭并随配置保存
	await expect(page.locator('#auto-compact-enabled')).toBeChecked();
	await page.locator('#auto-compact-enabled').uncheck();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();
});

test('设置：角色档案默认显示、保存不回清、回到默认、开发者模式', async ({ page }) => {
	await page.goto('/');

	// 未启用网络搜索时，对话页不显示搜索按钮
	await expect(page.getByRole('button', { name: '网络搜索' })).toHaveCount(0);

	await page.getByRole('button', { name: /设置/ }).click();
	// 角色档案默认显示内置角色与提示词模板
	await expect(page.locator('#profile-name')).toHaveValue('绫音');
	await expect(page.locator('#profile-prompt')).not.toHaveValue('');

	// 输入并保存后文本框不回清
	await page.locator('#profile-name').fill('测试角色');
	await page.locator('#profile-prompt').fill('你是测试角色');
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.locator('#profile-name')).toHaveValue('测试角色');
	await expect(page.locator('#profile-prompt')).toHaveValue('你是测试角色');

	// 回到默认仅重置角色档案
	await page.getByRole('button', { name: '回到默认' }).click();
	await expect(page.locator('#profile-name')).toHaveValue('绫音');

	// 开发者模式：开启后对话页可展开查看完整提示词
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	// 开发者模式：打开大尺寸弹窗查看完整提示词，可滚动、可关闭
	await page.getByRole('button', { name: '开发者：查看最近一次完整提示词' }).click();
	const promptModal = page.locator('.prompt-modal');
	await expect(promptModal).toBeVisible();
	await expect(promptModal.getByText('【当前状态】').first()).toBeVisible();
	await expect(promptModal.locator('.prompt-modal-body')).toHaveCSS('overflow-y', 'auto');
	await expect(promptModal.locator('pre').first()).toHaveCSS('white-space', 'pre-wrap');
	await expect(page.getByRole('button', { name: '复制全部' })).toBeVisible();
	await promptModal.getByRole('button', { name: '关闭' }).click();
	await expect(promptModal).not.toBeVisible();
});

test('设置：主题预设即时生效并持久化，背景图透明度可调', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();

	const bgVar = () =>
		page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());

	// 默认主题
	await expect(page.locator('#theme-preset')).toHaveValue('default');
	await expect.poll(bgVar).toBe('#0e1016');

	// 切换到 Discord 预设：即时应用
	await page.locator('#theme-preset').selectOption('discord');
	await expect.poll(bgVar).toBe('#0a0d3a');
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
			)
		)
		.toBe('#5865f2');

	// 刷新后主题持久化
	await page.reload();
	await page.getByRole('button', { name: /设置/ }).click();
	await expect(page.locator('#theme-preset')).toHaveValue('discord');
	await expect.poll(bgVar).toBe('#0a0d3a');

	// 恢复默认主题
	await page.getByRole('button', { name: '恢复默认主题' }).click();
	await expect.poll(bgVar).toBe('#0e1016');

	// 背景图：上传后 body 透明、::before 图层承载图片（不被不透明 body 背景遮挡）
	const svg =
		"<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='#ff0000'/></svg>";
	await page
		.locator('#theme-bg-file')
		.setInputFiles({ name: 'bg.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg, 'utf8') });
	await expect
		.poll(() =>
			page.evaluate(
				() => getComputedStyle(document.body, '::before').backgroundImage
			)
		)
		.toContain('data:image/svg+xml');
	await expect
		.poll(() =>
			page.evaluate(() => getComputedStyle(document.body).backgroundColor)
		)
		.toBe('rgba(0, 0, 0, 0)');
	// 有背景图时顶栏等结构面自动透明，背景图透过面板铺满
	await expect
		.poll(() =>
			page.evaluate(() => getComputedStyle(document.querySelector('.header')!).backgroundColor)
		)
		.toBe('rgba(0, 0, 0, 0)');
	// 透明度滑杆存在且可调
	await expect(page.locator('#theme-bg-opacity')).toBeVisible();
	await page.locator('#theme-bg-opacity').fill('50');
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.documentElement.style.getPropertyValue('--bg-image-opacity')
			)
		)
		.toBe('0.5');
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
	await expect(page.getByText('学校 > 食堂', { exact: true })).toBeVisible();
});

test('开启 AI 状态工具后，演示模式 set_outfit 换装生成快照并反映到状态', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#ai-tools-enabled').check();
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();

	await page.getByRole('button', { name: /对话/ }).click();
	const snapshotsBefore = await page.locator('.chip').filter({ hasText: '快照' }).textContent();

	await page.getByPlaceholder(/输入消息/).fill('换上运动服');
	await page.getByRole('button', { name: '发送' }).click();

	// 工具调用 → 状态快照 → 最终回复
	await expect(page.getByText(/这套很适合现在/)).toBeVisible();
	await expect(page.getByText('黑色卫衣').first()).toBeVisible();
	await expect
		.poll(async () => page.locator('.chip').filter({ hasText: '快照' }).textContent())
		.toContain(String((snapshotsBefore ? parseInt(snapshotsBefore, 10) : 1) + 4));

	// 工具调用反馈持久化为可见的系统消息
	await expect(page.getByText(/【工具调用】set_outfit/).first()).toBeVisible();
	await expect(page.getByText(/已把上衣更换为「黑色卫衣」/).first()).toBeVisible();

	// 下一轮请求的系统提示带工具执行反馈，让模型确认工具已调用并生效
	await page.getByRole('button', { name: '开发者：查看最近一次完整提示词' }).click();
	await expect(page.locator('.prompt-modal-body').getByText('【工具执行反馈】')).toBeVisible();
	await expect(
		page.locator('.prompt-modal-body').getByText(/set_outfit\(slot=top, item=黑色卫衣\)/)
	).toBeVisible();
});

test('AI 一次回复可包含多段：工具轮次叙事文本与最终回复都保留', async ({ page }) => {
	let call = 0;
	await page.route('**/chat/completions', async (route) => {
		call += 1;
		if (call === 1) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					choices: [
						{
							message: {
								content: '（愣了一下，低头看看自己，脸颊一下子红了）啊！？我……',
								tool_calls: [
									{
										id: 'c1',
										type: 'function',
										function: {
											name: 'set_outfit',
											arguments: JSON.stringify({ slot: '上衣', item: '黑色卫衣' })
										}
									}
								]
							}
						}
					]
				})
			});
		} else {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					choices: [
						{
							message: {
								content: '（手忙脚乱地把衬衫扣子扣好）呼——这下不会着凉了。'
							}
						}
					]
				})
			});
		}
	});

	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#llm-provider').selectOption('deepseek');
	await page.locator('#llm-api-key').fill('test-key');
	await page.locator('#ai-tools-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();

	await page.getByRole('button', { name: /对话/ }).click();
	const snapshotsBefore = await page.locator('.chip').filter({ hasText: '快照' }).textContent();
	await page.getByPlaceholder(/输入消息/).fill('好了快穿上吧，别着凉了');
	await page.getByRole('button', { name: '发送' }).click();

	// 两段 assistant 文本都保留，且工具执行生效
	await expect(
		page.getByText('（愣了一下，低头看看自己，脸颊一下子红了）啊！？我……')
	).toBeVisible();
	await expect(page.getByText('（手忙脚乱地把衬衫扣子扣好）呼——这下不会着凉了。')).toBeVisible();
	await expect(page.locator('.message.assistant')).toHaveCount(2);
	await expect(page.getByText('黑色卫衣').first()).toBeVisible();
	await expect(page.getByText(/【工具调用】set_outfit/).first()).toBeVisible();
	await expect
		.poll(async () => page.locator('.chip').filter({ hasText: '快照' }).textContent())
		.toContain(String((snapshotsBefore ? parseInt(snapshotsBefore, 10) : 1) + 5));
});

test('流式输出：开启后按 SSE 逐块渲染，请求携带 stream: true', async ({ page }) => {
	let requestBody: Record<string, unknown> | null = null;
	await page.route('**/chat/completions', async (route) => {
		requestBody = route.request().postDataJSON();
		const chunks = [
			'data: {"choices":[{"delta":{"role":"assistant","content":"你"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"呀"}}]}\n\n',
			'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n',
			'data: [DONE]\n\n'
		];
		await route.fulfill({
			status: 200,
			contentType: 'text/event-stream',
			body: chunks.join('')
		});
	});

	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#llm-provider').selectOption('deepseek');
	await page.locator('#llm-api-key').fill('test-key');
	await page.locator('#stream-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();

	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.locator('.message.assistant').last()).toContainText('你好呀');
	expect(requestBody).toMatchObject({ stream: true, stream_options: { include_usage: true } });
});

test('启用状态工具后，系统提示注入工具使用说明', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#ai-tools-enabled').check();
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await expect(page.getByText('模型设置已保存')).toBeVisible();

	await page.getByRole('button', { name: /对话/ }).click();
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await page.getByRole('button', { name: '开发者：查看最近一次完整提示词' }).click();
	const promptBody = page.locator('.prompt-modal-body');
	await expect(promptBody.getByText('【工具使用】')).toBeVisible();
	await expect(promptBody.getByText(/set_outfit/)).toBeVisible();
	await expect(promptBody.getByText(/goto_location/)).toBeVisible();
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

test('/help 帮助文本只在聊天里展示，不进入发送给 AI 的提示词', async ({ page }) => {
	await page.goto('/');

	// 开启开发者模式以便查看完整提示词
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await page.getByRole('button', { name: /对话/ }).click();

	// /help 生成一条 system 帮助消息，聊天里可见
	await page.getByPlaceholder(/输入消息/).fill('/help');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/可用 RP 快捷命令/).first()).toBeVisible();

	// 再发一条普通消息触发 LLM 请求
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	// 完整提示词中不应出现帮助文本
	await page.getByRole('button', { name: '开发者：查看最近一次完整提示词' }).click();
	const promptBody = page.locator('.prompt-modal-body');
	await expect(promptBody.getByText('【当前状态】').first()).toBeVisible();
	await expect(promptBody.getByText(/可用 RP 快捷命令/)).toHaveCount(0);
	await expect(promptBody.getByText('早上好')).toBeVisible();
});

test('AI 思考内容可在对话中展开查看', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder(/输入消息/).fill('你现在在想什么？');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	// 演示思考默认收起，点击「思考过程」展开
	const thinking = page.locator('.thinking').last();
	await expect(thinking.getByText('思考过程')).toBeVisible();
	await expect(thinking.locator('pre')).not.toBeVisible();
	await thinking.getByText('思考过程').click();
	await expect(thinking.locator('pre')).toContainText('让我先想想');
});

test('开发者预览：展示输入框内容点击发送将发送给 AI 的完整提示词', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#dev-mode-enabled').check();
	await page.getByRole('button', { name: '保存设置' }).click();
	await page.getByRole('button', { name: /对话/ }).click();

	// 输入但未发送：预览应包含待发送的用户消息与完整系统提示，且不产生聊天记录
	await page.getByPlaceholder(/输入消息/).fill('早上好，我们什么时候去食堂？');
	await page.getByRole('button', { name: '开发者：预览输入框提示词' }).click();
	const previewModal = page.locator('.prompt-modal');
	await expect(previewModal).toBeVisible();
	await expect(previewModal.getByText('【当前状态】').first()).toBeVisible();
	await expect(previewModal.getByText('[user]')).toBeVisible();
	// 待发送消息带当前世界时间标注（贴在角色标签同行），正文保持纯净不掺入时间
	await expect(previewModal.getByText('[user]（周一 08:00）')).toBeVisible();
	await expect(previewModal.getByText('早上好，我们什么时候去食堂？')).toBeVisible();
	await expect(page.locator('.message.user')).toHaveCount(0);
	await previewModal.getByRole('button', { name: '关闭' }).click();

	// 斜杠命令预览：提示不会调用 LLM
	await page.getByPlaceholder(/输入消息/).fill('/help');
	await page.getByRole('button', { name: '开发者：预览输入框提示词' }).click();
	await expect(page.locator('.prompt-modal').getByText(/将以斜杠命令执行/)).toBeVisible();
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

test('AI 地点：按古代世界观生成、勾选后一键导入', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /地点/ }).click();
	await page.getByRole('button', { name: 'AI地点' }).click();
	const modal = page.locator('.ai-modal');
	await expect(modal).toBeVisible();

	await page.locator('#ai-worldview').selectOption('ancient');
	await page.locator('#ai-requirements').fill('书院学园');
	await page.getByRole('button', { name: '生成' }).click();

	// 审查通过后展示生成的条目
	await expect(modal.getByText(/书院 > 讲堂/)).toBeVisible();
	await expect(modal.getByText(/集市 > 药铺/)).toBeVisible();

	// 取消一项后一键导入其余
	await modal.locator('.ai-item').filter({ hasText: '马厩' }).locator('input').uncheck();
	await page.getByRole('button', { name: /一键导入/ }).click();
	await expect(modal).not.toBeVisible();
	await expect(
		page.locator('#current-place option').filter({ hasText: '书院 > 讲堂' })
	).toHaveCount(1);
	// 地点库属于世界配置：导入不生成快照
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('AI 衣物：性别选项影响生成并批量导入', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /衣柜/ }).click();
	await page.getByRole('button', { name: 'AI衣物' }).click();
	const modal = page.locator('.ai-modal');
	await expect(modal).toBeVisible();
	await expect(page.locator('#ai-gender')).toBeVisible();

	await page.locator('#ai-gender').selectOption('男');
	await page.locator('#ai-requirements').fill('日常便服');
	await page.getByRole('button', { name: '生成' }).click();

	await expect(modal.getByText(/白衬衫/)).toBeVisible();
	await expect(modal.getByText(/白色连衣裙/)).toHaveCount(0);
	await page.getByRole('button', { name: /一键导入/ }).click();
	await expect(modal).not.toBeVisible();
	await expect(page.locator('#wardrobe-top option[value="白衬衫"]')).toHaveCount(1);
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('AI 条目：生成日程并批量导入', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();
	await page.getByRole('button', { name: 'AI条目' }).click();
	const modal = page.locator('.ai-modal');
	await page.locator('#ai-requirements').fill('一周课程安排');
	await page.getByRole('button', { name: '生成' }).click();

	await expect(modal.getByText(/武术课/)).toBeVisible();
	await page.getByRole('button', { name: /一键导入/ }).click();
	await expect(modal).not.toBeVisible();
	// 原 3 条 + 导入 4 条
	await expect(page.locator('.list-row')).toHaveCount(7);
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('地点库支持拖拽排序', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /地点/ }).click();
	const schoolGroup = page
		.locator('div.group')
		.filter({ has: page.locator('.group-name', { hasText: '学校' }) });
	const rows = schoolGroup.locator('.list-row');
	// 默认不可拖拽，开启「编辑排序」后可拖
	await expect(rows.first()).toHaveAttribute('draggable', 'false');
	await page.getByRole('button', { name: '编辑排序' }).click();
	await expect(rows.first()).toHaveAttribute('draggable', 'true');
	await expect(rows.locator('input[placeholder="地点名"]').first()).toHaveValue('学院正门');

	// 把第一项拖到第三项 → 教室 2-B 移到最前
	await rows.nth(0).dragTo(rows.nth(2));
	await expect(rows.locator('input[placeholder="地点名"]').first()).toHaveValue('教室 2-B');
	// 排序属于配置编辑：不生成快照
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('衣柜支持拖拽排序', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /衣柜/ }).click();
	const casualGroup = page
		.locator('div.group')
		.filter({ has: page.locator('.group-name', { hasText: '常服' }) });
	const rows = casualGroup.locator('.list-row');
	await expect(rows.first()).toHaveAttribute('draggable', 'false');
	await page.getByRole('button', { name: '编辑排序' }).click();
	await expect(rows.first()).toHaveAttribute('draggable', 'true');
	await expect(rows.locator('input[placeholder="衣物名"]').first()).toHaveValue('白色衬衫');

	// 把第一件拖到第三件 → 深蓝百褶裙移到最前
	await rows.nth(0).dragTo(rows.nth(2));
	await expect(rows.locator('input[placeholder="衣物名"]').first()).toHaveValue('深蓝百褶裙');
	await expect(page.locator('.chip').filter({ hasText: '快照' })).toHaveText(/1 快照/);
});

test('日程表按时间自动排序', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();

	// 初始顺序：晨会 08:00、国文课 09:00、午休 12:00
	await expect(page.locator('.list-row').nth(0).locator('input[type="time"]').first()).toHaveValue(
		'08:00'
	);
	await expect(page.locator('.list-row').nth(2).locator('input[type="time"]').first()).toHaveValue(
		'12:00'
	);

	// 新增 11:00 的条目 → 自动插入到国文课与午休之间
	await page.locator('#entry-title').fill('午读');
	await page.locator('#entry-start').fill('11:00');
	await page.locator('#entry-end').fill('11:30');
	await page.getByRole('button', { name: '添加条目' }).click();
	await expect(page.locator('.list-row')).toHaveCount(4);
	await expect(page.locator('.list-row').nth(2).locator('input[type="time"]').first()).toHaveValue(
		'11:00'
	);

	// 修改午读时间到 13:00-13:30 → 自动移到午休之后
	const readingRow = page.locator('.list-row').nth(2);
	await readingRow
		.locator('input[type="time"]')
		.nth(1)
		.evaluate((el) => {
			(el as HTMLInputElement).value = '13:30';
			el.dispatchEvent(new Event('change', { bubbles: true }));
		});
	await readingRow
		.locator('input[type="time"]')
		.first()
		.evaluate((el) => {
			(el as HTMLInputElement).value = '13:00';
			el.dispatchEvent(new Event('change', { bubbles: true }));
		});
	await expect(page.locator('.list-row').nth(3).locator('input[type="time"]').first()).toHaveValue(
		'13:00'
	);
});

test('删除地点/衣柜/日程需确认：取消不删除，确认才删除', async ({ page }) => {
	await page.goto('/');

	// 地点：取消确认 → 条目保留
	await page.getByRole('button', { name: /地点/ }).click();
	const schoolGroup = page
		.locator('div.group')
		.filter({ has: page.locator('.group-name', { hasText: '学校' }) });
	let dialog = page.waitForEvent('dialog');
	const click1 = schoolGroup.locator('button[aria-label="删除地点"]').first().click();
	await (await dialog).dismiss();
	await click1;
	await expect(schoolGroup.locator('input[placeholder="地点名"]').first()).toHaveValue('学院正门');

	// 地点：确认 → 条目删除
	dialog = page.waitForEvent('dialog');
	const click2 = schoolGroup.locator('button[aria-label="删除地点"]').first().click();
	await (await dialog).accept();
	await click2;
	await expect(schoolGroup.locator('input[placeholder="地点名"]').first()).toHaveValue('教室 2-B');

	// 衣柜：取消确认 → 条目保留
	await page.getByRole('button', { name: /衣柜/ }).click();
	const casualGroup = page
		.locator('div.group')
		.filter({ has: page.locator('.group-name', { hasText: '常服' }) });
	dialog = page.waitForEvent('dialog');
	const click3 = casualGroup.locator('button[aria-label="删除衣物"]').first().click();
	await (await dialog).dismiss();
	await click3;
	await expect(casualGroup.locator('input[placeholder="衣物名"]').first()).toHaveValue('白色衬衫');

	// 日程：取消确认 → 条目保留
	await page.getByRole('button', { name: /日程/ }).click();
	dialog = page.waitForEvent('dialog');
	const click4 = page.locator('.list-row button[aria-label="删除条目"]').first().click();
	await (await dialog).dismiss();
	await click4;
	await expect(page.locator('.list-row')).toHaveCount(3);
});

test('地点库导出与导入（JSON 模板）', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /地点/ }).click();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: '导出', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/地点库-\d{8}-\d{4}\.json/);

	// 导入模板：新增地点并去重合并
	const template = JSON.stringify({
		kind: 'locations',
		version: 1,
		items: [
			{ category: '测试', name: '测试地点', description: '来自模板' },
			{ category: '学校', name: '食堂', description: '已存在，应去重' }
		]
	});
	await page.locator('input[type="file"]').setInputFiles({
		name: 'places.json',
		mimeType: 'application/json',
		buffer: Buffer.from(template, 'utf8')
	});
	await expect(page.getByText(/已导入 1 项到地点库/)).toBeVisible();
	await expect(
		page.locator('#current-place option').filter({ hasText: '测试 > 测试地点' })
	).toHaveCount(1);
});

test('衣柜导出与导入（JSON 模板）', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /衣柜/ }).click();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: '导出', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/衣柜-\d{8}-\d{4}\.json/);

	const template = JSON.stringify({
		kind: 'wardrobe',
		version: 1,
		items: [{ category: '测试', kind: 'top', name: '测试衬衫', description: '来自模板' }]
	});
	await page.locator('input[type="file"]').setInputFiles({
		name: 'wardrobe.json',
		mimeType: 'application/json',
		buffer: Buffer.from(template, 'utf8')
	});
	await expect(page.getByText(/已导入 1 项到衣柜/)).toBeVisible();
	await expect(page.locator('#wardrobe-top option[value="测试衬衫"]')).toHaveCount(1);
});

test('日程表导出与导入（JSON 模板）', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /日程/ }).click();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: '导出', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/日程表-\d{8}-\d{4}\.json/);

	const template = JSON.stringify({
		kind: 'schedule',
		version: 1,
		items: [{ day: 3, title: '夜跑', start: '23:00', end: '23:30' }]
	});
	await page.locator('input[type="file"]').setInputFiles({
		name: 'schedule.json',
		mimeType: 'application/json',
		buffer: Buffer.from(template, 'utf8')
	});
	await expect(page.getByText(/已导入 1 项到日程表/)).toBeVisible();
	await expect(page.locator('.list-row').last().locator('input[type="time"]').first()).toHaveValue(
		'23:00'
	);
});

test('工作区导出与导入（.cbox 恢复对话与配置）', async ({ page }) => {
	await page.goto('/');
	// 造数据：一条消息 + 一个新地点
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();
	await page.getByRole('button', { name: /地点/ }).click();
	await page.locator('#new-place-name').fill('备份地点');
	await page.locator('#new-place-desc').fill('来自备份');
	await page.getByRole('button', { name: '添加地点' }).click();

	// 导出 .cbox
	await page.getByRole('button', { name: /设置/ }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: '导出工作区' }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^cosbox-\d{8}-\d{4}\.cbox$/);
	const path = await download.path();

	// 切回根清空会话，再导入工作区恢复
	await page.getByRole('button', { name: /版本/ }).click();
	await page.getByRole('button', { name: '展开' }).first().click();
	await page
		.locator('.branch-chain .version-row')
		.locator('button', { hasText: '切换' })
		.last()
		.click();
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText(/演示模式回应/)).not.toBeVisible();

	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('input[type="file"][accept=".cbox"]').setInputFiles(path!);
	await expect(page.getByText('工作区已导入')).toBeVisible();
	await page.getByRole('button', { name: /对话/ }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();
});

test('对话后侧栏显示上下文用量、费用估算与压缩状态', async ({ page }) => {
	await page.goto('/');
	await page.getByPlaceholder(/输入消息/).fill('早上好');
	await page.getByRole('button', { name: '发送' }).click();
	await expect(page.getByText(/演示模式回应/)).toBeVisible();

	await expect(page.getByText('上下文用量（估算）')).toBeVisible();
	await expect(page.getByText('输入 / 已缓存')).toBeVisible();
	// 演示模式默认模型不在本地定价表 → 费用显示「—」
	const costRow = page.locator('.ctx-row').filter({ hasText: '费用（USD）' });
	await expect(costRow).toContainText('—');

	// 默认未压缩（对话很短），侧栏显示完整发送；手动压缩给出提示且不动聊天记录
	await expect(page.getByText(/完整发送全部历史/).first()).toBeVisible();
	await page.getByRole('button', { name: '立即压缩' }).click();
	await expect(page.getByText('对话较短，暂无需压缩')).toBeVisible();
	await expect(page.locator('.message.user')).toHaveCount(1);
	await expect(page.locator('.message.assistant')).toHaveCount(1);
});

test('设置：获取模型列表自动填充上下文窗口，连接测试验证 API', async ({ page }) => {
	await page.route('**/models', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: [{ id: 'mock-model-a', context_window: 64000 }, { id: 'mock-model-b' }]
			})
		})
	);
	await page.goto('/');
	await page.getByRole('button', { name: /设置/ }).click();
	await page.locator('#llm-provider').selectOption('deepseek');

	await page.getByRole('button', { name: '获取模型列表' }).click();
	await expect(page.getByText(/已获取 2 个模型/)).toBeVisible();
	// 点击模型输入框弹出服务端模型下拉，点选后自动填充上下文窗口
	await page.locator('#llm-model').click();
	const modelItem = page.locator('.combobox-item').filter({ hasText: 'mock-model-a' });
	await expect(modelItem).toBeVisible();
	await expect(page.locator('.combobox-item').filter({ hasText: 'deepseek-v4-flash' })).toHaveCount(
		0
	);
	await modelItem.click();
	await expect(page.locator('#llm-model')).toHaveValue('mock-model-a');
	await expect(page.getByText('上下文窗口：64000 tokens')).toBeVisible();

	await page.getByRole('button', { name: '连接测试' }).first().click();
	await expect(page.getByText('连接成功，API 可用')).toBeVisible();
});
