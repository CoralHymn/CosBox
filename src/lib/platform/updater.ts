/**
 * 桌面端打包专属的版本与自动更新适配层（D103）。
 * Web 版不加载任何 Tauri 插件代码；仅在 Tauri WebView 内动态引入。
 */

/** 应用版本号（SemVer）。与 package.json / src-tauri/Cargo.toml / tauri.conf.json 保持一致。 */
export const APP_VERSION = '0.0.1';

/** 是否运行在 Tauri WebView 内（桌面 / 移动）。 */
export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 可用更新的摘要信息。 */
export interface UpdateInfo {
	version: string;
	notes: string;
}

/**
 * 检查更新。非 Tauri 环境或已是最新版本时返回 null；
 * 网络 / 签名异常时抛出错误，由调用方展示。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
	if (!isTauri()) {
		return null;
	}
	const { check } = await import('@tauri-apps/plugin-updater');
	const update = await check();
	if (update === null) {
		return null;
	}
	return { version: update.version, notes: update.body ?? '' };
}

/** 下载进度回调：已下载字节数与总字节数（未知时为 null）。 */
export type InstallProgress = { downloaded: number; total: number | null };

/**
 * 下载并安装更新，安装完成后自动重启应用（桌面端）。
 * 非 Tauri 环境直接抛错；更新流程的进度通过 onProgress 回调。
 */
export async function downloadAndInstall(
	onProgress?: (progress: InstallProgress) => void
): Promise<void> {
	if (!isTauri()) {
		throw new Error('当前环境不支持自动更新');
	}
	const { check } = await import('@tauri-apps/plugin-updater');
	const { relaunch } = await import('@tauri-apps/plugin-process');
	const update = await check();
	if (update === null) {
		throw new Error('没有待安装的更新');
	}
	let total: number | null = null;
	await update.downloadAndInstall((event) => {
		switch (event.event) {
			case 'Started':
				total = event.data.contentLength ?? null;
				onProgress?.({ downloaded: 0, total });
				break;
			case 'Progress':
				onProgress?.({ downloaded: event.data.chunkLength, total });
				break;
			case 'Finished':
				onProgress?.({ downloaded: total ?? 0, total });
				break;
		}
	});
	// 安装已就绪，重启进入新版本。
	await relaunch();
}
