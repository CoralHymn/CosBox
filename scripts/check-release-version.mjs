#!/usr/bin/env node
/**
 * 校验发布 tag 与四处版本号一致（见 PACKAGING.md「版本号」）。
 *
 * 用法：
 *   node scripts/check-release-version.mjs --tag v0.0.4
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;

if (!tag) {
	console.error('用法：node scripts/check-release-version.mjs --tag v0.0.4');
	process.exit(1);
}

const expected = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
	console.error(
		`tag 必须形如 v1.2.3（当前：${tag}）。预发布后缀（如 -beta.1）会导致 Windows 打包失败。`
	);
	process.exit(1);
}

const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(
	/^version\s*=\s*"([^"]+)"/m
)?.[1];
const updaterVersion = readFileSync('src/lib/platform/updater.ts', 'utf8').match(
	/APP_VERSION\s*=\s*'([^']+)'/
)?.[1];

const locations = [
	['package.json', pkgVersion],
	['src-tauri/Cargo.toml', cargoVersion],
	['src-tauri/tauri.conf.json', tauriVersion],
	['src/lib/platform/updater.ts', updaterVersion]
];

let failed = false;
for (const [file, version] of locations) {
	if (version === expected) {
		console.log(`[OK]   ${file} = ${version}`);
	} else {
		console.error(`[DIFF] ${file} = ${version ?? '未找到'}（期望 ${expected}）`);
		failed = true;
	}
}

if (failed) {
	console.error(`\n版本号不一致：先把四处版本都改成 ${expected}，再打 tag（见 PACKAGING.md）。`);
	process.exit(1);
}

console.log(`\n[OK] tag ${tag} 与四处版本号一致：${expected}`);
