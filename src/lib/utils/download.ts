/**
 * 浏览器端触发文本文件下载。
 * 仅用于客户端导出（角色卡、备份），不做 SSR。
 */
export function downloadTextFile(
	filename: string,
	content: string,
	mime = 'application/json'
): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
