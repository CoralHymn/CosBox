import { toUserMessage } from '../core/errors';
import { newId } from '../utils/id';

/** 全局标签页类型。 */
export type TabId =
	| 'chat'
	| 'state'
	| 'locations'
	| 'wardrobe'
	| 'schedule'
	| 'versions'
	| 'world'
	| 'transfer'
	| 'settings';

/** 轻提示消息。 */
export interface Toast {
	id: string;
	kind: 'info' | 'success' | 'error';
	message: string;
}

/** 轻提示 store：异步错误的用户可见出口。 */
export function createToasts() {
	let toasts = $state<Toast[]>([]);

	function push(kind: Toast['kind'], message: string): void {
		const toast: Toast = { id: newId(), kind, message };
		toasts = [...toasts, toast];
		window.setTimeout(() => remove(toast.id), 5000);
	}

	/** 展示错误：把任意异常翻译为用户可读文案。 */
	function error(err: unknown): void {
		push('error', toUserMessage(err));
	}

	function success(message: string): void {
		push('success', message);
	}

	function remove(id: string): void {
		toasts = toasts.filter((toast) => toast.id !== id);
	}

	return {
		get toasts() {
			return toasts;
		},
		push,
		error,
		success,
		remove
	};
}
