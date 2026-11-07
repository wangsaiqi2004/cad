// @ts-check
/**
 * 「对话改布局」的主进程侧服务：定位这一版的工作文档、拼模型配置、跑一次请求、把结果与版本落好。
 *
 * 分工边界（重要）：
 *  - **对话循环、会话、Provider、工具调用**全在上游 `vendor/opencalque/apps/web/src/ai/` 里，
 *    本服务不重写它们，只做三件事：准备好图纸、按本机配置起一条通到模型服务的水管、
 *    把子进程吐出来的事件折成界面能用的结果。
 *  - 真正的执行体是 `runner.ts`，以独立子进程运行（本机 tsx 直跑），模型请求与图纸解析
 *    都不占用界面进程。
 *
 * 安全边界：
 *  - 密钥只经 stdin 传给子进程，**不进命令行参数**（命令行在任务管理器里可见）。
 *  - 对外文案与落盘内容都不含密钥：错误文本先做一次明文剔除。
 *  - 图纸改动**先落在工作副本**上：确认有改动才写新版本目录，旧版本一个字节都不动。
 * @module agent/service
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { RenoError } from '../core/errors.mjs';
import { APP_ROOT, resolveEnginePaths, resolveLocalTsx, nodeExecutable } from '../core/enginePaths.mjs';
import { ensureDir, exists, nowIso } from '../core/util.mjs';
import { collectSecrets, redactText } from '../core/redact.mjs';

/** 一次对话的总时限（毫秒）：超时即杀，绝不挂在那里等。 */
export const AGENT_TIMEOUT_MS = 150_000;
/** 对话记录回显的条数上限。 */
const HISTORY_LINES = 60;
/** 一句话最多这么长，防止把整份资料贴进模型请求。 */
const MAX_TEXT = 4000;

/**
 * 一次对话的结果。
 * @typedef {{reply:string, activities:Array<{kind:string,text:string}>,
 *            changed:boolean, testDouble:boolean, versionId:string, turns:Array<Object>}} AgentTurnResult
 */

export class AgentService {
  /** @param {{pipeline:any}} opts */
  constructor(opts) {
    this.pipeline = opts.pipeline;
    /** @type {import('node:child_process').ChildProcess|null} */
    this.child = null;
  }

  /** 是否有一次对话正在跑。 */
  get busy() {
    return Boolean(this.child && this.child.exitCode === null);
  }

  /**
   * 跑一轮对话：定位工作文档 → 起子进程 → 折事件 → 按需写新版本。
   * @param {{projectId:string, versionId:string, text:string, stub?:boolean, onEvent?:(event:Object)=>void}} input
   * @returns {Promise<AgentTurnResult>}
   */
  async runTurn(input) {
    if (this.busy) throw new RenoError('E_AGENT_BUSY', '上一次对话还没结束，请等它完成或先停止。');
    const text = String(input.text || '').trim();
    if (!text) throw new RenoError('E_VALIDATION', '请先写清楚要改什么，再发送。');
    if (text.length > MAX_TEXT) throw new RenoError('E_VALIDATION', `一次最多 ${MAX_TEXT} 个字，请把要求说得短一些。`);
    if (typeof input.projectId !== 'string' || !input.projectId) throw new RenoError('E_VALIDATION', '缺少项目编号。');
    if (typeof input.versionId !== 'string' || !input.versionId) {
      throw new RenoError('E_VALIDATION', '这一版还没有可编辑的图纸，请先提交需求并生成方案。');
    }

    const pipeline = this.pipeline;
    const projectStore = pipeline.projectStore;
    if (!projectStore || typeof projectStore.versionDir !== 'function') {
      throw new RenoError('E_VALIDATION', '项目还没有打开，请先到首页打开一个项目。');
    }
    const versionDir = projectStore.versionDir(input.projectId, input.versionId);
    const drawingPath = path.join(versionDir, 'drawing.opencalque');
    if (!(await exists(drawingPath))) {
      throw new RenoError('E_VALIDATION', '这一版还没有可编辑的图纸，请先生成方案后再对话修改。');
    }

    const useStub = input.stub === true;
    const model = await pipeline.settingsStore.getRuntimeConfig('textVision');
    if (!useStub && !(model.apiBaseUrl && model.modelName && model.apiKey)) {
      throw new RenoError('E_NO_MODEL_CONFIG', '还没有配置文本模型，请到模型设置填写接口地址 / 密钥 / 模型名。');
    }

    const tsxCli = resolveLocalTsx(resolveEnginePaths().ocHome);
    if (!tsxCli) {
      throw new RenoError('E_ENGINE_FAILED', '本机缺少运行对话所需的本地解释器，请重新运行 npm run setup。');
    }

    const secrets = await secretsOf(pipeline);
    /** @param {unknown} value */
    const clean = (value) => redactText(String(value ?? ''), secrets);

    // 工作副本：改动先落在这里，确认有改动才写新版本，旧版本原样不动。
    const workDir = path.join(versionDir, 'chat-work');
    await ensureDir(workDir);
    const workDrawing = path.join(workDir, 'drawing.opencalque');
    await fs.copyFile(drawingPath, workDrawing);
    const historyIn = path.join(versionDir, 'chat-history.json');
    const historyOut = path.join(workDir, 'chat-history.next.json');

    /** @type {Array<{kind:string,text:string}>} */
    const activities = [];
    /** @type {Array<Object>} */
    let turns = [];
    let reply = '';
    let changed = false;
    let testDouble = false;
    let failure = '';

    const payload = {
      drawingPath: workDrawing,
      text,
      historyPath: (await exists(historyIn)) ? historyIn : undefined,
      historyOutPath: historyOut,
      config: useStub
        ? { baseUrl: '', apiKey: '', model: '' }
        : { baseUrl: model.apiBaseUrl, apiKey: model.apiKey, model: model.modelName },
      stub: useStub,
    };

    try {
      await this._exec(payload, {
        onEvent: (event) => {
          if (input.onEvent) {
            try { input.onEvent(event); } catch { /* 回调异常不影响主流程 */ }
          }
          if (event.type === 'text' && typeof event.delta === 'string') reply += event.delta;
          else if (event.type === 'activity' && typeof event.text === 'string') {
            activities.push({ kind: event.kind === 'error' ? 'error' : 'done', text: String(event.text) });
          } else if (event.type === 'done') {
            changed = event.changed === true;
            testDouble = event.testDouble === true;
            turns = Array.isArray(event.turns) ? event.turns : [];
            if (typeof event.error === 'string' && event.error) failure = event.error;
          }
        },
      });

      if (failure) throw new RenoError('E_MODEL_CALL_FAILED', clean(failure));

      /** @type {{versionId:string, dir:string}|null} */
      let created = null;
      if (changed) {
        created = await projectStore.newVersion(input.projectId);
        await fs.copyFile(workDrawing, path.join(created.dir, 'drawing.opencalque'));
        // 新版本的对话记录接着上一版，员工翻记录时上下文不丢。
        const previousChat = path.join(versionDir, 'chat.ndjson');
        if (await exists(previousChat)) await fs.copyFile(previousChat, path.join(created.dir, 'chat.ndjson'));
        await fs.writeFile(
          path.join(created.dir, 'drawing-change.md'),
          buildChangeNote({
            fromVersion: input.versionId,
            toVersion: created.versionId,
            text: clean(text),
            reply: clean(reply),
          }),
          'utf8',
        );
        if (typeof projectStore.updateMeta === 'function') {
          await projectStore.updateMeta(input.projectId, { versionId: created.versionId });
        }
      }
      const targetDir = created ? created.dir : versionDir;
      const targetVersionId = created ? created.versionId : input.versionId;

      // 会话快照跟着图纸走，下一轮接着上下文聊。
      if (await exists(historyOut)) {
        await fs.copyFile(historyOut, path.join(targetDir, 'chat-history.json'));
      }
      await appendChat(targetDir, [
        { role: 'user', text: clean(text), at: nowIso(), ...(testDouble ? { testDouble: true } : {}) },
        { role: 'assistant', text: clean(reply), at: nowIso(), changed, ...(testDouble ? { testDouble: true } : {}) },
      ]);

      return {
        reply: clean(reply),
        activities: activities.map((item) => ({ kind: item.kind, text: clean(item.text) })),
        changed,
        testDouble,
        versionId: targetVersionId,
        turns,
      };
    } finally {
      this.child = null;
      await removeDir(workDir);
    }
  }

  /**
   * 起一次子进程并等它跑完；stdout 逐行按 NDJSON 解析后回调。
   * @param {Object} payload
   * @param {{onEvent:(event:Object)=>void}} handlers
   * @returns {Promise<void>}
   */
  async _exec(payload, handlers) {
    const child = spawn(nodeExecutable(), [resolveLocalTsx(resolveEnginePaths().ocHome), path.join(APP_ROOT, 'src', 'agent', 'runner.ts')], {
      cwd: APP_ROOT,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    this.child = child;

    let stderr = '';
    let rest = '';
    let settled = false;
    let timedOut = false;

    return new Promise((resolve, reject) => {
      /** @param {Error|null} error */
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
        finish(new RenoError('E_TIMEOUT_UNKNOWN', `本次对话超过 ${Math.round(AGENT_TIMEOUT_MS / 1000)} 秒仍未完成，已停止；图纸没有任何改动。`));
      }, AGENT_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        rest += chunk.toString('utf8');
        const lines = rest.split('\n');
        rest = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue; // 不是约定格式的输出一律忽略，不拿它当结果
          }
          handlers.onEvent(event);
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.on('error', (error) => {
        finish(new RenoError('E_ENGINE_FAILED', `对话进程启动失败：${String(error?.message || error).slice(0, 160)}`));
      });
      child.on('close', (code) => {
        if (timedOut) return;
        if (code !== 0) {
          // 崩溃类失败：把最后几行错误原样带上去，不包装成成功。
          const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
          finish(new RenoError('E_SERVICE_UNAVAILABLE', `对话进程异常退出（${code}）：${tail || '没有更多信息'}`));
          return;
        }
        finish(null);
      });

      try {
        child.stdin.end(JSON.stringify(payload));
      } catch (error) {
        finish(new RenoError('E_ENGINE_FAILED', `对话请求没有送出去：${String(error?.message || error).slice(0, 160)}`));
      }
    });
  }

  /** 停掉正在跑的这一次对话（用户点「停止」）。 @returns {boolean} */
  cancel() {
    if (!this.child) return false;
    try { this.child.kill('SIGKILL'); } catch { /* 已退出 */ }
    this.child = null;
    return true;
  }

  /**
   * 读这一版的对话记录（只读），供界面回显。
   * @param {{projectId:string, versionId:string, limit?:number}} input
   * @returns {Promise<{messages:Array<Object>}>}
   */
  async history(input) {
    if (!input.projectId || !input.versionId) return { messages: [] };
    const store = this.pipeline.projectStore;
    if (!store || typeof store.versionDir !== 'function') return { messages: [] };
    const file = path.join(store.versionDir(input.projectId, input.versionId), 'chat.ndjson');
    if (!(await exists(file))) return { messages: [] };
    const raw = await fs.readFile(file, 'utf8');
    const asked = Number(input.limit);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, HISTORY_LINES) : HISTORY_LINES;
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    /** @type {Array<Object>} */
    const messages = [];
    for (const line of lines.slice(-limit)) {
      try {
        const item = JSON.parse(line);
        if (item && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string') {
          messages.push({
            role: item.role,
            text: item.text,
            at: typeof item.at === 'string' ? item.at : '',
            testDouble: item.testDouble === true,
            changed: item.changed === true,
          });
        }
      } catch { /* 坏行跳过，不编造内容 */ }
    }
    return { messages };
  }
}

/**
 * 子进程环境：去掉会注入加载器 / 改变运行模式的变量，其余原样继承。
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * 当前密钥明文片段（只用于剔除，不外传）。
 * @param {any} pipeline
 * @returns {Promise<string[]>}
 */
async function secretsOf(pipeline) {
  try {
    const secrets = await pipeline.currentSecrets();
    if (Array.isArray(secrets) && secrets.length > 0) return secrets;
  } catch { /* 取不到就退回逐个读 */ }
  try {
    const runtime = await pipeline.settingsStore.getRuntimeConfig('textVision');
    return collectSecrets({ textVision: { apiKey: runtime.apiKey } });
  } catch {
    return [];
  }
}

/**
 * 追加对话记录（一行一条，纯文本，不含密钥与完整系统提示）。
 * @param {string} dir
 * @param {Array<Object>} items
 */
async function appendChat(dir, items) {
  const body = items.map((item) => `${JSON.stringify(item)}\n`).join('');
  await fs.appendFile(path.join(dir, 'chat.ndjson'), body, 'utf8');
}

/**
 * 删掉对话工作副本（不是成果，不进交付包）。
 * @param {string} dir
 */
async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch { /* 清理失败不影响结果 */ }
}

/**
 * 新版本的一句说明，写在新版本目录里（中文可读，不含密钥）。
 * @param {{fromVersion:string, toVersion:string, text:string, reply:string}} opts
 * @returns {string}
 */
function buildChangeNote(opts) {
  return [
    '对话改布局记录',
    '='.repeat(40),
    `来源版本：${opts.fromVersion}`,
    `新版本：${opts.toVersion}`,
    `时间：${nowIso()}`,
    '',
    '员工的要求：',
    opts.text,
    '',
    '助手回复：',
    opts.reply,
    '',
    '说明：本次改动写入新版本目录；来源版本的图纸与交付包完整保留，没有被覆盖。',
    '',
  ].join('\n');
}
