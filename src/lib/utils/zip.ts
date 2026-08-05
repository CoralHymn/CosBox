/**
 * 极简 ZIP 读写（仅 store 无压缩方式、UTF-8 文件名）。
 * 用于 .cbox 工作区容器：文件均为小型 JSON，体积可接受，且任何解压工具都能打开。
 */

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

/** ZIP 中的一条文件。 */
export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** 把多个文件打包为 store 方式 ZIP 的字节。 */
export function zipEntries(entries: readonly ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const header = new DataView(new ArrayBuffer(30));
		header.setUint32(0, LOCAL_FILE_HEADER, true);
		header.setUint16(4, 20, true);
		header.setUint16(6, UTF8_FLAG, true);
		header.setUint16(8, STORE_METHOD, true);
		header.setUint16(10, 0, true);
		header.setUint16(12, 0x21, true);
		header.setUint32(14, crc, true);
		header.setUint32(18, entry.data.length, true);
		header.setUint32(22, entry.data.length, true);
		header.setUint16(26, nameBytes.length, true);
		header.setUint16(28, 0, true);
		chunks.push(new Uint8Array(header.buffer), nameBytes, entry.data);

		const centralEntry = new DataView(new ArrayBuffer(46));
		centralEntry.setUint32(0, CENTRAL_DIRECTORY, true);
		centralEntry.setUint16(4, 20, true);
		centralEntry.setUint16(6, 20, true);
		centralEntry.setUint16(8, UTF8_FLAG, true);
		centralEntry.setUint16(10, STORE_METHOD, true);
		centralEntry.setUint16(12, 0, true);
		centralEntry.setUint16(14, 0x21, true);
		centralEntry.setUint32(16, crc, true);
		centralEntry.setUint32(20, entry.data.length, true);
		centralEntry.setUint32(24, entry.data.length, true);
		centralEntry.setUint16(28, nameBytes.length, true);
		centralEntry.setUint16(30, 0, true);
		centralEntry.setUint16(32, 0, true);
		centralEntry.setUint16(34, 0, true);
		centralEntry.setUint16(36, 0, true);
		centralEntry.setUint32(38, 0, true);
		centralEntry.setUint32(42, offset, true);
		central.push(new Uint8Array(centralEntry.buffer), nameBytes);
		offset += 30 + nameBytes.length + entry.data.length;
	}

	const centralStart = offset;
	const centralBytes = concatBytes(central);
	const eocd = new DataView(new ArrayBuffer(22));
	eocd.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
	eocd.setUint16(4, 0, true);
	eocd.setUint16(6, 0, true);
	eocd.setUint16(8, entries.length, true);
	eocd.setUint16(10, entries.length, true);
	eocd.setUint32(12, centralBytes.length, true);
	eocd.setUint32(16, centralStart, true);
	eocd.setUint16(20, 0, true);
	return concatBytes([...chunks, centralBytes, new Uint8Array(eocd.buffer)]);
}

/** 解包 ZIP（store 方式），返回文件名 → 内容；格式或校验失败抛错。 */
export function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
	let eocdIndex = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
		if (readUint32(bytes, i) === END_OF_CENTRAL_DIRECTORY) {
			eocdIndex = i;
			break;
		}
	}
	if (eocdIndex === -1) {
		throw new Error('不是有效的 ZIP 文件（缺少中央目录）');
	}
	const totalEntries = readUint16(bytes, eocdIndex + 10);
	const cdOffset = readUint32(bytes, eocdIndex + 16);
	const result = new Map<string, Uint8Array>();
	let pos = cdOffset;
	for (let index = 0; index < totalEntries; index += 1) {
		if (readUint32(bytes, pos) !== CENTRAL_DIRECTORY) {
			throw new Error('ZIP 中央目录损坏');
		}
		const method = readUint16(bytes, pos + 10);
		if (method !== STORE_METHOD) {
			throw new Error(`不支持的压缩方式：${method}（仅支持 store）`);
		}
		const crc = readUint32(bytes, pos + 16);
		const compressedSize = readUint32(bytes, pos + 20);
		const uncompressedSize = readUint32(bytes, pos + 24);
		const nameLength = readUint16(bytes, pos + 28);
		const extraLength = readUint16(bytes, pos + 30);
		const commentLength = readUint16(bytes, pos + 32);
		const localOffset = readUint32(bytes, pos + 42);
		const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLength));
		if (readUint32(bytes, localOffset) !== LOCAL_FILE_HEADER) {
			throw new Error(`ZIP 本地头损坏：${name}`);
		}
		if (compressedSize !== uncompressedSize) {
			throw new Error(`store 条目尺寸不一致：${name}`);
		}
		const localNameLength = readUint16(bytes, localOffset + 26);
		const localExtraLength = readUint16(bytes, localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const data = bytes.slice(dataStart, dataStart + compressedSize);
		if (crc32(data) !== crc) {
			throw new Error(`CRC 校验失败：${name}`);
		}
		result.set(name, data);
		pos += 46 + nameLength + extraLength + commentLength;
	}
	return result;
}

/** 拼接字节数组。 */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const part of parts) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

let crcTable: Uint32Array | null = null;

/** 标准 CRC-32。 */
export function crc32(data: Uint8Array): number {
	if (crcTable === null) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n += 1) {
			let value = n;
			for (let k = 0; k < 8; k += 1) {
				value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
			}
			crcTable[n] = value >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function readUint16(bytes: Uint8Array, offset: number): number {
	return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! |
			(bytes[offset + 1]! << 8) |
			(bytes[offset + 2]! << 16) |
			(bytes[offset + 3]! << 24)) >>>
		0
	);
}
