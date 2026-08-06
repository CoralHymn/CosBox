/** 远程数据同步设置（服务器地址 + 服务器生成的密钥；模型配置与 API Key 不同步）。 */
export interface SyncSettings {
	/** 是否启用远程同步。 */
	enabled: boolean;
	/** 服务器地址，如 https://sync.example.com 或 http://1.2.3.4:8787。 */
	serverUrl: string;
	/** 服务器生成的同步密钥（仅保存在本地设置）。 */
	serverKey: string;
}

/** 默认同步设置：关闭。 */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
	enabled: false,
	serverUrl: '',
	serverKey: ''
};

/** 客户端与服务器之间传输的同步载荷：工作区数据 + 更新时间戳。 */
export interface SyncWorkspacePayload {
	data: import('../import-export/workspace').WorkspaceData;
	updatedAt: number;
}
