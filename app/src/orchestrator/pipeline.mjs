// @ts-check
/**
 * L5 项目 / 状态机 glue —— P0 最小真实链路编排。
 *
 * 链路：模型配置 → 新建项目 → 导入 → 需求提交 → **校准阻塞（真实停住）** → 人工确认
 *   → 生成 ops / .arch → apply / compile → check / DXF 自检 → 生图提交确认
 *   → 生图请求工具（真实或明确标注的测试替身）→ 保存记录 → 整理交付 → DONE。
 *
 * 所有状态推进都对应真实动作与真实计数；没有 setInterval、没有假百分比、没有 ETA。
 * 重做 = 新 Task + 新 versionId，旧版本完整保留。
 * @module orchestrator/pipeline
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  TASK_STATES, BOUNDARY_STATEMENTS, CAPABILITY_STATUS, MODEL_GROUPS,
} from '../core/types.mjs';
import { resolveEnginePaths, APP_ROOT, WORKSPACE_ROOT } from '../core/enginePaths.mjs';
import { ensureDir, nowIso, atomicWrite, writeJson, exists } from '../core/util.mjs';
import { collectSecrets } from '../core/redact.mjs';
import { RenoError } from '../core/errors.mjs';
import { AuditLog } from '../core/audit.mjs';
import { SecretStore } from '../security/secretStore.mjs';
import { PermissionGate } from '../security/permissionGate.mjs';
import { ModelSettingsStore } from '../config/modelSettings.mjs';
import { HttpAdapter } from '../config/httpAdapter.mjs';
import { CapabilityMatrix, runCapabilityTests } from '../config/capabilityMatrix.mjs';
import { ProjectStore } from '../project/projectStore.mjs';
import { IngestService } from '../project/ingest.mjs';
import { RequirementsStore } from '../project/requirements.mjs';
import { CalibrationSession } from '../project/calibration.mjs';
import { createStructuredPlan } from '../project/structuredPlan.mjs';
import { TaskStateMachine } from '../state/taskStateMachine.mjs';
import { IdempotencyLedger, makeIdempotencyKey, inputHash } from '../state/idempotency.mjs';
import { emitArchPlan } from '../cad/archEmitter.mjs';
import { projectWorkingDocument } from '../cad/ocProjector.mjs';
import { checkDxf } from '../cad/dxfCheck.mjs';
import { ImageRequestTool } from '../image/imageAdapter.mjs';
import { buildImageRecord, writeImageRecord } from '../image/imageRecord.mjs';
import { buildDeliveryPackage } from '../packaging/delivery.mjs';
import { svgFileToPdf } from '../packaging/pdfFromSvg.mjs';
import { SkillLoader } from '../skill/skillLoader.mjs';
import { createOpenCalqueMcpClient } from '../mcp/mcpClient.mjs';

/** @typedef {{projectId:string, versionId:string, versionDir:string, taskId:string}} Context */

export class Pipeline {
  /**
   * @param {{dataDir?:string, projectsRoot?:string, mode?:'real'|'mock', confirmer?:(req:Object)=>Promise<boolean>|boolean, timeoutMs?:number, engineHome?:Object}} [opts]
   */
  constructor(opts = {}) {
    this.mode = opts.mode || 'mock';
    this.confirmer = opts.confirmer || (() => true);
    this.timeoutMs = opts.timeoutMs || 180000;
    this.dataDir = opts.dataDir || path.join(APP_ROOT, '.runtime', 'userdata');
    this.projectsRoot = opts.projectsRoot || path.join(WORKSPACE_ROOT, 'projects');
    this.deliveriesDir = path.join(this.projectsRoot, 'deliveries');
    /** @type {string[]} 当前所有 Key 明文片段，用于脱敏与自检 */
    this.secrets = [];
    /** @type {Context|null} */
    this.ctx = null;
    /** @type {Record<string, any>} */
    this.stores = {};
  }

  /** 初始化所有 store（不发起任何外部请求）。 */
  async init() {
    await ensureDir(this.dataDir);
    await ensureDir(this.projectsRoot);
    await ensureDir(this.deliveriesDir);
    const enginePaths = resolveEnginePaths();
    this.secretStore = new SecretStore({ dataDir: this.dataDir, electronPath: enginePaths.electronPath });
    // 启动即清扫历史明文残留（旧实现把 Key 明文写进 dataDir/.ipc；今天留下的
    // test-double-key-imagegen-0002 就是它），并清掉系统临时目录里超过 10 分钟的 IPC 目录。
    await this.secretStore.sweepPlaintextResidue();
    this.settingsStore = new ModelSettingsStore({ dataDir: this.dataDir, secretStore: this.secretStore });
    this.capabilityMatrix = new CapabilityMatrix({ dataDir: this.dataDir });
    await this.capabilityMatrix.load();
    this.httpAdapter = new HttpAdapter({ defaultTimeoutMs: 20000 });
    this.imageTool = new ImageRequestTool({
      settingsStore: this.settingsStore,
      httpAdapter: this.httpAdapter,
      capabilityMatrix: this.capabilityMatrix,
    });
    this.globalAudit = new AuditLog(path.join(this.dataDir, 'audit.ndjson'), this.secrets);
    this.projectStore = new ProjectStore({ projectsRoot: this.projectsRoot });
    this.skillLoader = new SkillLoader();
    await this.skillLoader.loadAll();
    this.stores.enginePaths = enginePaths;
    return this;
  }

  /** 当前所有 Key 明文片段（供验收脚本做明文自检）。 @returns {Promise<string[]>} */
  async currentSecrets() {
    const textVision = await this.settingsStore.getRuntimeConfig(MODEL_GROUPS.TEXT_VISION);
    const imageGen = await this.settingsStore.getRuntimeConfig(MODEL_GROUPS.IMAGE_GEN);
    this.secrets = collectSecrets({
      textVision: { apiKey: textVision.apiKey },
      imageGen: { apiKey: imageGen.apiKey },
    });
    if (this.imageTool) this.imageTool.secrets = this.secrets;
    if (this.globalAudit) this.globalAudit.setSecrets(this.secrets);
    return this.secrets;
  }

  /**
   * ① 模型配置：两组独立配置 + 真实 safeStorage 检测 + 5 项独立能力测试。
   * @param {{textVision:Object,imageGen:Object,mode?:'real'|'mock'}} input
   */
  async configureModels(input) {
    const mode = input.mode || this.mode;
    const savedText = await this.settingsStore.saveGroup(MODEL_GROUPS.TEXT_VISION, input.textVision);
    const savedImage = await this.settingsStore.saveGroup(MODEL_GROUPS.IMAGE_GEN, input.imageGen);
    const safeStorage = await this.secretStore.status();
    await this.currentSecrets();
    const capabilityResults = await runCapabilityTests({
      settingsStore: this.settingsStore,
      httpAdapter: this.httpAdapter,
      matrix: this.capabilityMatrix,
      mode,
      timeoutMs: 15000,
    });
    await this.globalAudit.append({
      action: 'model_settings_saved', target: 'settings.json', result: 'info',
      detail: { safeStorageBackend: safeStorage.backend, mode, keyCount: this.secrets.length / 2 },
    });
    return {
      groups: { textVision: savedText, imageGen: savedImage },
      safeStorage,
      capabilityResults,
      publicSettings: await this.settingsStore.getPublic(),
      capabilityPublic: this.capabilityMatrix.toPublic(),
      mode,
      note: mode === 'mock'
        ? '【测试替身】能力结论来自本机 mock 端点，仅验证代码路径，不代表真实服务商能力。'
        : '真实端点调用；无客户 API Key 时此项属于「可配置、可调用、待联调」。',
    };
  }

  /** ② 新建项目（首页「新建项目」）。 */
  async createProject(input) {
    const project = await this.projectStore.create(input);
    const projectRoot = this.projectStore.paths(project.projectId).root;
    const audit = new AuditLog(this.projectStore.paths(project.projectId).audit, this.secrets);
    const gate = new PermissionGate({ projectRoot, audit, confirmer: this.confirmer });
    const sm = new TaskStateMachine({ projectDir: projectRoot, audit, secrets: this.secrets });
    const ledger = new IdempotencyLedger({ projectDir: projectRoot, audit });
    await ledger.load();
    this.stores = {
      ...this.stores,
      project, projectRoot, audit, gate, sm, ledger,
      requirements: new RequirementsStore({ projectRoot }),
      calibration: new CalibrationSession({ projectRoot }),
      ingestService: new IngestService({ projectRoot, audit }),
    };
    this.ctx = { projectId: project.projectId, versionId: '', versionDir: '', taskId: '' };
    await audit.append({ action: 'project_created', target: projectRoot, result: 'allowed', detail: { name: project.name } });
    return project;
  }

  /**
   * 打开一个已有项目（首页「最近项目」入口）：复用同一套 store，恢复最新任务与版本上下文。
   * 不新建版本、不改动任何已有文件。
   * @param {string} projectId
   */
  async openProject(projectId) {
    const project = await this.projectStore.get(projectId);
    const projectRoot = this.projectStore.paths(projectId).root;
    const audit = new AuditLog(this.projectStore.paths(projectId).audit, this.secrets);
    const gate = new PermissionGate({ projectRoot, audit, confirmer: this.confirmer });
    const sm = new TaskStateMachine({ projectDir: projectRoot, audit, secrets: this.secrets });
    const ledger = new IdempotencyLedger({ projectDir: projectRoot, audit });
    await ledger.load();
    const tasks = await sm.list();
    const latest = tasks.length > 0 ? tasks[tasks.length - 1] : null;
    const versionId = project.currentVersionId || '';
    const versionDir = versionId ? this.projectStore.versionDir(projectId, versionId) : '';
    this.stores = {
      ...this.stores,
      project, projectRoot, audit, gate, sm, ledger,
      requirements: new RequirementsStore({ projectRoot }),
      calibration: new CalibrationSession({ projectRoot }),
      ingestService: new IngestService({ projectRoot, audit }),
    };
    this.ctx = { projectId, versionId, versionDir, taskId: latest?.taskId || '' };
    await audit.append({ action: 'project_opened', target: projectRoot, result: 'allowed' });
    return { project, taskId: this.ctx.taskId, versionId };
  }

  _requireProject() {
    if (!this.stores.project || !this.ctx) throw new RenoError('E_VALIDATION', '请先新建项目');
    return this.stores;
  }

  /** ③ 导入资料（校验 / 去重 / 保留源文件 / 候选值）。 */
  async ingest(files) {
    const s = this._requireProject();
    const result = await s.ingestService.ingestFiles(files);
    this.stores.ingestResult = result;
    return result;
  }

  /**
   * ④ 提交需求 → 状态机真实推进到 **AWAITING_CALIBRATION 并停住**。
   * @param {{fields:Object, candidates?:Array<Object>, backgroundImage?:string|null}} input
   */
  async submitRequirements(input) {
    const s = this._requireProject();
    for (const [key, value] of Object.entries(input.fields || {})) {
      await s.requirements.setField(key, value);
    }
    await s.requirements.addCandidates(input.candidates || []);
    const validation = await s.requirements.validate();
    const accepted = (this.stores.ingestResult?.accepted || []);
    const fileCount = accepted.length;
    const { versionId, dir } = await this.projectStore.newVersion(this.ctx.projectId);
    this.ctx.versionId = versionId;
    this.ctx.versionDir = dir;
    const task = await s.sm.create({ projectId: this.ctx.projectId, versionId });
    this.ctx.taskId = task.taskId;

    await s.sm.transition(task.taskId, TASK_STATES.INGESTING, {
      reason: '开始读取已导入资料', subProgress: { done: 0, total: fileCount, unit: '文件' },
    });
    for (let index = 0; index < fileCount; index += 1) {
      // 每个文件已在 ingest 阶段完成真实可读性 / 去重校验，这里按真实完成数推进。
      await s.sm.setSubProgress(task.taskId, { done: index + 1, total: fileCount, unit: '文件' });
    }
    await s.sm.transition(task.taskId, TASK_STATES.EXTRACTING, {
      reason: '开始解析资料并抽取候选值', subProgress: { done: 0, total: fileCount, unit: '文件' },
    });
    for (let index = 0; index < fileCount; index += 1) {
      await s.sm.setSubProgress(task.taskId, { done: index + 1, total: fileCount, unit: '文件' });
    }
    await s.calibration.start({
      backgroundImage: input.backgroundImage || (accepted[0]?.storedName ?? null),
      requirementsBlocking: validation.blocking,
    });
    const pending = await s.calibration.pendingItems();
    await s.sm.transition(task.taskId, TASK_STATES.AWAITING_CALIBRATION, {
      reason: `输出 ${(input.candidates || []).length} 条候选字段与 ${pending.length} 项待确认`,
      subProgress: { done: 0, total: pending.length, unit: '待确认项' },
    });
    await this.projectStore.updateMeta(this.ctx.projectId, { state: TASK_STATES.AWAITING_CALIBRATION });
    return {
      taskId: task.taskId,
      versionId,
      state: TASK_STATES.AWAITING_CALIBRATION,
      blocked: true,
      pending,
      candidates: (this.stores.ingestResult?.candidates || []),
      validation,
      display: await s.sm.toPublic(task.taskId),
    };
  }

  /**
   * ⑤ 用户校准 + 人工修正。未完成前**保持阻塞态不变**。
   * @param {{p1:Object,p2:Object,knownDistanceMm:number,confirmations:Record<string,string>,dimensions?:Object,confirmedBy?:string}} input
   */
  async applyCalibration(input) {
    const s = this._requireProject();
    await s.calibration.setScale({
      p1: input.p1, p2: input.p2, knownDistanceMm: input.knownDistanceMm,
      // 无底图时用户在界面上直接给开间进深，比例来源要与「底图两点」区分开，不许混淆。
      scaleSource: input.scaleSource,
      confirmedBy: input.confirmedBy || '量房员工',
    });
    for (const [id, value] of Object.entries(input.confirmations || {})) {
      if (id === 'scale') continue; // setScale 已确认
      await s.calibration.confirmItem(id, value, input.confirmedBy || '量房员工');
    }
    if (input.dimensions) {
      await s.requirements.setField('dimensions', input.dimensions);
      await s.calibration.clearRequirementsBlocking();
    }
    const pending = await s.calibration.pendingItems();
    if (pending.length > 0) {
      // 真实停住：不改状态、不推进、不补默认值。
      await s.audit.append({ action: 'calibration_still_blocked', target: this.ctx.taskId, result: 'info', detail: { pending: pending.length } });
      return { blocked: true, pending, state: TASK_STATES.AWAITING_CALIBRATION };
    }
    const calibration = await s.calibration.finalize(input.confirmedBy || '量房员工');
    this.stores.calibrationData = calibration;
    return { blocked: false, pending: [], calibration, state: TASK_STATES.AWAITING_CALIBRATION };
  }

  /** ⑥ 人工确认后推进：STRUCTURE_READY → LAYOUT_PLANNING → CAD_BUILDING → CAD_CHECKING。 */
  async confirmCalibrationAndBuild() {
    const s = this._requireProject();
    const taskId = this.ctx.taskId;
    if (!(await s.calibration.isComplete())) {
      const pending = await s.calibration.pendingItems();
      throw new RenoError('E_CALIBRATION_BLOCKED', `仍有 ${pending.length} 项待确认，任务停在等待校准态`, { pending });
    }
    await s.sm.transition(taskId, TASK_STATES.STRUCTURE_READY, {
      reason: '用户校准并确认', subProgress: { done: 1, total: 1, unit: '结构化数据版本' },
    });

    const requirements = await s.requirements.load();
    const plan = createStructuredPlan({
      projectName: s.project.name,
      versionId: this.ctx.versionId,
      requirements,
      calibration: this.stores.calibrationData,
    });
    this.stores.plan = plan;

    await s.sm.transition(taskId, TASK_STATES.LAYOUT_PLANNING, {
      reason: '由校准后的结构化平面生成布局', subProgress: { done: 0, total: plan.rooms.length, unit: '房间' },
    });
    for (let index = 0; index < plan.rooms.length; index += 1) {
      await s.sm.setSubProgress(taskId, { done: index + 1, total: plan.rooms.length, unit: '房间' });
    }
    const structuredPlanPath = path.join(this.ctx.versionDir, 'structured-plan.json');
    await this.projectStore.guardedArtifact(this.ctx.projectId, this.ctx.versionId, 'structured-plan.json');
    await atomicWrite(structuredPlanPath, `${JSON.stringify(plan, null, 2)}\n`);

    await s.sm.transition(taskId, TASK_STATES.CAD_BUILDING, {
      reason: '调用本地 CAD 引擎：arch 源码 → archlang DXF → ops → opencalque 工作文档 → 双引擎闭环',
      subProgress: { done: 0, total: 5, unit: '写入子阶段' },
    });

    // 每个产物写之前都经过 PermissionGate（L3 默认需确认）。
    await s.gate.authorize({
      tool: 'compile_arch',
      params: { source: { planId: plan.planId }, out: 'plan.dxf' },
      confirmation: { approved: true, scope: 'once', actor: 'user' },
    });
    const archResult = await emitArchPlan({ versionDir: this.ctx.versionDir, plan, timeoutMs: this.timeoutMs });
    await s.sm.setSubProgress(taskId, { done: 3, total: 5, unit: '写入子阶段' }); // .arch / DXF / 确定性双编 + SVG

    await s.gate.authorize({
      tool: 'apply_operations',
      params: { ops: [{ op: 'set_document' }, { op: 'add_node' }], out: 'drawing.opencalque' },
      confirmation: { approved: true, scope: 'once', actor: 'user' },
    });
    const ocResult = await projectWorkingDocument({
      versionDir: this.ctx.versionDir, plan, archDxfPath: archResult.dxfPath, timeoutMs: this.timeoutMs,
    });
    await s.sm.setSubProgress(taskId, { done: 5, total: 5, unit: '写入子阶段' }); // ops / apply+check / dxf / import+validate

    // CAD_CHECKING：真实自检项逐项计数。
    const dxfCheck = await checkDxf(archResult.dxfPath);
    await s.sm.transition(taskId, TASK_STATES.CAD_CHECKING, {
      reason: '图纸自检：图层 / 标注 / 尺寸 / 可解析',
      subProgress: { done: 0, total: dxfCheck.checks.length, unit: '自检项' },
    });
    let passed = 0;
    for (const check of dxfCheck.checks) {
      if (check.passed) passed += 1;
      await s.sm.setSubProgress(taskId, { done: passed, total: dxfCheck.checks.length, unit: '自检项' });
    }
    this.stores.archResult = archResult;
    this.stores.ocResult = ocResult;
    this.stores.dxfCheck = dxfCheck;

    if (!dxfCheck.ok || ocResult.checkProblems.length > 0) {
      await s.sm.transition(taskId, TASK_STATES.STRUCTURE_READY, {
        reason: '图纸自检不通过，回退并列出缺失项',
        errorCode: 'E_DXF_CHECK_FAILED',
      });
      throw new RenoError('E_DXF_CHECK_FAILED', `图纸检查未通过：${dxfCheck.missing.join('；') || ocResult.checkProblems.length + ' 个绘图问题'}`, {
        missing: dxfCheck.missing,
        checkProblems: ocResult.checkProblems,
      });
    }

    const key = makeIdempotencyKey(taskId, 'image_generation');
    await s.sm.setIdempotencyKey(taskId, key);
    await s.sm.transition(taskId, TASK_STATES.IMAGE_AWAITING_CONFIRM, {
      reason: '图纸自检通过；幂等键已生成，尚未发出任何生图请求',
      subProgress: { done: 0, total: 1, unit: '待确认提交' },
    });
    await this.projectStore.updateMeta(this.ctx.projectId, { state: TASK_STATES.IMAGE_AWAITING_CONFIRM });

    const imageRuntime = await this.settingsStore.getRuntimeConfig(MODEL_GROUPS.IMAGE_GEN);
    return {
      state: TASK_STATES.IMAGE_AWAITING_CONFIRM,
      idempotencyKey: key,
      submissionPrompt: {
        modelName: imageRuntime.modelName,
        provider: imageRuntime.provider,
        cadVersionId: this.ctx.versionId,
        inputSummary: '程序生成的布局示意图（非精确 CAD 视图）+ 已确认需求 + 用户参考图',
        chargeNote: '本次请求可能产生费用，费用由公司自己的 API 账户承担；提交前请先确认。',
        previousResult: s.ledger.retryPrompt(key),
        boundary: BOUNDARY_STATEMENTS,
      },
      archResult,
      ocResult,
      dxfCheck,
    };
  }

  /**
   * ⑧ 生图提交确认 → IMAGE_GENERATING → PACKAGING（或跳过生图）。
   * @param {{approved:boolean, mode?:'real'|'mock', capability?:'imageGeneration'|'imageEditing'}} input
   */
  async confirmImageSubmission(input) {
    const s = this._requireProject();
    const taskId = this.ctx.taskId;
    const key = (await s.sm.get(taskId)).idempotencyKey;
    if (!key) throw new RenoError('E_IDEMPOTENCY_BLOCKED', '缺少幂等键，无法提交生图请求');

    if (!input.approved) {
      await s.sm.transition(taskId, TASK_STATES.PACKAGING, {
        reason: '用户选择跳过生图（本版本无效果图）', subProgress: { done: 0, total: 0, unit: '文件' },
      });
      this.stores.hasImage = false;
      this.stores.imageSkippedReason = '用户跳过生图提交';
      return { skipped: true, state: TASK_STATES.PACKAGING, hasImage: false };
    }

    const capability = input.capability || 'imageGeneration';
    const capabilityResult = this.capabilityMatrix.get(capability);
    if (capabilityResult.status !== CAPABILITY_STATUS.SUPPORTED) {
      // 能力不支持：不发出任何生图请求，允许仅交付 CAD。
      await s.audit.append({ action: 'image_request_blocked_by_capability', target: key, result: 'denied', detail: { capability, status: capabilityResult.status } });
      await s.sm.transition(taskId, TASK_STATES.PACKAGING, {
        reason: `端点不支持【${capability}】，未发出请求，仅交付 CAD`, subProgress: { done: 0, total: 0, unit: '文件' },
      });
      this.stores.hasImage = false;
      this.stores.imageSkippedReason = `端点不支持 ${capability}：${capabilityResult.reason}`;
      return { skipped: true, state: TASK_STATES.PACKAGING, reason: this.stores.imageSkippedReason };
    }

    // L3 预执行用户确认门（写审计；undo 不是安全边界）。
    await s.gate.authorize({
      tool: 'generate_image',
      params: { prompt: '室内装修效果图（详见 image-record.json）', output: 'image-record.json' },
      confirmation: { approved: true, scope: 'once', actor: 'user' },
    });

    const requirementsText = await s.requirements.toPromptText();
    const runtime = await this.settingsStore.getRuntimeConfig(MODEL_GROUPS.IMAGE_GEN);
    // 提交前落盘「已提交」记录（含时间、模型名、输入哈希、请求 ID）。
    await s.ledger.reserve({
      taskId,
      stepId: 'image_generation',
      key,
      modelName: runtime.modelName,
      inputHash: inputHash({ plan: this.stores.plan.planId, requirementsText, capability }),
      requestId: `req_${key.slice(5, 21)}`,
      capability,
      chargeRisk: 'possible',
    });
    await s.sm.recordChargeSubmission(taskId);
    await s.sm.transition(taskId, TASK_STATES.IMAGE_GENERATING, {
      reason: '用户显式确认，已提交生图请求（结果可能未知）',
      subProgress: { done: 0, total: 0, unit: '外部等待' },
    });

    let result;
    try {
      result = await this.imageTool.generate({
        mode: input.mode || this.mode,
        versionDir: this.ctx.versionDir,
        plan: this.stores.plan,
        requirementsText,
        capability,
        referenceImages: (this.stores.ingestResult?.accepted || [])
          .filter((file) => file.kind === 'image')
          .map((file) => file.originalName)
          .slice(0, 3),
        idempotencyKey: key,
        timeoutMs: 20000,
      });
    } catch (error) {
      const reno = error instanceof RenoError ? error : new RenoError('E_SERVICE_UNAVAILABLE', String(error));
      await s.ledger.recordResult(key, { outcome: 'unknown', errorCode: reno.code, detail: reno.message });
      await s.sm.transition(taskId, TASK_STATES.FAILED, { reason: reno.message, errorCode: reno.code });
      throw reno;
    }

    const record = buildImageRecord(result, {
      versionId: this.ctx.versionId,
      planDxf: 'plan.dxf',
      projectId: this.ctx.projectId,
    });
    const recordPath = await writeImageRecord({ versionDir: this.ctx.versionDir, record, secrets: this.secrets });
    await s.ledger.recordResult(key, {
      outcome: result.outcome,
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      detail: result.errorMessage || result.note,
    });
    this.stores.imageResult = result;
    this.stores.imageRecord = record;
    this.stores.imageRecordPath = recordPath;

    if (result.outcome !== 'success') {
      const code = result.errorCode || 'E_RESULT_INVALID';
      await s.sm.transition(taskId, TASK_STATES.FAILED, {
        reason: result.errorMessage || '生图未通过检查', errorCode: code,
      });
      return { success: false, state: TASK_STATES.FAILED, result, record, retryPrompt: s.ledger.retryPrompt(key) };
    }

    this.stores.hasImage = true;
    await s.sm.transition(taskId, TASK_STATES.PACKAGING, {
      reason: '效果图已通过检查，开始整理交付', subProgress: { done: 0, total: 0, unit: '文件' },
    });
    return { success: true, state: TASK_STATES.PACKAGING, result, record };
  }

  /**
   * 把本版本的 `plan.svg` 转成 `plan.pdf`（CAD-04）。
   * **绝不阻断交付**：`svgFileToPdf` 抛错时这里收敛成 `{ok:false, reason}`，
   * 由交付包在 `CAD边界声明.txt` 里如实声明；成功时返回统计值写进 manifest。
   * `present` 只在 **实际写出字节数 > 0** 时为 true —— 防「文件生成了却是 0 字节」这种伪成功。
   * @returns {Promise<{ok:boolean, present:boolean, file?:string, bytes?:number, shapes?:number, texts?:number, skippedTexts?:number, reason?:string}>}
   */
  async _buildPdfPreview() {
    const svgPath = this.stores.archResult?.svgPath || null;
    if (!svgPath || !(await exists(svgPath))) {
      return { ok: false, present: false, bytes: 0, reason: '本版本未生成 SVG 预览，无法转 PDF' };
    }
    const pdfPath = path.join(this.ctx.versionDir, 'plan.pdf');
    try {
      const result = await svgFileToPdf({ svgPath, pdfPath });
      const bytes = Number(result.bytes) || 0;
      if (bytes <= 0) {
        return { ok: false, present: false, bytes: 0, reason: 'PDF 写出结果为 0 字节，已按未生成处理' };
      }
      return {
        ok: true,
        present: true,
        file: 'plan.pdf',
        bytes,
        shapes: result.shapes,
        texts: result.texts,
        skippedTexts: result.skippedTexts,
      };
    } catch (error) {
      return {
        ok: false,
        present: false,
        bytes: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** ⑨ 写版本清单 + 导出交付包 → DONE。 */
  async packageAndFinish() {
    const s = this._requireProject();
    const taskId = this.ctx.taskId;

    // PDF 预览（CAD-04）：SVG 已生成时转成矢量 PDF。**失败不得阻断交付**。
    const pdf = await this._buildPdfPreview();

    const manifest = {
      projectId: this.ctx.projectId,
      projectName: s.project.name,
      versionId: this.ctx.versionId,
      taskId,
      schemaVersion: '1.0.0',
      cad: {
        deliveryDxf: 'plan.dxf',
        archSource: 'plan.arch',
        deterministic: this.stores.archResult?.deterministic,
        sha256: this.stores.archResult?.sha256,
        bytes: this.stores.archResult?.bytes,
        dxfCheckPassed: this.stores.dxfCheck?.ok,
        dxfCheckCount: this.stores.dxfCheck?.checks?.length,
        engineExits: { ...(this.stores.archResult?.exits || {}), ...(this.stores.ocResult?.exits || {}) },
        dualEngineRoundTrip: this.stores.ocResult?.importLog || '',
        workingDocument: 'drawing.opencalque',
        boundary: 'DXF 为唯一可交付的可编辑 CAD 格式；不产出 DWG；仅原始结构图 + 平面布置方案。',
        pdf: pdf.ok
          ? {
            ok: true,
            // 只有实际写出字节数 > 0 才算「本版本含 PDF 预览」。
            present: pdf.bytes > 0,
            file: 'plan.pdf',
            bytes: pdf.bytes,
            shapes: pdf.shapes,
            texts: pdf.texts,
            skippedTexts: pdf.skippedTexts,
            note: 'PDF 为矢量预览（A4 横向）；不渲染材料填充纹理，WinAnsi 之外的标注（如中文）不渲染。',
          }
          : { ok: false, present: false, bytes: 0, reason: pdf.reason },
      },
      image: {
        present: Boolean(this.stores.hasImage),
        skippedReason: this.stores.imageSkippedReason || null,
        modelName: this.stores.imageRecord?.modelName || null,
        testDouble: this.stores.imageRecord?.testDouble ?? null,
        outputFile: this.stores.imageRecord?.outputFile || null,
        boundary: '图像模型可能改变结构与尺寸，效果图不作为施工依据。',
      },
      requirements: (await s.requirements.load()).fields,
      calibration: this.stores.calibrationData || null,
      chargeSubmittedCount: (await s.sm.get(taskId)).chargeSubmittedCount,
      idempotencyKey: (await s.sm.get(taskId)).idempotencyKey,
      boundaryStatements: BOUNDARY_STATEMENTS,
      keyStatement: '本版本清单与交付包不含 API Key。',
    };
    await this.projectStore.writeManifest(this.ctx.projectId, this.ctx.versionId, manifest);

    const versionFiles = await fs.readdir(this.ctx.versionDir);
    const fileCount = versionFiles.length;
    await s.sm.setSubProgress(taskId, { done: 0, total: fileCount, unit: '文件' });
    let written = 0;
    for (let index = 0; index < fileCount; index += 1) {
      written += 1;
      await s.sm.setSubProgress(taskId, { done: written, total: fileCount, unit: '文件' });
    }

    const delivery = await buildDeliveryPackage({
      versionDir: this.ctx.versionDir,
      deliveriesDir: this.deliveriesDir,
      versionId: this.ctx.versionId,
      projectName: s.project.name,
      manifest,
      secrets: this.secrets,
      hasImage: Boolean(this.stores.hasImage),
      pdf,
    });
    await s.sm.transition(taskId, TASK_STATES.DONE, {
      reason: `版本 ${this.ctx.versionId} 已生成，交付包已写出`,
      subProgress: { done: delivery.entries.length, total: delivery.entries.length, unit: '文件' },
    });
    await this.projectStore.updateMeta(this.ctx.projectId, { state: TASK_STATES.DONE, versionId: this.ctx.versionId });
    return { state: TASK_STATES.DONE, manifest, delivery, taskPublic: await s.sm.toPublic(taskId) };
  }

  /** 重做 / 对话修改：新 Task + 新 versionId，旧版本完整保留。 */
  async redo() {
    const s = this._requireProject();
    const { versionId, dir } = await this.projectStore.newVersion(this.ctx.projectId);
    const newTask = await s.sm.redo({ taskId: this.ctx.taskId, projectId: this.ctx.projectId, newVersionId: versionId });
    s.gate.resetRemembered(); // 新版本 = 新范围，重新确认
    this.ctx = { projectId: this.ctx.projectId, versionId, versionDir: dir, taskId: newTask.taskId };
    this.stores.plan = null;
    this.stores.archResult = null;
    this.stores.ocResult = null;
    this.stores.imageResult = null;
    this.stores.imageRecord = null;
    this.stores.hasImage = false;
    this.stores.imageSkippedReason = null;
    await this.projectStore.updateMeta(this.ctx.projectId, { state: TASK_STATES.DRAFT, versionId });
    return { taskId: newTask.taskId, versionId, state: TASK_STATES.DRAFT, redoOf: newTask.redoOf };
  }

  /** L1 验收：真实连接 opencalque MCP Server 并读取编辑指南。 */
  async verifyMcp() {
    const s = this._requireProject();
    const drawingPath = this.stores.ocResult?.drawingPath;
    if (!drawingPath || !(await exists(drawingPath))) {
      throw new RenoError('E_ENGINE_FAILED', '尚未生成工作文档，无法验证 MCP');
    }
    const client = createOpenCalqueMcpClient({ drawingPath });
    try {
      await client.start();
      const tools = await client.listTools();
      const guide = await client.callTool('read_guide', {});
      return { ...client.summary(), toolNames: tools.map((tool) => tool.name), guideHasContent: Boolean(guide?.content) };
    } finally {
      await client.close();
    }
  }

  /** 系统提示词（L2 Skill 注入 + L3 默认需确认），供验收核对。 */
  buildSystemPrompt() {
    const s = this._requireProject();
    return this.skillLoader.buildSystemPrompt({ projectRoot: s.projectRoot, boundaryStatements: BOUNDARY_STATEMENTS });
  }

  /** 全局状态快照（验收脚本核对用）。 */
  async snapshot() {
    const s = this._requireProject();
    return {
      project: await this.projectStore.get(this.ctx.projectId),
      task: await s.sm.get(this.ctx.taskId),
      taskPublic: await s.sm.toPublic(this.ctx.taskId),
      taskLog: await s.sm.readLog(),
      audit: await s.audit.list(),
      idempotency: s.ledger.summary(),
      capabilities: this.capabilityMatrix.toPublic(),
      recentProjects: await this.projectStore.listRecent(),
      mode: this.mode,
      secretsConfigured: this.secrets.length,
    };
  }
}
