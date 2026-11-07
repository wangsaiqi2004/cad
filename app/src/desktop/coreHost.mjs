// @ts-check
/**
 * 桌面壳的领域核心宿主：把已验证的 `Pipeline` 包成一组**白名单工具**，
 * 统一响应 `{code, data, message}`（架构师 §8.3(1) 契约，message 恒为中文、无原始堆栈）。
 *
 * 六个通用对话能力（界面 / 循环 / 会话 / Provider / 工具调用 / 存储）**不重写**：
 * 「对话改布局」直接复用上游 opencalque `apps/web/src/ai/{agent,compatible}.ts` 的 Agent Loop
 * 与 `@opencalque/core` 的 7 个绘图工具，由 `agent/service.mjs` 起独立子进程跑，
 * 这里只把结果折成一个受控工具 `agentSend`，其余仍是「首页 / 设置 / 项目 / 校准 / 出图 / 生图 / 交付」。
 * 每个动作都过 L3 权限门（受控动作要求 `confirmed: true`），全部写脱敏审计。
 * @module desktop/coreHost
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Pipeline } from '../orchestrator/pipeline.mjs';
import { AgentService } from '../agent/service.mjs';
import { runCapabilityTests } from '../config/capabilityMatrix.mjs';
import { BOUNDARY_STATEMENTS, FORMAT_MATRIX } from '../core/types.mjs';
import { AuditLog } from '../core/audit.mjs';
import { toRenoError } from '../core/errors.mjs';
import { APP_ROOT, RUNTIME_DIR } from '../core/enginePaths.mjs';
import { ensureDir } from '../core/util.mjs';

/** 桌面壳允许调用的工具（正向白名单，deny by default）。 */
export const DESKTOP_TOOLS = Object.freeze([
  'getHome', 'getSettings', 'saveSettings', 'testCapabilities', 'getBoundary', 'getFormatMatrix',
  'newProject', 'listRecent', 'openProject', 'ingestFiles', 'submitRequirements',
  'getCalibration', 'applyCalibration', 'confirmAndBuild', 'getTaskStatus',
  'getSubmissionPrompt', 'confirmImageSubmission', 'packageAndFinish', 'redo',
  'getVersions', 'getVersionPreview', 'exportDelivery',
  'agentSend', 'getChatHistory',
]);

/** 会写成果 / 产生费用 / 生成新版本的动作，必须先由用户在弹窗里确认。 */
export const CONFIRM_REQUIRED = new Set([
  'confirmAndBuild', 'confirmImageSubmission', 'packageAndFinish', 'redo', 'agentSend',
]);

export class CoreHost {
  /** @param {{dataDir?:string, projectsRoot?:string, confirmer?:Function}} [opts] */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.join(APP_ROOT, '.runtime', 'userdata');
    this.projectsRoot = opts.projectsRoot || path.join(APP_ROOT, '.runtime', 'desktop-projects');
    this.deliveriesDir = path.join(this.projectsRoot, 'deliveries');
    this.audit = new AuditLog(path.join(RUNTIME_DIR, 'desktop-audit.ndjson'), []);
    this.pipeline = new Pipeline({
      mode: 'real',
      confirmer: opts.confirmer || (() => true),
      dataDir: this.dataDir,
      projectsRoot: this.projectsRoot,
    });
    this.agent = new AgentService({ pipeline: this.pipeline });
  }

  async init() {
    await ensureDir(RUNTIME_DIR);
    await ensureDir(this.deliveriesDir);
    await this.pipeline.init();
    this.audit.setSecrets(await this.pipeline.currentSecrets());
    return this;
  }

  /**
   * 调用一个工具。永远不抛异常到渲染层，统一返回 `{code,data,message}`。
   * @param {string} name
   * @param {Object} input
   * @returns {Promise<{code:number,data:Object|null,message:string}>}
   */
  async call(name, input = {}) {
    if (!DESKTOP_TOOLS.includes(name)) {
      await this.audit.append({ action: 'tool_call', tool: name, result: 'denied', detail: { reason: '不在允许清单内' } });
      return { code: 1, data: { errorCode: 'E_PERMISSION_DENIED', nextSteps: ['请联系管理员'] }, message: '已拒绝：该操作不在允许清单内。' };
    }
    if (CONFIRM_REQUIRED.has(name) && input.confirmed !== true) {
      await this.audit.append({ action: 'tool_call', tool: name, result: 'denied', detail: { reason: '缺少用户预执行确认' } });
      return {
        code: 1,
        data: { errorCode: 'E_PERMISSION_DENIED', nextSteps: ['请在弹窗里确认本次操作'] },
        message: '请先在弹窗里确认本次操作（仅本次允许）。',
      };
    }
    try {
      const data = await this._dispatch(name, input);
      await this.audit.append({
        action: 'tool_call', tool: name, result: 'allowed',
        detail: { confirmed: input.confirmed === true },
      });
      return { code: 0, data, message: '操作成功' };
    } catch (error) {
      const reno = toRenoError(error);
      await this.audit.append({ action: 'tool_call', tool: name, result: 'denied', detail: { errorCode: reno.code } });
      return {
        code: 1,
        data: { errorCode: reno.code, nextSteps: reno.toUserFacing().nextSteps },
        message: reno.message,
      };
    }
  }

  /** @param {string} name @param {Object} input */
  async _dispatch(name, input) {
    const p = this.pipeline;
    switch (name) {
      case 'getHome':
        return {
          productName: '本地装修设计 Agent',
          badge: await p.secretStore.badge(),
          recentProjects: await p.projectStore.listRecent(),
          boundarySummary: BOUNDARY_STATEMENTS.slice(0, 3),
          note: '模型费用由公司自己的账户承担；所有资料与成果保存在本机。',
        };
      case 'getSettings':
        return {
          public: await p.settingsStore.getPublic(),
          capabilities: p.capabilityMatrix.toPublic(),
          adapterSupport: (await import('../image/imageAdapter.mjs')).ADAPTER_SUPPORT,
        };
      case 'saveSettings': {
        if (input.textVision) await p.settingsStore.saveGroup('textVision', input.textVision);
        if (input.imageGen) await p.settingsStore.saveGroup('imageGen', input.imageGen);
        const secrets = await p.currentSecrets();
        this.audit.setSecrets(secrets);
        if (p.stores.audit) p.stores.audit.setSecrets(secrets);
        if (p.stores.sm) p.stores.sm.setSecrets(secrets);
        // 不在此处发起任何网络请求；能力测试由「测试连接」单独触发。
        return { public: await p.settingsStore.getPublic(), safeStorage: await p.secretStore.status() };
      }
      case 'testCapabilities': {
        const results = await runCapabilityTests({
          settingsStore: p.settingsStore,
          httpAdapter: p.httpAdapter,
          matrix: p.capabilityMatrix,
          mode: input.mode === 'mock' ? 'mock' : 'real',
          timeoutMs: 15000,
        });
        return { results, public: p.capabilityMatrix.toPublic() };
      }
      case 'getBoundary':
        return { statements: BOUNDARY_STATEMENTS };
      case 'getFormatMatrix':
        return { matrix: FORMAT_MATRIX };
      case 'newProject':
        return { project: await p.createProject({
          name: String(input.name || '未命名项目'),
          client: String(input.client || ''),
          address: String(input.address || ''),
          notes: String(input.notes || ''),
        }) };
      case 'listRecent':
        return { projects: await p.projectStore.listRecent() };
      case 'openProject':
        if (!input.projectId) throw new Error('缺少项目编号');
        return await p.openProject(String(input.projectId));
      case 'ingestFiles': {
        const files = (Array.isArray(input.files) ? input.files : []).map((file) => ({
          name: String(file.name || ''),
          data: Buffer.from(String(file.base64 || ''), 'base64'),
          stage: String(file.stage || '资料上传'),
        }));
        return await p.ingest(files);
      }
      case 'submitRequirements':
        return await p.submitRequirements({
          fields: input.fields || {},
          candidates: input.candidates || [],
          backgroundImage: input.backgroundImage || null,
        });
      case 'getCalibration': {
        const s = p._requireProject();
        return { pending: await s.calibration.pendingItems(), complete: await s.calibration.isComplete() };
      }
      case 'applyCalibration':
        return await p.applyCalibration({
          p1: input.p1, p2: input.p2,
          knownDistanceMm: Number(input.knownDistanceMm),
          // 比例来源必须透传：无底图时是「用户直接给的尺寸」，不能记成「底图两点」。
          scaleSource: input.scaleSource,
          confirmations: input.confirmations || {},
          dimensions: input.dimensions || null,
          confirmedBy: String(input.confirmedBy || '员工'),
        });
      case 'confirmAndBuild':
        return await p.confirmCalibrationAndBuild();
      case 'getTaskStatus': {
        const s = p._requireProject();
        if (!p.ctx.taskId) return { state: 'DRAFT', stateLabel: '草稿，尚未提交', waitingForUser: false };
        return { ...(await s.sm.toPublic(p.ctx.taskId)), log: (await s.sm.readLog()).slice(-40) };
      }
      case 'getSubmissionPrompt': {
        const s = p._requireProject();
        const task = await s.sm.get(p.ctx.taskId);
        const runtime = await p.settingsStore.getRuntimeConfig('imageGen');
        return {
          modelName: runtime.modelName,
          provider: runtime.provider,
          cadVersionId: p.ctx.versionId,
          chargeNote: '本次请求可能产生费用，费用由公司自己的账户承担。',
          previousResult: s.ledger.retryPrompt(task.idempotencyKey || ''),
          idempotencyKey: task.idempotencyKey,
          boundary: BOUNDARY_STATEMENTS,
        };
      }
      case 'confirmImageSubmission':
        return await p.confirmImageSubmission({
          approved: Boolean(input.approved),
          mode: input.mode === 'mock' ? 'mock' : 'real',
          capability: input.capability || 'imageGeneration',
        });
      case 'packageAndFinish':
        return await p.packageAndFinish();
      case 'redo':
        return await p.redo();
      /**
       * 对话改布局：把这一句话交给上游 Agent Loop，由它读图纸、改图纸。
       * 写动作，必须已确认（confirm 文案见渲染层 agentSend 的弹窗）。
       * `input.stub` 一律忽略 —— 渲染层没有权限要求走测试替身。
       */
      case 'agentSend': {
        const s = p._requireProject();
        const before = p.ctx.versionId;
        const turn = await this.agent.runTurn({
          projectId: p.ctx.projectId,
          versionId: before,
          text: String(input.text || ''),
        });
        if (turn.versionId && turn.versionId !== before) {
          // 有改动才落新版本：当前上下文指向新版本，旧版本原样保留。
          p.ctx.versionId = turn.versionId;
          p.ctx.versionDir = p.projectStore.versionDir(p.ctx.projectId, turn.versionId);
          if (s.gate && typeof s.gate.resetRemembered === 'function') s.gate.resetRemembered();
        }
        await s.audit.append({
          action: 'agent_send', target: p.ctx.versionId || null, result: 'allowed',
          detail: {
            changed: turn.changed,
            testDouble: turn.testDouble,
            fromVersion: before || null,
            toVersion: turn.versionId || null,
            steps: Array.isArray(turn.turns) ? turn.turns.length : 0,
          },
        });
        return {
          reply: turn.reply,
          activities: turn.activities,
          changed: turn.changed,
          testDouble: turn.testDouble,
          versionId: turn.versionId,
          versionCreated: Boolean(before && turn.versionId && turn.versionId !== before),
          changeNote: turn.changed
            ? '本次改动已写入一个新版本，旧版本的图纸与交付包完整保留。'
            : '模型没有改动图纸，本次没有新建版本。',
        };
      }
      /** 读这一版（当前版本）的对话记录，只读，不回写任何文件。 */
      case 'getChatHistory': {
        p._requireProject();
        const versionId = String(input.versionId || p.ctx.versionId || '');
        const history = await this.agent.history({
          projectId: p.ctx.projectId,
          versionId,
          limit: Number(input.limit) || undefined,
        });
        return { versionId, messages: history.messages };
      }
      case 'getVersions': {
        const s = p._requireProject();
        const project = await p.projectStore.get(p.ctx.projectId);
        const versions = [];
        for (const versionId of project.versions || []) {
          versions.push({ versionId, manifest: await p.projectStore.readManifest(p.ctx.projectId, versionId) });
        }
        return { versions, currentVersionId: project.currentVersionId };
      }
      case 'getVersionPreview': {
        // 只读：把某一版的预览内容读成文本 / 数据地址。
        // 绝对路径仅在 includePaths=true 时返回，那只有主进程（打开本地程序）会用。
        const s = p._requireProject();
        const versionId = String(input.versionId || p.ctx.versionId || '');
        if (!versionId) throw new Error('缺少版本编号');
        const dir = p.projectStore.versionDir(p.ctx.projectId, versionId);
        /** @param {string} name @returns {Promise<string|null>} */
        const pick = async (name) => {
          const full = path.join(dir, name);
          try {
            const stat = await fs.stat(full);
            return stat.isFile() ? full : null;
          } catch { return null; }
        };
        const svgPath = await pick('plan.svg');
        const pdfPath = await pick('plan.pdf');
        const dxfPath = await pick('plan.dxf');
        const drawingPath = await pick('drawing.opencalque');

        let svgText = null;
        if (svgPath) {
          const stat = await fs.stat(svgPath);
          if (stat.size <= 6 * 1024 * 1024) svgText = await fs.readFile(svgPath, 'utf8');
        }

        let imageDataUrl = null;
        const imageDir = path.join(dir, 'image');
        try {
          const names = (await fs.readdir(imageDir)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
          if (names.length > 0) {
            const full = path.join(imageDir, names[0]);
            const stat = await fs.stat(full);
            if (stat.size <= 12 * 1024 * 1024) {
              const ext = path.extname(names[0]).toLowerCase();
              const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
              imageDataUrl = `data:${mime};base64,${(await fs.readFile(full)).toString('base64')}`;
            }
          }
        } catch { /* 本版本无效果图 */ }

        const manifest = await p.projectStore.readManifest(p.ctx.projectId, versionId).catch(() => null);
        const files = input.includePaths === true
          ? { dxf: dxfPath, svg: svgPath, pdf: pdfPath, drawing: drawingPath }
          : { dxf: Boolean(dxfPath), svg: Boolean(svgPath), pdf: Boolean(pdfPath), drawing: Boolean(drawingPath) };

        return {
          versionId,
          versionDir: input.includePaths === true ? dir : undefined,
          svgText,
          imageDataUrl,
          imageSkippedReason: manifest?.image?.skippedReason || null,
          files,
        };
      }
      case 'exportDelivery': {
        let files = [];
        try { files = await fs.readdir(this.deliveriesDir); } catch { /* 尚无交付包 */ }
        const zips = files.filter((name) => name.toLowerCase().endsWith('.zip')).sort();
        return {
          available: zips.length > 0,
          paths: zips.map((name) => path.join(this.deliveriesDir, name)),
          note: zips.length === 0 ? '本版本尚未生成交付包' : '交付包不含任何密钥',
        };
      }
      default:
        throw new Error('操作未实现');
    }
  }

  /** 供冒烟脚本核对：桥接层暴露的工具清单与策略。 */
  describe() {
    return {
      tools: [...DESKTOP_TOOLS],
      confirmRequired: [...CONFIRM_REQUIRED],
      coreEntry: 'app/src/orchestrator/pipeline.mjs',
      reusedFromUpstream: [
        'Electron 44 桌面二进制（vendor/opencalque 已验证）',
        'apps/desktop/src/main/bridge.ts 的本地 HTTP 桥边界设计',
        'apps/desktop/src/main/index.ts:180-208 的 safeStorage 凭据存储',
        'apps/web/src/ai/{agent,compatible,types}.ts 的 Agent Loop / Provider（已装配为工具 agentSend）',
        'packages/core 的 7 个绘图工具与 parseDocument / applyOps / serializeDocument（已装配）',
      ],
      notReimplemented: ['对话循环', '会话状态机', 'Provider 抽象', '画布编辑器', 'DXF 读写器'],
    };
  }
}
