// @ts-check
/**
 * QA 独立行为探针（由 acceptance.mjs 以独立子进程 spawn，主脚本本身不 import app/ 模块）。
 *
 * 目的：QA 自行构造攻击向量 / 场景，通过产品**公开导出的模块接口**触发真实行为，
 * 观察返回值与落盘审计，而不是只读源码或只信任工程师自己的验收报告。
 *
 * 输出：<outDir>/runtime-probe.json
 * 用法：node qa/lib/probe-runtime.mjs <appDir> <outDir>
 *
 * 注意：这是【灰盒集成行为探针】，与【静态源码审查】【产物检查】严格区分，
 * 三者都在 REPORT.md 中单独标注，不互相冒充。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = process.argv[2];
const outDir = process.argv[3];
const result = {
  ok: false,
  mode: '真实行为调用·产品公开模块接口（QA 独立构造输入）',
  startedAt: new Date().toISOString(),
  errors: [],
  boundary: null,
  idempotency: null,
  stateMachine: null,
  calibration: null,
};

/** @param {string} rel */
function mod(rel) {
  return pathToFileURL(path.join(appDir, rel)).href;
}
function chinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

async function runBoundary() {
  const gateMod = await import(mod('src/security/permissionGate.mjs'));
  const auditMod = await import(mod('src/core/audit.mjs'));
  const { PermissionGate, TOOL_ALLOWLIST, EXPLICITLY_FORBIDDEN, READ_ONLY_TOOLS, CONTROLLED_TOOLS } = gateMod;
  const { AuditLog } = auditMod;

  const sandbox = path.join(outDir, 'boundary-sandbox');
  const outside = path.join(outDir, 'boundary-outside');
  // 探针必须可重复运行：审计日志是 append 写入，沙盒不清空会导致跨轮累积。
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  const auditFile = path.join(sandbox, 'audit.ndjson');
  try { await fsp.unlink(auditFile); } catch { /* 不存在 */ }

  const audit = new AuditLog(auditFile, []);
  // 默认 confirmer = () => false：任何需要确认的操作都不得静默放行。
  const gate = new PermissionGate({ projectRoot: sandbox, audit });

  // 符号链接逃逸：在项目内建一个指向项目外的链接（Windows 用 junction，无需管理员）。
  let symlink = { created: false, reason: '' };
  const linkPath = path.join(sandbox, 'outside-link');
  try {
    await fsp.symlink(outside, linkPath, 'junction');
    symlink = { created: true, reason: 'junction 创建成功' };
  } catch (error) {
    symlink = { created: false, reason: String(error?.message || error) };
  }

  /** 覆盖任务①要求的全部越权类型。 */
  const vectors = [
    { id: 'V01', kind: '项目路径外读', tool: 'read_file_any', params: { path: 'C:/Windows/win.ini' } },
    { id: 'V02', kind: '项目路径外写', tool: 'export_dxf', params: { out: 'C:/Windows/System32/qa-evil.dxf' } },
    { id: 'V03', kind: '任意系统命令', tool: 'system_run_command', params: { command: 'whoami' } },
    { id: 'V04', kind: '任意脚本', tool: 'run_script', params: { script: 'console.log(1)' } },
    { id: 'V05', kind: '任意 Lisp 脚本', tool: 'system_run_lisp', params: { code: '(command "_.QUIT")' } },
    { id: 'V06', kind: '未受控绝对路径', tool: 'export_svg', params: { out: 'D:/qa-absolute.svg' } },
    { id: 'V07', kind: '.. 目录逃逸', tool: 'export_dxf', params: { out: '../../../../qa-escape.dxf' } },
    { id: 'V08', kind: 'UNC 路径', tool: 'import_dxf', params: { path: '\\\\server\\share\\a.dxf' } },
    { id: 'V09', kind: 'ADS 备用数据流', tool: 'import_dxf', params: { path: 'plan.dxf:hidden' } },
    { id: 'V10', kind: '符号链接逃逸', tool: 'export_dxf', params: { out: 'outside-link/qa-evil.dxf' } },
    { id: 'V11', kind: '未登记工具', tool: 'qa_totally_unregistered_tool', params: {} },
    { id: 'V12', kind: '危险参数键', tool: 'apply_operations', params: { ops: [{ op: 'add_node', command: 'calc.exe' }] } },
    { id: 'V13', kind: '危险后缀', tool: 'export_dxf', params: { out: 'qa-evil.exe' } },
    { id: 'V14', kind: '非 mm 单位', tool: 'write_structured_plan', params: { plan: {}, unit: 'cm' } },
  ];

  const outcomes = [];
  for (const v of vectors) {
    let denied = false;
    let code = null;
    let message = '';
    try {
      await gate.authorize({ tool: v.tool, params: v.params, actor: 'qa-probe' });
      message = '(未抛错：被放行)';
    } catch (error) {
      denied = true;
      code = error?.code || null;
      message = String(error?.message || error);
    }
    outcomes.push({ id: v.id, kind: v.kind, tool: v.tool, denied, code, message, chinese: chinese(message) });
  }

  // 审计留痕：每条向量都应有 denied 记录，且 reason 为中文。
  const auditLines = (await fsp.readFile(auditFile, 'utf8')).split(/\r?\n/).filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  const deniedRecords = auditLines.filter((r) => r.result === 'denied');

  // 确认门不得静默放行：合法受控工具在无确认时应被拒。
  let noConfirmDenied = false;
  let explicitConfirmAllowed = false;
  try {
    await gate.authorize({ tool: 'export_dxf', params: { out: 'plan.dxf' }, actor: 'qa-probe' });
  } catch (error) {
    noConfirmDenied = chinese(error?.message || error);
  }
  try {
    const r = await gate.authorize({
      tool: 'export_dxf', params: { out: 'plan.dxf' }, actor: 'qa-probe',
      confirmation: { approved: true, scope: 'once', actor: 'qa-user' },
    });
    explicitConfirmAllowed = r?.allowed === true;
  } catch { explicitConfirmAllowed = false; }

  // 逃逸工具名不得出现在允许清单中（正向白名单，不是黑名单）。
  const forbiddenNames = ['system_run_command', 'system_run_lisp', 'run_script', 'exec', 'spawn', 'shell', 'eval'];
  const allowlist = [...TOOL_ALLOWLIST];
  const leaksInAllowlist = allowlist.filter((t) => forbiddenNames.some((f) => String(t).includes(f)));

  return {
    sandbox, auditFile, symlink,
    vectors: outcomes,
    total: outcomes.length,
    deniedCount: outcomes.filter((o) => o.denied).length,
    chineseHintCount: outcomes.filter((o) => o.denied && o.chinese).length,
    auditDeniedRecords: deniedRecords.length,
    auditChineseReasons: deniedRecords.filter((r) => chinese(r.detail?.reason)).length,
    noConfirmDenied,
    explicitConfirmAllowed,
    allowlistSize: allowlist.length,
    leaksInAllowlist,
    explicitlyForbidden: [...EXPLICITLY_FORBIDDEN],
    readOnlyTools: [...READ_ONLY_TOOLS],
    controlledTools: [...CONTROLLED_TOOLS],
  };
}

async function runIdempotency() {
  const idemMod = await import(mod('src/state/idempotency.mjs'));
  const { IdempotencyLedger, makeIdempotencyKey, inputHash } = idemMod;
  const dir = path.join(outDir, 'idempotency-sandbox');
  await fsp.rm(dir, { recursive: true, force: true }); // 探针必须可重复运行
  await fsp.mkdir(dir, { recursive: true });
  const ledger = new IdempotencyLedger({ projectDir: dir });
  await ledger.load();

  const taskId = 'qa_task_timeout_01';
  const stepId = 'image_generation';
  const key = makeIdempotencyKey(taskId, stepId);
  const hash = inputHash({ plan: 'qa-plan', prompt: 'qa-prompt' });

  // 提交前落盘（write-ahead）。注意 reserve() 返回的是账本内对象引用，
  // 后续 recordResult 会原地改写它；因此必须立即做深拷贝快照，避免断言失真。
  const reservedLive = await ledger.reserve({
    taskId, stepId, key, modelName: 'qa-mock-image', inputHash: hash,
    requestId: 'qa_req_1', capability: 'imageGeneration', chargeRisk: 'possible',
  });
  const reserved = JSON.parse(JSON.stringify(reservedLive));
  const fileAfterReserve = fs.existsSync(path.join(dir, 'idempotency.json'));
  const persistedBeforeHttp = JSON.parse(await fsp.readFile(path.join(dir, 'idempotency.json'), 'utf8'));

  // 模拟超时 → 结果未知
  await ledger.recordResult(key, { outcome: 'unknown', errorCode: 'E_TIMEOUT_UNKNOWN', detail: '请求超时，结果未知' });
  const canSubmitAfterUnknown = ledger.canSubmit({ taskId, stepId });
  const retryPrompt = ledger.retryPrompt(key);
  let explicitRetryBlocked = false;
  let explicitRetryMessage = '';
  try {
    await ledger.explicitRetry({ previousKey: key, taskId, stepId, modelName: 'qa-mock-image', inputHash: hash, capability: 'imageGeneration' });
  } catch (error) {
    explicitRetryBlocked = true;
    explicitRetryMessage = String(error?.message || error);
  }
  const summaryAfterUnknown = ledger.summary();
  const recordCountAfter = Object.keys(ledger.records).length;

  // 重复提交同一 key 应被拒
  let duplicateBlocked = false;
  try {
    await ledger.reserve({ taskId, stepId, key, modelName: 'qa-mock-image', inputHash: hash, requestId: 'qa_req_2', capability: 'imageGeneration', chargeRisk: 'possible' });
  } catch { duplicateBlocked = true; }

  // 明确失败 → 仅用户显式重试才建新键
  const key2 = makeIdempotencyKey('qa_task_failed_02', stepId);
  await ledger.reserve({ taskId: 'qa_task_failed_02', stepId, key: key2, modelName: 'qa-mock-image', inputHash: hash, requestId: 'qa_req_3', capability: 'imageGeneration', chargeRisk: 'possible' });
  await ledger.recordResult(key2, { outcome: 'failed', errorCode: 'E_INVALID_KEY', detail: '401' });
  const retryRecord = await ledger.explicitRetry({ previousKey: key2, taskId: 'qa_task_failed_02', stepId, modelName: 'qa-mock-image', inputHash: hash, capability: 'imageGeneration' });
  const newKeyOnExplicitRetry = retryRecord.key !== key2;

  return {
    fileAfterReserve,
    persistedBeforeHttpState: persistedBeforeHttp[key]?.state || null,
    reservedState: reserved.state,
    reservedOutcome: reserved.outcome,
    hasSubmittedAt: Boolean(reserved.submittedAt),
    canSubmitAllowedAfterUnknown: canSubmitAfterUnknown.allowed,
    canSubmitReasonAfterUnknown: canSubmitAfterUnknown.reason,
    retryPromptCanRetry: retryPrompt.canRetry,
    retryPromptLastOutcome: retryPrompt.lastOutcome,
    retryPromptMayHaveBeenCharged: retryPrompt.mayHaveBeenCharged,
    explicitRetryBlocked,
    explicitRetryMessage,
    explicitRetryChinese: chinese(explicitRetryMessage),
    summaryAfterUnknown,
    recordCountAfter,
    duplicateBlocked,
    newKeyOnExplicitRetry,
    retryKeyPrefix: String(retryRecord.key).slice(0, 11),
  };
}

async function runStateMachine() {
  const smMod = await import(mod('src/state/taskStateMachine.mjs'));
  const typesMod = await import(mod('src/core/types.mjs'));
  const { TaskStateMachine } = smMod;
  const { TASK_STATES, STATE_TRANSITIONS, BLOCKING_STATES } = typesMod;
  const dir = path.join(outDir, 'state-sandbox');
  const dir2 = path.join(outDir, 'state-sandbox-2');
  const dir3 = path.join(outDir, 'state-sandbox-3');
  // 三个沙盒全部清空，保证 state_transition 计数在不同轮次间不累积。
  for (const d of [dir, dir2, dir3]) await fsp.rm(d, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const sm = new TaskStateMachine({ projectDir: dir });

  const t1 = await sm.create({ projectId: 'qa-prj', versionId: 'v001' });
  const chain = [
    'INGESTING', 'EXTRACTING', 'AWAITING_CALIBRATION', 'STRUCTURE_READY',
    'LAYOUT_PLANNING', 'CAD_BUILDING', 'CAD_CHECKING', 'IMAGE_AWAITING_CONFIRM',
    'IMAGE_GENERATING', 'PACKAGING', 'DONE',
  ];
  for (const state of chain) {
    await sm.transition(t1.taskId, state, { reason: `QA 真实推进 ${state}` });
  }
  const afterChain = await sm.get(t1.taskId);
  const logLines = (await fsp.readFile(path.join(dir, 'task-log.ndjson'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  const stateTransitionsInLog = logLines.filter((l) => l.type === 'state_transition');

  // 阻塞态展示：不得出现百分比 / ETA
  const sm2 = new TaskStateMachine({ projectDir: dir2 });
  const t2 = await sm2.create({ projectId: 'qa-prj', versionId: 'v002' });
  await sm2.transition(t2.taskId, 'INGESTING', { reason: 'QA' });
  await sm2.transition(t2.taskId, 'EXTRACTING', { reason: 'QA' });
  await sm2.transition(t2.taskId, 'AWAITING_CALIBRATION', { reason: 'QA 待确认' });
  const publicBlocking = await sm2.toPublic(t2.taskId);

  // 非法跳跃（跳过必经校准）必须抛错
  let illegalJumpBlocked = false;
  const sm3 = new TaskStateMachine({ projectDir: dir3 });
  const t3 = await sm3.create({ projectId: 'qa-prj', versionId: 'v003' });
  try {
    await sm3.transition(t3.taskId, 'STRUCTURE_READY', { reason: 'QA 试图跳过校准' });
  } catch { illegalJumpBlocked = true; }

  // 重做 = 新 taskId + 新 versionId
  const redo = await sm.redo({ taskId: t1.taskId, projectId: 'qa-prj', newVersionId: 'v002' });
  const oldTaskStillExists = await sm.get(t1.taskId);
  const newTaskIsDifferent = redo.taskId !== t1.taskId;
  const allTasks = await sm.list();

  return {
    finalState: afterChain.state,
    eventCount: afterChain.events.length,
    stateTransitionsInLog: stateTransitionsInLog.length,
    expectedTransitions: chain.length,
    blockingStates: [...BLOCKING_STATES],
    publicBlocking,
    illegalJumpBlocked,
    redoNewTaskIdDiffers: newTaskIsDifferent,
    redoVersionId: redo.versionId,
    oldTaskStillExists: Boolean(oldTaskStillExists),
    oldTaskVersionId: oldTaskStillExists?.versionId,
    taskCount: allTasks.length,
    statesDefined: Object.keys(TASK_STATES).length,
    transitionTableKeys: Object.keys(STATE_TRANSITIONS).length,
  };
}

try {
  await fsp.mkdir(outDir, { recursive: true });
  result.boundary = await runBoundary();
} catch (error) {
  result.errors.push(`boundary: ${error?.stack || error}`);
}
try {
  result.idempotency = await runIdempotency();
} catch (error) {
  result.errors.push(`idempotency: ${error?.stack || error}`);
}
try {
  result.stateMachine = await runStateMachine();
} catch (error) {
  result.errors.push(`stateMachine: ${error?.stack || error}`);
}

/** AWAITING_CALIBRATION 必须真实停住：必填项未完成前 finalize 抛错。 */
async function runCalibration() {
  const calMod = await import(mod('src/project/calibration.mjs'));
  const { CalibrationSession } = calMod;
  const dir = path.join(outDir, 'calibration-sandbox');
  await fsp.rm(dir, { recursive: true, force: true }); // 探针必须可重复运行
  await fsp.mkdir(dir, { recursive: true });
  const session = new CalibrationSession({ projectRoot: dir });
  await session.start({ backgroundImage: 'qa-floorplan.png', requirementsBlocking: ['关键尺寸缺失'] });

  const pendingAtStart = await session.pendingItems();
  const completeAtStart = await session.isComplete();
  let finalizeBlocked = false;
  let finalizeMessage = '';
  try { await session.finalize('QA'); } catch (error) {
    finalizeBlocked = true;
    finalizeMessage = String(error?.message || error);
  }

  // 用户两点 + 已知真实距离设定比例（只完成 1 项，仍应阻塞，不能一次放行）
  await session.setScale({
    p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, knownDistanceMm: 6000, confirmedBy: 'QA',
  });
  const completeAfterOne = await session.isComplete();
  let stillBlocked = false;
  try { await session.finalize('QA'); } catch { stillBlocked = true; }

  // 逐项确认全部必填项 + 清除需求阻塞后才允许完成
  const all = await session.load();
  for (const item of all.items) {
    if (item.required && !item.confirmed) await session.confirmItem(item.id, 'QA 已人工核对', 'QA');
  }
  await session.clearRequirementsBlocking();
  const completeAfterAll = await session.isComplete();
  let finalizeOk = false;
  try { await session.finalize('QA'); finalizeOk = true; } catch { finalizeOk = false; }

  return {
    pendingAtStart: pendingAtStart.length,
    completeAtStart,
    finalizeBlocked,
    finalizeMessage,
    finalizeChinese: chinese(finalizeMessage),
    completeAfterOne,
    stillBlocked,
    completeAfterAll,
    finalizeOk,
  };
}

try {
  result.calibration = await runCalibration();
} catch (error) {
  result.errors.push(`calibration: ${error?.stack || error}`);
}
result.ok = result.errors.length === 0;
result.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(outDir, 'runtime-probe.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: result.ok, errors: result.errors.map((e) => String(e).slice(0, 200)) }));
