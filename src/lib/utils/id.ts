import { nanoid } from 'nanoid';

/** 生成唯一 id（nanoid）。 */
export function newId(): string {
	return nanoid();
}
