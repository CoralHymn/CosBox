import { describe, expect, it } from 'vitest';
import { crc32, unzipEntries, zipEntries, type ZipEntry } from './zip';

function text(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

describe('crc32', () => {
	it('标准校验值', () => {
		expect(crc32(text('123456789'))).toBe(0xcbf43926);
		expect(crc32(new Uint8Array([]))).toBe(0);
	});
});

describe('zipEntries / unzipEntries', () => {
	it('多文件往返（含中文文件名与内容）', () => {
		const entries: ZipEntry[] = [
			{ name: 'manifest.json', data: text('{"app":"cosbox"}') },
			{ name: '配置/地点.json', data: text('地点库数据') }
		];
		const bytes = zipEntries(entries);
		const files = unzipEntries(bytes);
		expect([...files.keys()]).toEqual(['manifest.json', '配置/地点.json']);
		expect(new TextDecoder().decode(files.get('manifest.json'))).toBe('{"app":"cosbox"}');
		expect(new TextDecoder().decode(files.get('配置/地点.json'))).toBe('地点库数据');
	});

	it('空文件列表往返', () => {
		const files = unzipEntries(zipEntries([]));
		expect(files.size).toBe(0);
	});

	it('非 ZIP 数据抛错', () => {
		expect(() => unzipEntries(new Uint8Array([1, 2, 3]))).toThrow('不是有效的 ZIP');
	});

	it('中央目录损坏抛错', () => {
		const bytes = zipEntries([{ name: 'a.txt', data: text('hi') }]);
		const eocd = bytes.length - 22;
		const cdOffset = readUint32(bytes, eocd + 16);
		bytes[cdOffset] = 0xff;
		expect(() => unzipEntries(bytes)).toThrow('中央目录损坏');
	});

	it('不支持的压缩方式抛错', () => {
		const bytes = zipEntries([{ name: 'a.txt', data: text('hi') }]);
		const eocd = bytes.length - 22;
		const cdOffset = readUint32(bytes, eocd + 16);
		bytes[cdOffset + 10] = 8;
		expect(() => unzipEntries(bytes)).toThrow('不支持的压缩方式');
	});

	it('尺寸不一致抛错', () => {
		const bytes = zipEntries([{ name: 'a.txt', data: text('hi') }]);
		const eocd = bytes.length - 22;
		const cdOffset = readUint32(bytes, eocd + 16);
		bytes[cdOffset + 20] = 99;
		expect(() => unzipEntries(bytes)).toThrow('尺寸不一致');
	});

	it('本地头损坏抛错', () => {
		const bytes = zipEntries([{ name: 'a.txt', data: text('hi') }]);
		bytes[0] = 0xff;
		expect(() => unzipEntries(bytes)).toThrow('本地头损坏');
	});

	it('CRC 校验失败抛错', () => {
		const bytes = zipEntries([{ name: 'a.txt', data: text('hi') }]);
		// 找到本地数据区（本地头 30 字节 + 文件名 5 字节）并篡改数据
		bytes[35] = 0x00;
		expect(() => unzipEntries(bytes)).toThrow('CRC 校验失败');
	});
});

function readUint32(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! |
			(bytes[offset + 1]! << 8) |
			(bytes[offset + 2]! << 16) |
			(bytes[offset + 3]! << 24)) >>>
		0
	);
}
