import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from './index.mjs';

/** 启动一个带独立数据目录的测试服务器；返回 base 地址与密钥。 */
async function startServer(t) {
	const dataDir = await mkdtemp(join(tmpdir(), 'cosbox-sync-test-'));
	const key = 'ab'.repeat(32);
	const { handle } = createHandler({ dataDir, loadKey: async () => key });
	const server = createServer(handle);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	t.after(async () => {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
		await rm(dataDir, { recursive: true, force: true });
	});
	return { base: `http://127.0.0.1:${port}`, key, dataDir };
}

/** 发起 JSON 请求；返回 { status, body }。 */
async function request(base, method, path, { key, body } = {}) {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			...(key !== undefined ? { Authorization: `Bearer ${key}` } : {}),
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	return { status: res.status, body: await res.json() };
}

test('健康检查无需鉴权', async (t) => {
	const { base } = await startServer(t);
	const res = await request(base, 'GET', '/api/health');
	assert.equal(res.status, 200);
	assert.equal(res.body.ok, true);
	assert.equal(res.body.version, 2);
});

test('多工作区分槽：各槽独立读写，/api/workspace 是 default 槽别名', async (t) => {
	const { base, key } = await startServer(t);
	// 空槽返回 null。
	assert.equal((await request(base, 'GET', '/api/workspace/ws-a', { key })).body, null);

	const dataA = { profile: { name: 'A' }, snapshots: [] };
	await request(base, 'PUT', '/api/workspace/ws-a', { key, body: { data: dataA, updatedAt: 1 } });
	const dataB = { profile: { name: 'B' }, snapshots: [] };
	await request(base, 'PUT', '/api/workspace/ws-b', { key, body: { data: dataB, updatedAt: 2 } });

	const gotA = await request(base, 'GET', '/api/workspace/ws-a', { key });
	assert.equal(gotA.status, 200);
	assert.equal(gotA.body.data.profile.name, 'A');
	assert.equal(gotA.body.updatedAt, 1);
	assert.equal(
		(await request(base, 'GET', '/api/workspace/ws-b', { key })).body.data.profile.name,
		'B'
	);
	// 覆盖写入只影响本槽。
	await request(base, 'PUT', '/api/workspace/ws-a', { key, body: { data: dataB, updatedAt: 3 } });
	assert.equal((await request(base, 'GET', '/api/workspace/ws-a', { key })).body.updatedAt, 3);
	assert.equal((await request(base, 'GET', '/api/workspace/ws-b', { key })).body.updatedAt, 2);

	// default 别名。
	await request(base, 'PUT', '/api/workspace', { key, body: { data: dataA, updatedAt: 4 } });
	assert.equal((await request(base, 'GET', '/api/workspace', { key })).body.updatedAt, 4);
	assert.equal((await request(base, 'GET', '/api/workspace/default', { key })).body.updatedAt, 4);
});

test('鉴权：无密钥或错误密钥返回 401', async (t) => {
	const { base, key } = await startServer(t);
	assert.equal((await request(base, 'GET', '/api/workspace/ws-a')).status, 401);
	assert.equal((await request(base, 'GET', '/api/workspace/ws-a', { key: 'wrong' })).status, 401);
	assert.equal((await request(base, 'GET', '/api/workspace/ws-a', { key })).status, 200);
});

test('工作区 id 校验：非法 id 返回 400', async (t) => {
	const { base, key } = await startServer(t);
	assert.equal((await request(base, 'GET', '/api/workspace/a%2Fb', { key })).status, 400);
	// 空 id（尾斜杠）同样非法。
	assert.equal((await request(base, 'GET', '/api/workspace/', { key })).status, 400);
	assert.equal((await request(base, 'GET', '/api/unknown', { key })).status, 404);
});

test('PUT 校验：非法 JSON 与缺少字段返回 400', async (t) => {
	const { base, key } = await startServer(t);
	const res = await fetch(`${base}/api/workspace/ws-a`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: 'not-json'
	});
	assert.equal(res.status, 400);
	assert.equal(
		(await request(base, 'PUT', '/api/workspace/ws-a', { key, body: { data: {} } })).status,
		400
	);
	assert.equal(
		(await request(base, 'PUT', '/api/workspace/ws-a', { key, body: { data: {}, updatedAt: 1 } }))
			.status,
		200
	);
});

test('不支持的请求方法返回 405', async (t) => {
	const { base, key } = await startServer(t);
	assert.equal((await request(base, 'POST', '/api/workspace/ws-a', { key })).status, 405);
});

test('v1 单槽文件迁移进 default 槽', async (t) => {
	const { base, key, dataDir } = await startServer(t);
	const legacy = { data: { profile: { name: '旧存档' } }, updatedAt: 100 };
	await writeFile(join(dataDir, 'workspace.json'), JSON.stringify(legacy));
	const res = await request(base, 'GET', '/api/workspace/default', { key });
	assert.equal(res.status, 200);
	assert.equal(res.body.data.profile.name, '旧存档');
	// 迁移后写回 v2 多槽文件。
	const migrated = JSON.parse(await readFile(join(dataDir, 'workspaces.json'), 'utf8'));
	assert.equal(migrated.version, 2);
	assert.equal(migrated.slots.default.updatedAt, 100);
});

test('槽位上限：第 65 个新工作区被拒绝，既有槽位可继续覆盖', async (t) => {
	const { base, key } = await startServer(t);
	for (let i = 0; i < 64; i += 1) {
		const res = await request(base, 'PUT', `/api/workspace/ws-${i}`, {
			key,
			body: { data: { i }, updatedAt: i }
		});
		assert.equal(res.status, 200);
	}
	const overflow = await request(base, 'PUT', '/api/workspace/ws-64', {
		key,
		body: { data: {}, updatedAt: 1 }
	});
	assert.equal(overflow.status, 400);
	// 既有槽位覆盖写入不受限。
	const update = await request(base, 'PUT', '/api/workspace/ws-0', {
		key,
		body: { data: { i: 0 }, updatedAt: 999 }
	});
	assert.equal(update.status, 200);
});
