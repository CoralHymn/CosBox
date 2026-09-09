import { isTauri } from '../platform/updater';

/**
 * 浏览器端触发文本文件下载。
 * 仅用于客户端导出（角色卡、备份），不做 SSR。
 * 返回：Tauri Android 上返回文件保存位置（content:// URI 或完整路径），其余平台返回 null（浏览器下载）。
 */
export async function downloadTextFile(
	filename: string,
	content: string,
	mime = 'application/json'
): Promise<string | null> {
	return downloadBytes(filename, new TextEncoder().encode(content), mime);
}

/**
 * 浏览器端触发二进制文件下载（如 .cbox 工作区）。
 * 返回：Tauri Android 上返回文件保存位置（content:// URI 或完整路径），其余平台返回 null（浏览器下载）。
 */
export async function downloadBytes(
	filename: string,
	bytes: Uint8Array,
	mime = 'application/octet-stream'
): Promise<string | null> {
	// Android WebView 不支持浏览器式下载，改用原生 MediaStore 写入系统「下载」目录；
	// 原生保存失败直接抛出（blob 链接在 WebView 中不可用，回退无意义）。
	// bytes 以 base64 传输：TypedArray 经 Tauri IPC 会序列化成超长 JSON 数字数组，
	// 大工作区导出在 WebView 中内存暴涨会导致闪退，base64 字符串则保持线性大小。
	if (isAndroidTauri()) {
		const { invoke } = await import('@tauri-apps/api/core');
		return invoke<string>('save_to_downloads', {
			filename,
			mime,
			bytes: bytesToBase64(bytes)
		});
	}
	const buffer = (bytes.buffer as ArrayBuffer).slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	);
	downloadBlob(filename, new Blob([buffer], { type: mime }));
	return null;
}

/** 是否运行在 Tauri Android WebView 内。 */
function isAndroidTauri(): boolean {
	return isTauri() && navigator.userAgent.includes('Android');
}

/** Uint8Array → base64（分块拼接，避免一次展开过大的参数列表）。 */
function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
	}
	return btoa(binary);
}

/** 触发 Blob 下载。 */
function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
