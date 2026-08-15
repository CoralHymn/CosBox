import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const seed = Number(process.argv[3] || 0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

if (seed > 0) {
	await page.addInitScript((count) => {
		return new Promise((resolve, reject) => {
			const open = indexedDB.open('cosbox', 2);
			open.onupgradeneeded = () => {
				const db = open.result;
				if (!db.objectStoreNames.contains('snapshots')) {
					const s = db.createObjectStore('snapshots', { keyPath: 'id' });
					s.createIndex('parentId', 'parentId');
					s.createIndex('timestamp', 'timestamp');
					s.createIndex('[parentId+timestamp]', ['parentId', 'timestamp']);
				}
				if (!db.objectStoreNames.contains('worldInfo')) {
					db.createObjectStore('worldInfo', { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains('memories')) {
					const m = db.createObjectStore('memories', { keyPath: 'id' });
					m.createIndex('pinned', 'pinned');
					m.createIndex('category', 'category');
				}
				if (!db.objectStoreNames.contains('kv')) {
					db.createObjectStore('kv', { keyPath: 'key' });
				}
			};
			open.onsuccess = () => {
				const db = open.result;
				const tx = db.transaction(['snapshots', 'worldInfo', 'memories', 'kv'], 'readwrite');
				const snaps = tx.objectStore('snapshots');
				snaps.put({ id: 'root', timestamp: 1, parentId: null, metadata: { type: 'root', desc: '初始状态' }, delta: null });
				let prev = 'root';
				for (let i = 1; i <= count; i += 1) {
					snaps.put({
						id: `n${i}`,
						timestamp: i + 1,
						parentId: prev,
						metadata: { type: i % 2 === 0 ? 'state' : 'message', desc: '数据' },
						delta:
							i % 2 === 0
								? { kind: 'state', patch: {} }
								: { kind: 'message', role: 'user', content: `消息 ${i}，这是一段用于模拟真实体积的对话内容，包含一些比较长的文本信息`.repeat(2) }
					});
					prev = `n${i}`;
				}
				tx.objectStore('worldInfo').put({ id: 'w1', keys: ['x'], content: 'c', enabled: true, priority: 1 });
				tx.objectStore('memories').put({
					id: 'm1', content: 'c', category: '其他', keywords: [], importance: 3, pinned: false,
					source: 'manual', createdAt: 1, updatedAt: 1, lastUsedAt: 0, useCount: 0
				});
				tx.objectStore('kv').put({ key: 'settings.profile', value: { name: '老角色', systemPrompt: null } });
				tx.objectStore('kv').put({ key: 'settings.developer', value: true });
				tx.objectStore('kv').put({ key: 'lastHeadId', value: `n${count}` });
				tx.objectStore('kv').put({ key: 'settings.llm', value: { provider: 'demo' } });
				tx.oncomplete = () => { db.close(); resolve(undefined); };
				tx.onerror = () => reject(tx.error);
			};
			open.onerror = () => reject(open.error);
		});
	}, seed);
}

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
const t1 = Date.now();
await page.locator('.ws-enter').first().waitFor({ state: 'visible', timeout: 30000 });
const t2 = Date.now();
let t3 = -1;
let chatFailed = false;
try {
	await page.locator('.ws-enter').filter({ hasText: '默认工作区' }).click();
	await page.getByPlaceholder(/输入消息/).first().waitFor({ state: 'visible', timeout: 30000 });
	t3 = Date.now();
} catch {
	t3 = Date.now();
	chatFailed = true;
}
console.log(
	`[${url}] seed=${seed}: domcontentloaded=${t1 - t0}ms | landing-visible=${t2 - t1}ms | enter→chat=${t3 - t2}ms | total=${t3 - t0}ms${chatFailed ? ' (CHAT TIMEOUT)' : ''}`
);
console.log('page errors:', errors.length === 0 ? '(none)' : errors.join(' | '));
await browser.close();
