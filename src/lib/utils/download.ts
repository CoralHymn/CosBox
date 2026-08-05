/**
 * 浏览器端触发文本文件下载。
 * 仅用于客户端导出（角色卡、备份），不做 SSR。
 */
export function downloadTextFile(
	filename: string,
	content: string,
	mime = 'application/json'
): void {
	downloadBlob(filename, new Blob([content], { type: mime }));
}

/** 浏览器端触发二进制文件下载（如 .cbox 工作区）。 */
export function downloadBytes(
	filename: string,
	bytes: Uint8Array,
	mime = 'application/octet-stream'
): void {
	const buffer = (bytes.buffer as ArrayBuffer).slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	);
	downloadBlob(filename, new Blob([buffer], { type: mime }));
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
