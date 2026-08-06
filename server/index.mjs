#!/usr/bin/env node
/**
 * CosBox 数据同步服务器（零依赖，Node >= 18）。
 *
 * - 只同步 CosBox 工作区数据（快照/世界配置/世界书/角色档案/开发者开关），
 *   不含模型配置与 API Key。
 * - 鉴权：Bearer 密钥（32 字节随机十六进制），时序安全比较；
 *   连续鉴权失败会临时限流。
 * - 持久化：`data/workspace.json` 原子写入；首次运行自动生成 `data/key.txt`。
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.COSBOX_SYNC_PORT || 8787);
const DATA_DIR = process.env.COSBOX_SYNC_DATA || join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'workspace.json');
const KEY_FILE = join(DATA_DIR, 'key.txt');
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILURES = 20;

let cachedKey = null;
let failedAttempts = [];

/** 读取或生成密钥（生成时打印一次，便于安装脚本回显）。 */
async function loadKey() {
	if (cachedKey !== null) {
		return cachedKey;
	}
	const envKey = process.env.COSBOX_SYNC_KEY;
	if (envKey !== undefined && envKey.trim() !== '') {
		cachedKey = envKey.trim();
		return cachedKey;
	}
	if (existsSync(KEY_FILE)) {
		cachedKey = (await readFile(KEY_FILE, 'utf8')).trim();
		return cachedKey;
	}
	await mkdir(DATA_DIR, { recursive: true });
	cachedKey = randomBytes(32).toString('hex');
	await writeFile(KEY_FILE, `${cachedKey}\n`, { mode: 0o600 });
	console.log(`首次运行：已生成同步密钥并写入 ${KEY_FILE}`);
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
	const key = await loadKey();
	if (token === '' || !safeEqual(token, key)) {
		recordFailure();
		send(res, 401, { error: '密钥无效' });
		return null;
	}
	return key;
}

async function loadWorkspace() {
	try {
		return JSON.parse(await readFile(DATA_FILE, 'utf8'));
	} catch {
		return null;
	}
}

/** 原子写入：先写临时文件再重命名，避免半截文件。 */
async function saveWorkspace(payload) {
	await mkdir(DATA_DIR, { recursive: true });
	const tmp = `${DATA_FILE}.tmp`;
	await writeFile(tmp, JSON.stringify(payload));
	await rename(tmp, DATA_FILE);
}

const server = createServer(async (req, res) => {
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
			send(res, 200, { ok: true, service: 'cosbox-sync', version: 1 });
			return;
		}

		if (path === '/api/workspace') {
			const auth = await requireAuth(req, res);
			if (auth === null) {
				return;
			}
			if (req.method === 'GET') {
				const data = await loadWorkspace();
				send(res, 200, data ?? null);
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
				await saveWorkspace({ data: payload.data, updatedAt: payload.updatedAt });
				send(res, 200, { ok: true, updatedAt: payload.updatedAt });
				return;
			}
			send(res, 405, { error: '不支持的请求方法' });
			return;
		}

		send(res, 404, { error: 'Not Found' });
	} catch (err) {
		const message =
			err instanceof Error && err.message === '请求体过大' ? '请求体过大' : '服务器内部错误';
		send(res, err instanceof Error && err.message === '请求体过大' ? 413 : 500, { error: message });
	}
});

server.listen(PORT, '0.0.0.0', async () => {
	const key = await loadKey();
	console.log(`CosBox 同步服务已启动：http://0.0.0.0:${PORT}`);
	console.log(`同步密钥：${key}`);
	console.log(`数据文件：${DATA_FILE}`);
});
