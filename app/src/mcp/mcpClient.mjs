// @ts-check
/**
 * L1 MCP Client adapter（薄层 #1）。
 *
 * opencalque 自带的是 MCP **Server**（`packages/cli/src/mcp.ts`）；本模块用已在依赖树里的
 * `@modelcontextprotocol/sdk` 同款 stdio JSON-RPC 协议实现一个最小 Client，把外部工具接进
 * 本产品的 DRAWING_TOOLS 白名单体系。不重写 Agent Loop，只做工具源适配。
 *
 * 实测（本机）：`opencalque mcp <file>` 的 initialize 返回
 * `serverInfo {name:"opencalque",version:"1.6.0"}`，tools/list 返回
 * read_guide / open_drawing / describe_drawing / apply_operations / check_drawing /
 * measure_drawing / view_drawing，instructions 要求「Call read_guide once before your first edit」。
 * @module mcp/mcpClient
 */

import { spawn } from 'node:child_process';
import { resolveEnginePaths, quoteArg } from '../core/enginePaths.mjs';

export class McpClient {
  /**
   * @param {{commandLine:string, cwd?:string, timeoutMs?:number}} opts
   */
  constructor(opts) {
    this.commandLine = opts.commandLine;
    this.cwd = opts.cwd;
    this.timeoutMs = opts.timeoutMs || 20000;
    /** @type {Map<number,{resolve:(v:Object)=>void,reject:(e:Error)=>void,timer:NodeJS.Timeout}>} */
    this.pending = new Map();
    /** @type {Array<Object>} */
    this.notifications = [];
    this.nextId = 1;
    this.child = null;
    this.buffer = '';
    this.serverInfo = null;
    this.instructions = '';
    this.nonJsonLines = 0;
    this.closed = false;
  }

  /** 启动子进程并开始解析 stdout 上的 newline-delimited JSON-RPC。 @returns {Promise<void>} */
  async start() {
    this.child = spawn(this.commandLine, [], {
      cwd: this.cwd,
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child.stdout.on('data', (chunk) => this._onData(chunk.toString('utf8')));
    this.child.stderr.on('data', () => { /* MCP server 的日志不进入协议通道 */ });
    this.child.on('close', () => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('MCP Server 已关闭'));
      }
      this.pending.clear();
    });
    await this.initialize();
  }

  /** @param {string} chunk */
  _onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.nonJsonLines += 1; continue; }
      if (message && typeof message.id !== 'undefined' && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        entry.resolve(message);
      } else if (message && typeof message.id === 'undefined') {
        this.notifications.push(message);
      }
    }
  }

  /** @param {string} method @param {Object} params @returns {Promise<Object>} */
  _request(method, params) {
    if (!this.child || this.closed) return Promise.reject(new Error('MCP Client 未启动'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** @param {string} method @param {Object} [params] */
  _notify(method, params = {}) {
    if (!this.child) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  /** MCP initialize 握手。 @returns {Promise<Object>} */
  async initialize() {
    const response = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'local-interior-design-agent', version: '0.1.0' },
    });
    this._notify('notifications/initialized');
    this.serverInfo = response.result?.serverInfo || null;
    this.instructions = response.result?.instructions || '';
    return response.result || {};
  }

  /** @returns {Promise<Array<Object>>} */
  async listTools() {
    const response = await this._request('tools/list', {});
    return Array.isArray(response.result?.tools) ? response.result.tools : [];
  }

  /**
   * 调用一个工具；调用方必须先经过 PermissionGate 授权。
   * @param {string} name @param {Object} args
   */
  async callTool(name, args) {
    const response = await this._request('tools/call', { name, arguments: args || {} });
    return response.result || response;
  }

  /** 关闭子进程。 */
  async close() {
    if (!this.child || this.closed) return;
    try { this.child.stdin.end(); } catch { /* 已关闭 */ }
    try { this.child.kill('SIGTERM'); } catch { /* 已退出 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /** 供全局一致性审查 / 验收核对的握手摘要。 */
  summary() {
    return {
      serverInfo: this.serverInfo,
      instructions: this.instructions,
      nonJsonLines: this.nonJsonLines,
      notificationCount: this.notifications.length,
      closed: this.closed,
    };
  }
}

/**
 * 构造连接 opencalque MCP Server 的 Client。
 * @param {{drawingPath:string, ocHome?:string}} opts
 */
export function createOpenCalqueMcpClient(opts) {
  const paths = resolveEnginePaths();
  const cwd = opts.ocHome || paths.ocHome;
  const commandLine = `npx -y pnpm@9.14.2 --silent opencalque mcp ${quoteArg(opts.drawingPath)}`;
  return new McpClient({ commandLine, cwd, timeoutMs: 25000 });
}
