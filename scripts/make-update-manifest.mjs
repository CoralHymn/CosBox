#!/usr/bin/env node
/**
 * 生成 Tauri updater 更新清单（静态 JSON），供 cosbox.benng.cc 托管。
 *
 * 用法：
 *   node scripts/make-update-manifest.mjs \
 *     --version 0.0.2 \
 *     --notes "修复了若干问题" \
 *     --file src-tauri/target/release/bundle/nsis/CosBox_0.0.2_x64-setup.exe \
 *     --base-url https://cosbox.benng.cc/releases
 *
 * 说明：
 *   - 依赖构建时自动生成的 <file>.sig 签名文件（构建前设置
 *     TAURI_SIGNING_PRIVATE_KEY，且 tauri.conf.json 中 createUpdaterArtifacts 为 true）。
 *   - 清单输出到 stdout；请保存到
 *     https://cosbox.benng.cc/updates/windows-x86_64/latest.json
 *     （即 tauri.conf.json 里 updater.endpoints 指向的路径）。
 *   - 安装包本体请上传到 --base-url 对应目录，文件名保持与 --file 一致。
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
function arg(name) {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
}

const version = arg('version');
const notes = arg('notes') ?? '';
const file = arg('file');
const baseUrl = arg('base-url') ?? 'https://cosbox.benng.cc/releases';
const target = arg('target') ?? 'windows-x86_64';

if (!version || !file) {
	console.error(
		'用法：node scripts/make-update-manifest.mjs --version <semver> --file <installer> [--notes <text>] [--base-url <url>] [--target <os-arch>]'
	);
	process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`版本号必须是 SemVer（如 0.0.2）：${version}`);
	process.exit(1);
}

const sigPath = `${file}.sig`;
if (!existsSync(sigPath)) {
	console.error(
		`找不到签名文件：${sigPath}\n请先设置 TAURI_SIGNING_PRIVATE_KEY 后执行 npm run tauri build（会生成 .sig）。`
	);
	process.exit(1);
}

const signature = readFileSync(sigPath, 'utf8').trim();
const manifest = {
	version,
	...(notes !== '' ? { notes } : {}),
	pub_date: new Date().toISOString(),
	platforms: {
		[target]: {
			signature,
			url: `${baseUrl}/${basename(file)}`
		}
	}
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
