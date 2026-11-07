/**
 * 窄 IPC 桥：只暴露四个固定方法，不暴露文件系统、进程、路径或任何凭据明文。
 * 渲染层拿不到本地桥 token，也拿不到 Node 能力。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reno', {
  /** @param {string} name @param {Object} input */
  call: (name, input) => ipcRenderer.invoke('reno:tool', { name, input: input || {} }),
  info: () => ipcRenderer.invoke('reno:info'),
  isSmoke: () => ipcRenderer.invoke('reno:smoke-mode'),
  smokeResult: (data) => ipcRenderer.invoke('reno:smoke-result', data),
  /** 交给系统打开当前版本的产物；渲染层只传种类与版本号。 */
  open: (payload) => ipcRenderer.invoke('reno:open', payload || {}),
});
