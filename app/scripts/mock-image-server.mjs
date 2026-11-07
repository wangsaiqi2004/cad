// @ts-check
/**
 * ⚠️ 测试替身（TEST DOUBLE）—— 不是真实模型服务，不代表任何真实服务商的能力。
 *
 * 用途：本机没有客户 API Key，用它验证「配置 → 能力测试 → 生图请求 → 保存结果 → 幂等」
 * 这条**代码路径**能否跑通。所有响应都带 `X-Reno-Test-Double: true` 头，能力结论会标注
 * `testDouble: true`，不得被当作真实端点能力，也不计入「真实联调通过」。
 *
 * 支持故障注入（?mock_fail=401|403|429|500|timeout|unsupported|invalid_image），
 * 用于验证错误分类、能力禁用与「不重复扣费」逻辑。
 * @module scripts/mock-image-server
 */

import http from 'node:http';
import { createPng } from '../src/image/png.mjs';

export const TEST_DOUBLE_HEADER = { 'X-Reno-Test-Double': 'true' };

/** 测试替身返回的一张可解码小图（32x32 PNG）。 */
const SAMPLE_PNG = createPng(32, 32, (x, y) => [
  120 + ((x * 4) % 100),
  130 + ((y * 3) % 90),
  170 + (((x + y) * 2) % 70),
]);

/** @param {http.ServerResponse} res @param {number} status @param {unknown} payload */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { ...TEST_DOUBLE_HEADER, 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

/**
 * 启动本机测试替身服务（仅监听 127.0.0.1 随机端口）。
 * @returns {Promise<{port:number,baseUrl:string,close:()=>Promise<void>,isTestDouble:true,requestCount:()=>number}>}
 */
export async function startMockServer() {
  let requestCount = 0;
  const server = http.createServer(async (req, res) => {
    requestCount += 1;
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const fail = url.searchParams.get('mock_fail');
    const raw = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch { /* multipart / 非 JSON */ }

    if (fail === 'timeout') {
      // 故意不响应，让客户端超时；服务端 5s 后自行结束，不阻塞退出。
      setTimeout(() => { try { res.end(); } catch { /* 客户端已断开 */ } }, 5000);
      return;
    }
    if (fail === '401') return sendJson(res, 401, { error: { message: 'invalid api key' } });
    if (fail === '403') return sendJson(res, 403, { error: { message: 'forbidden' } });
    if (fail === '429') return sendJson(res, 429, { error: { message: 'rate limited' } });
    if (fail === '500') return sendJson(res, 500, { error: { message: 'internal error' } });
    if (fail === 'unsupported') return sendJson(res, 404, { error: { message: 'endpoint not found' } });

    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      return sendJson(res, 200, { data: [{ id: 'mock-text-vision' }, { id: 'mock-image' }] });
    }
    if (req.method === 'GET' && url.pathname.endsWith('/health')) {
      return sendJson(res, 200, { status: 'ok', testDouble: true });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
      const content = payload.messages?.[0]?.content;
      const hasImage = Array.isArray(content)
        && content.some((part) => part && (part.type === 'image_url' || part.image_url));
      if (hasTools) {
        return sendJson(res, 200, {
          id: 'mock-chat-tools', object: 'chat.completion', model: payload.model || 'mock-text-vision',
          choices: [{
            index: 0, finish_reason: 'tool_calls',
            message: {
              role: 'assistant', content: null,
              tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'measure_drawing', arguments: '{}' } }],
            },
          }],
        });
      }
      const text = hasImage
        ? '这是一张测试替身生成的室内平面参考图，含墙体线条与房间标注；仅用于流程验证，不代表真实识别结果。'
        : 'OK';
      return sendJson(res, 200, {
        id: 'mock-chat', object: 'chat.completion', model: payload.model || 'mock-text-vision',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      });
    }
    if (req.method === 'POST' && (url.pathname.endsWith('/images/generations') || url.pathname.endsWith('/images/edits'))) {
      const b64 = fail === 'invalid_image' ? 'bm90LWFuLWltYWdl' : SAMPLE_PNG.toString('base64');
      return sendJson(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64, revised_prompt: '[测试替身] 未做真实图像生成' }],
      });
    }
    return sendJson(res, 404, { error: { message: `unknown test-double endpoint: ${url.pathname}` } });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    isTestDouble: true,
    requestCount: () => requestCount,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// 允许直接 `node scripts/mock-image-server.mjs` 手动启动（打印端口，便于人工检查）。
if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = await startMockServer();
  process.stdout.write(`[TEST DOUBLE] 本机测试替身已启动：${instance.baseUrl}\n`);
  process.stdout.write('[TEST DOUBLE] 这不是真实模型服务，不代表任何服务商能力。Ctrl+C 退出。\n');
}
