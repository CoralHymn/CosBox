function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

/** 时间戳 -> 本地「HH:mm:ss」。 */
export function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 时间戳 -> 本地「MM-DD HH:mm」。 */
export function formatDateTime(ts: number): string {
	const d = new Date(ts);
	return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 截断文本到上限，末尾补省略号。 */
export function truncate(text: string, max: number): string {
	const limit = Math.max(0, Math.floor(max));
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, limit)}…`;
}
