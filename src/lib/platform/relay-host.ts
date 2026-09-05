/**
 * 内置软件通道的逻辑前缀（D112）。
 *
 * 禁浏览器 CORS 直连的端点，请求前把真实地址换成 `<RELAY_PREFIX><host>/<path>`，
 * 再由各平台还原：浏览器交给 vite.config.ts 的转发中间件，Tauri 交给
 * platform/http.ts 重写后走 HTTP 插件。
 *
 * 本模块必须零依赖：vite.config.ts 与 src/lib/platform/http.ts 共用它来保证
 * 两侧对 host 的判定一致，若从 http.ts 导入会顺带拖进 @tauri-apps 依赖。
 */

export const RELAY_PREFIX = '/llm-proxy/';

/**
 * 前缀里的 host 段：裸主机名/IP + 可选端口（不含协议、不含凭据）。
 * 必须含点或冒号——既挡掉畸形值，也让未迁移的老式前缀
 * （/llm-proxy/zen/go/v1，第一段是路径而非 host）返回 null 而不是拼错目标。
 */
export function isRelayHost(host: string): boolean {
	if (!host.includes('.') && !host.includes(':')) {
		return false;
	}
	return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:\d{1,5})?$/.test(
		host
	);
}

/** 该请求路径是否命中通道前缀（命中后 host 是否合法由 parseRelayTarget 判定）。 */
export function isRelayPath(url: string): boolean {
	return url.startsWith(RELAY_PREFIX);
}

/** 通道前缀 → 真实目标（固定 https）；非前缀或 host 非法返回 null。 */
export function parseRelayTarget(url: string): string | null {
	if (!isRelayPath(url)) {
		return null;
	}
	const rest = url.slice(RELAY_PREFIX.length);
	const separator = rest.indexOf('/');
	const host = separator === -1 ? rest : rest.slice(0, separator);
	const path = separator === -1 ? '' : rest.slice(separator);
	return isRelayHost(host) ? `https://${host}${path}` : null;
}
