#!/usr/bin/env node
/**
 * CosBox 数据同步服务器（零依赖，Node >= 18）。
 *
 * - 只同步 CosBox 工作区数据（快照/世界配置/世界书/角色档案/开发者开关/长期记忆），
 *   不含模型配置与 API Key。
 * - 鉴权：Bearer 密钥（32 字节随机十六进制），时序安全比较；
 *   连续鉴权失败会临时限流。
 * - 多工作区：按 workspaceId 分槽存储（D108），每个工作区独立同步互不覆盖；
 *   旧客户端不带 id 的 `/api/workspace` 落到 `default` 槽（向后兼容）。
 * - 持久化：`data/workspaces.json` 原子写入；首次运行自动生成 `data/key.txt`。
 *
 * 环境变量：
 *   COSBOX_SYNC_PORT 监听端口（默认 8787）
 *   COSBOX_SYNC_DATA 数据目录（默认 <脚本目录>/data）
 *   COSBOX_SYNC_KEY  显式指定密钥（默认读取/生成 data/key.txt）
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.COSBOX_SYNC_PORT || 8787);
const DATA_DIR = process.env.COSBOX_SYNC_DATA || join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'workspaces.json');
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 20;
/** 槽位上限：防止无限制膨胀。 */
const MAX_SLOTS = 64;
/** 工作区 id 白名单（URL 路径段，防止路径滥用）。 */
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 从磁盘读取或生成密钥（生成时打印一次）。 */
async function loadKeyFromDisk(keyFile) {
	const dir = dirname(keyFile);
	if (existsSync(keyFile)) {
		return (await readFile(keyFile, 'utf8')).trim();
	}
	await mkdir(dir, { recursive: true });
	const key = randomBytes(32).toString('hex');
	await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
	console.log(`首次运行：已生成同步密钥并写入 ${keyFile}`);
	return key;
}

/**
 * 构建请求处理器（测试可注入 dataDir 与 loadKey；默认走环境变量与磁盘）。
 * 返回 `{ handle, dataDir }`：handle 是 (req, res) => Promise<void> 的 http 处理器。
 */
export function createHandler(options = {}) {
	const dataDir = options.dataDir || DATA_DIR;
	const dataFile = join(dataDir, 'workspaces.json');
	const legacyDataFile = join(dataDir, 'workspace.json');
	const keyFile = join(dataDir, 'key.txt');
	const loadKey = options.loadKey || (() => loadKeyFromDisk(keyFile));

	let cachedKey = null;
	let failedAttempts = [];

	/** 读取或生成密钥。 */
	async function getKey() {
		if (cachedKey !== null) {
			return cachedKey;
		}
		const envKey = process.env.COSBOX_SYNC_KEY;
		if (envKey !== undefined && envKey.trim() !== '') {
			cachedKey = envKey.trim();
			return cachedKey;
		}
		cachedKey = await loadKey();
		return cachedKey;
	}

	/** 时序安全比较（长度不同直接失败，不泄漏长度信息）。 */
	function safeEqual(a, b) {
		const ba = Buffer.from(a);
		const bb = Buffer.from(b);
		if (ba.length !== bb.length) {
			return false;
		}
		return timingSafeEqual(ba, bb);
	}

	function isRateLimited() {
		const now = Date.now();
		failedAttempts = failedAttempts.filter((t) => now - t < AUTH_WINDOW_MS);
		return failedAttempts.length >= AUTH_MAX_FAILURES;
	}

	function recordFailure() {
		failedAttempts.push(Date.now());
	}

	function send(res, status, body) {
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Cache-Control': 'no-store'
		});
		res.end(JSON.stringify(body));
	}

	/** 读取请求体（限制大小）。 */
	async function readBody(req) {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				throw new Error('请求体过大');
			}
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}

	/** 校验 Bearer 密钥；失败已发送 401/429 并返回 null。 */
	async function requireAuth(req, res) {
		if (isRateLimited()) {
			send(res, 429, { error: '鉴权失败次数过多，请稍后再试' });
			return null;
		}
		const header = req.headers.authorization || '';
		const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
		const key = await getKey();
		if (token === '' || !safeEqual(token, key)) {
			recordFailure();
			send(res, 401, { error: '密钥无效' });
			return null;
		}
		return key;
	}

	/** 原子写入：先写临时文件再重命名，避免半截文件。 */
	async function saveSlots(slots) {
		await mkdir(dataDir, { recursive: true });
		const tmp = `${dataFile}.tmp`;
		await writeFile(tmp, JSON.stringify({ version: 2, slots }));
		await rename(tmp, dataFile);
	}

	/**
	 * 加载全部槽位：优先读 v2 多槽文件；文件缺失但存在 v1 单槽文件时，
	 * 把单槽载荷迁移进 default 槽并写回 v2 文件。
	 */
	async function loadSlots() {
		try {
			const raw = await readFile(dataFile, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed !== null && typeof parsed === 'object' && parsed.slots !== undefined) {
				return parsed.slots;
			}
			return {};
		} catch {
			// 数据文件缺失或损坏：尝试迁移 v1 单槽文件。
		}
		try {
			const legacy = JSON.parse(await readFile(legacyDataFile, 'utf8'));
			if (
				legacy !== null &&
				typeof legacy === 'object' &&
				typeof legacy.updatedAt === 'number' &&
				legacy.data !== undefined
			) {
				const slots = { default: { data: legacy.data, updatedAt: legacy.updatedAt } };
				await saveSlots(slots);
				console.log('已把旧版单槽数据迁移进 default 工作区槽位');
				return slots;
			}
		} catch {
			// 旧文件不存在或损坏：忽略。
		}
		return {};
	}

	async function handle(req, res) {
		const url = new URL(req.url, 'http://localhost');
		const path = url.pathname;

		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
				'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				'Access-Control-Max-Age': 86400
			});
			res.end();
			return;
		}

		try {
			if (path === '/api/health' && req.method === 'GET') {
				send(res, 200, { ok: true, service: 'cosbox-sync', version: 2 });
				return;
			}

			let workspaceId = 'default';
			if (path.startsWith('/api/workspace/')) {
				workspaceId = decodeURIComponent(path.slice('/api/workspace/'.length));
				if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
					send(res, 400, { error: '工作区 id 非法' });
					return;
				}
			} else if (path !== '/api/workspace') {
				send(res, 404, { error: 'Not Found' });
				return;
			}

			const auth = await requireAuth(req, res);
			if (auth === null) {
				return;
			}

			if (req.method === 'GET') {
				const slots = await loadSlots();
				send(res, 200, slots[workspaceId] ?? null);
				return;
			}
			if (req.method === 'PUT') {
				const raw = await readBody(req);
				let payload;
				try {
					payload = JSON.parse(raw.toString('utf8'));
				} catch {
					send(res, 400, { error: '请求体不是合法 JSON' });
					return;
				}
				if (
					payload === null ||
					typeof payload !== 'object' ||
					typeof payload.updatedAt !== 'number' ||
					payload.data === undefined
				) {
					send(res, 400, { error: '缺少 data 或 updatedAt 字段' });
					return;
				}
				const slots = await loadSlots();
				if (slots[workspaceId] === undefined && Object.keys(slots).length >= MAX_SLOTS) {
					send(res, 400, { error: '工作区槽位已满' });
					return;
				}
				slots[workspaceId] = { data: payload.data, updatedAt: payload.updatedAt };
				await saveSlots(slots);
				send(res, 200, { ok: true, updatedAt: payload.updatedAt });
				return;
			}
			send(res, 405, { error: '不支持的请求方法' });
		} catch (err) {
			const message =
				err instanceof Error && err.message === '请求体过大' ? '请求体过大' : '服务器内部错误';
			send(res, err instanceof Error && err.message === '请求体过大' ? 413 : 500, {
				error: message
			});
		}
	}

	return { handle, dataDir };
}

/** 直接以脚本运行（而非被测试 import）时启动监听。 */
const isMain =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const server = createServer(createHandler().handle);
	server.listen(PORT, '0.0.0.0', () => {
		console.log(`CosBox 同步服务已启动：http://0.0.0.0:${PORT}`);
		console.log(`数据目录：${DATA_DIR}`);
		console.log(`数据文件：${DATA_FILE}（多工作区分槽）`);
	});
}
