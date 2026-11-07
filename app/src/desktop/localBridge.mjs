// @ts-check
/**
 * 本地 HTTP 桥（复用 opencalque `apps/desktop/src/main/bridge.ts` 的边界设计）。
 *
 * 让 `app/` 领域核心能被 Electron 桌面壳 / 本机 Agent 以受控方式调用：
 *  - 只监听 127.0.0.1 的系统随机端口；
 *  - `randomBytes(32)` token + `timingSafeEqual` 常量时间比对；
 *  - 带 `Origin` 头一律 403（网页能连本地端口，但读不到 token 文件也藏不住自己是网页）；
 *  - `bridge.json` 以 0o600 写入；仅 `POST /tool`；32 MiB body 上限；
 *  - 工具调用一律经 CoreHost 的白名单与 L3 确认门，不暴露任意命令 / 脚本 / 路径。
 *
 * 本桥**不重写** Agent Loop / 会话 / Provider：它只是领域核心的本地传输层。
 * @module desktop/localBridge
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const MAX_BODY = 32 * 1024 * 1024;

/** @param {string} given @param {string} token */
function sameToken(given, token) {
  const [a, b] = [Buffer.from(given), Buffer.from(`Bearer ${token}`)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** @param {import('node:http').IncomingMessage} request */
function readBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return reject(new Error('请求体过大'));
      chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * 处理一次请求，统一响应 `{code, data, message}`（架构师 §8.3(1) 契约）。
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} token
 * @param {(name:string,input:Object)=>Promise<Object>} call
 */
async function answer(request, response, token, call) {
  const reply = (status, payload) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    response.writeHead(status, { 'content-type': status === 200 ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
    response.end(body);
  };
  if (request.headers.origin !== undefined) return reply(403, '不允许来自网页的请求。');
  if (!sameToken(String(request.headers.authorization || ''), token)) return reply(401, '凭据不正确。');
  if (request.method !== 'POST' || request.url !== '/tool') return reply(404, '仅支持 POST /tool。');
  try {
    const parsed = JSON.parse(await readBody(request));
    if (typeof parsed?.name !== 'string') return reply(400, '缺少操作名称。');
    const result = await call(parsed.name, parsed.input || {});
    return reply(200, result);
  } catch (error) {
    return reply(500, { code: 1, data: { errorCode: 'E_SERVICE_UNAVAILABLE' }, message: `本地服务异常：${String(error?.message || error).slice(0, 160)}` });
  }
}

/**
 * 启动本地桥。
 * @param {{call:(name:string,input:Object)=>Promise<Object>, file:string}} opts
 * @returns {Promise<{port:number,token:string,file:string,stop:()=>void}>}
 */
export function startLocalBridge(opts) {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => { void answer(request, response, token, opts.call); });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      try {
        mkdirSync(dirname(opts.file), { recursive: true });
        writeFileSync(opts.file, JSON.stringify({ port, token }), { mode: 0o600 });
      } catch (error) {
        server.close();
        reject(error);
        return;
      }
      resolve({
        port,
        token,
        file: opts.file,
        stop: () => {
          try { rmSync(opts.file, { force: true }); } catch { /* 已清理 */ }
          try { server.closeAllConnections(); } catch { /* Node 版本差异 */ }
          server.close();
        },
      });
    });
  });
}
