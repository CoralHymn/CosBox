// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBytes, downloadTextFile } from './download';

// 文件级 mock：isTauri 与 invoke 均可按测试控制。
const tauriMock = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));
vi.mock('../platform/updater', () => ({ isTauri: tauriMock.isTauri }));
const coreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => coreMock);

describe('downloadTextFile', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		tauriMock.isTauri.mockReturnValue(false);
		coreMock.invoke.mockReset();
		Object.defineProperty(window.navigator, 'userAgent', {
			value: 'jsdom',
			configurable: true
		});
	});

	it('创建 Blob 链接并触发点击', async () => {
		const createUrl = vi.fn(() => 'blob:mock');
		const revokeUrl = vi.fn();
		vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
		const click = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

		const saved = await downloadTextFile('card.json', '{"a":1}', 'application/json');

		expect(saved).toBeNull();
		expect(createUrl).toHaveBeenCalledTimes(1);
		expect(click).toHaveBeenCalledTimes(1);
		expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
	});

	it('downloadBytes 创建二进制 Blob 并触发点击', async () => {
		const createUrl = vi.fn(() => 'blob:mock');
		const revokeUrl = vi.fn();
		vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
		const click = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

		const saved = await downloadBytes('cosbox.cbox', new Uint8Array([1, 2, 3]));

		expect(saved).toBeNull();
		expect(createUrl).toHaveBeenCalledTimes(1);
		expect(click).toHaveBeenCalledTimes(1);
		expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
	});

	it('Android：二进制内容以 base64 传输并返回保存位置', async () => {
		tauriMock.isTauri.mockReturnValue(true);
		Object.defineProperty(window.navigator, 'userAgent', {
			value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
			configurable: true
		});
		coreMock.invoke.mockResolvedValue('content://downloads/cosbox');

		const saved = await downloadBytes(
			'cosbox.cbox',
			new Uint8Array([0, 1, 2, 255]),
			'application/octet-stream'
		);

		expect(saved).toBe('content://downloads/cosbox');
		// TypedArray 直接经 IPC 会变成超长 JSON 数字数组，必须编码为 base64 字符串。
		expect(coreMock.invoke).toHaveBeenCalledWith('save_to_downloads', {
			filename: 'cosbox.cbox',
			mime: 'application/octet-stream',
			bytes: 'AAEC/w=='
		});
	});
});
