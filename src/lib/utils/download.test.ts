// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBytes, downloadTextFile } from './download';

describe('downloadTextFile', () => {
	afterEach(() => {
		vi.restoreAllMocks();
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
});
