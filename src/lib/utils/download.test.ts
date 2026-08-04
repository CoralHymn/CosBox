// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from './download';

describe('downloadTextFile', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('创建 Blob 链接并触发点击', () => {
		const createUrl = vi.fn(() => 'blob:mock');
		const revokeUrl = vi.fn();
		vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
		const click = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

		downloadTextFile('card.json', '{"a":1}', 'application/json');

		expect(createUrl).toHaveBeenCalledTimes(1);
		expect(click).toHaveBeenCalledTimes(1);
		expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
	});
});
