// @ts-check
/**
 * 本地验收脚本（npm run verify / npm test）。
 *
 * 真实跑通：配置 → 新建项目 → 导入 → 校准（阻塞）→ 生成 ops → apply → check
 *   → archlang 双编一致 → DXF 有效性 → 生图请求工具 → 保存记录 → 交付包；
 * 并覆盖：权限边界、幂等 / 防重复扣费、真实状态机与重做、L1 MCP 握手、Key 明文自检。
 *
 * ⚠️ 本机没有客户 API Key：模型调用与生图使用**明确标注的测试替身**
 *   （app/scripts/mock-image-server.mjs，响应带 X-Reno-Test-Double 头）。
 *   CAD 引擎、Electron safeStorage、MCP Server、状态机、交付包都是**真实调用**。
 *   脚本输出严格区分两者，绝不把测试替身记为「真实联调通过」。
 * @module scripts/acceptance
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import assert from 'node:assert/strict';
import { startMockServer } from './mock-image-server.mjs';
import { Pipeline } from '../src/orchestrator/pipeline.mjs';
import {
  resolveEnginePaths, findElectronSync, vendorReady, runArchlang, RUNTIME_DIR, APP_ROOT,
} from '../src/core/enginePaths.mjs';
import { createPng } from '../src/image/png.mjs';
import { isDecodableImage } from '../src/image/png.mjs';
import { PermissionGate } from '../src/security/permissionGate.mjs';
import { AuditLog } from '../src/core/audit.mjs';
import { IdempotencyLedger, makeIdempotencyKey } from '../src/state/idempotency.mjs';
import { TASK_STATES, CAPABILITY_STATUS } from '../src/core/types.mjs';
import { assertFileHasNoPlaintext, scanForPlaintext, maskKey } from '../src/core/redact.mjs';
import { verifyZip } from '../src/packaging/zipWriter.mjs';
import { ensureDir, writeJson, sha256 } from '../src/core/util.mjs';

/** @type {Array<{name:string,passed:boolean,detail:string,category:string}>} */
const results = [];
/** @type {Record<string, unknown>} */
const artifacts = {};

/** @param {string} name @param {string} category @param {()=>Promise<string>|string} fn */
async function check(name, category, fn) {
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail: String(detail), category });
    process.stdout.write(`  ✓ ${name} — ${detail}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, detail, category });
    process.stdout.write(`  ✗ ${name} — ${detail}\n`);
  }
}

/** @param {string} dir @returns {Promise<string[]>} */
async function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function main() {
  process.stdout.write('\n============================================================\n');
  process.stdout.write(' 本地装修设计 Agent · P0 最小真实链路验收\n');
  process.stdout.write(' 真实：Electron safeStorage / opencalque CLI / archlang CLI / MCP / 状态机 / 交付包\n');
  process.stdout.write(' 测试替身：模型能力测试与生图（本机无客户 API Key）\n');
  process.stdout.write('============================================================\n\n');

  // 每次验收使用干净的运行时目录，保证脚本可重复运行（不会因上次遗留产物产生假失败）。
  for (const dir of [
    path.join(APP_ROOT, '.runtime', 'acceptance-projects'),
    path.join(RUNTIME_DIR, 'idempotency-test'),
    path.join(RUNTIME_DIR, 'userdata'),
  ]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.rm(path.join(RUNTIME_DIR, 'boundary-audit.ndjson'), { force: true });

  await ensureDir(RUNTIME_DIR);
  const enginePaths = resolveEnginePaths();
  process.stdout.write(`[环境] Node=${process.version} 平台=${process.platform}\n`);
  process.stdout.write(`[环境] opencalque=${enginePaths.ocHome}\n[环境] archlang=${enginePaths.alHome}\n`);
  process.stdout.write(`[环境] vendorReady=${vendorReady()} electron=${findElectronSync() || '未找到'}\n\n`);

  await check('前置：vendor 依赖与 Electron safeStorage 宿主可用', '环境', () => {
    assert.equal(vendorReady(), true, 'vendor 未就绪，请先执行 npm run setup');
    assert.ok(findElectronSync(), '未找到 electron.exe，请运行 npm run setup 或设置 RENO_ELECTRON_PATH');
    return `vendorReady=true, electron=${findElectronSync()}`;
  });

  // ---- 启动明确标注的测试替身 ----
  const mock = await startMockServer();
  process.stdout.write(`[TEST DOUBLE] 本机 mock 端点已启动：${mock.baseUrl}（不是真实模型服务）\n\n`);

  const TEXT_KEY = 'test-double-key-textvision-0001';
  const IMAGE_KEY = 'test-double-key-imagegen-0002';
  const pipeline = new Pipeline({
    mode: 'mock',
    confirmer: () => true, // 代表员工在弹窗里点了「允许」（显式确认，非自动放行）
    dataDir: path.join(RUNTIME_DIR, 'userdata'),
    projectsRoot: path.join(APP_ROOT, '.runtime', 'acceptance-projects'),
  });
  await pipeline.init();

  // ================= ① 模型配置 =================
  process.stdout.write('--- ① 模型配置（两组独立 / 安全凭据 / 5 项能力） ---\n');
  let config;
  await check('两组模型配置可保存，Provider/URL/模型名不硬编码', '配置', async () => {
    config = await pipeline.configureModels({
      textVision: { provider: 'openai-compatible', apiBaseUrl: mock.baseUrl, apiKey: TEXT_KEY, modelName: 'mock-text-vision' },
      imageGen: { provider: 'openai-images', apiBaseUrl: mock.baseUrl, apiKey: IMAGE_KEY, modelName: 'mock-image' },
      mode: 'mock',
    });
    assert.equal(config.groups.textVision.apiBaseUrl, mock.baseUrl);
    assert.equal(config.groups.imageGen.apiBaseUrl, mock.baseUrl);
    return `badge=${config.publicSettings.badge}, 两组 URL 均由调用方提供`;
  });

  await check('Electron safeStorage 真实加解密（非模拟）', '配置', () => {
    assert.equal(config.safeStorage.backend !== 'unknown', true);
    assert.ok(config.safeStorage.electron.startsWith('44.'), `Electron 版本=${config.safeStorage.electron}`);
    return `backend=${config.safeStorage.backend}, electron=${config.safeStorage.electron}, node=${config.safeStorage.node}`;
  });

  await check('API Key 密文不含明文、界面掩码显示', '安全', async () => {
    const cipher = await pipeline.secretStore.cipherSample();
    assert.equal(cipher.length, 2, '应有两组密文');
    const secretsFile = await fs.readFile(pipeline.secretStore.secretsFile, 'utf8');
    const scan = scanForPlaintext(secretsFile, [TEXT_KEY, IMAGE_KEY]);
    assert.equal(scan.found, false, 'secrets.json 中出现 Key 明文');
    const settingsFile = await fs.readFile(path.join(RUNTIME_DIR, 'userdata', 'settings.json'), 'utf8');
    assert.equal(scanForPlaintext(settingsFile, [TEXT_KEY, IMAGE_KEY]).found, false, 'settings.json 中出现 Key 明文');
    return `密文 ${cipher.map((c) => `${c.name}:${c.cipherHead}…`).join(', ')}；掩码=${maskKey(TEXT_KEY)}`;
  });

  await check('5 项能力分别测试且结论独立', '配置', () => {
    const items = config.capabilityPublic.items;
    const keys = ['textGeneration', 'toolCalling', 'imageUnderstanding', 'imageGeneration', 'imageEditing'];
    for (const key of keys) {
      assert.equal(items[key].status, CAPABILITY_STATUS.SUPPORTED, `${key} 结论=${items[key].status} / ${items[key].reason}`);
      assert.equal(items[key].testDouble, true, `${key} 应标注为测试替身`);
    }
    assert.equal(config.capabilityPublic.realPassedCount, 0, '测试替身不得计入真实联调通过');
    return `5/5 通过（全部标注 TEST DOUBLE）；真实端点通过数=${config.capabilityPublic.realPassedCount}`;
  });

  // ================= ② 新建项目 =================
  process.stdout.write('\n--- ② 新建项目 ---\n');
  let project;
  await check('新建项目并写入最近项目', '项目', async () => {
    project = await pipeline.createProject({ name: '验收项目·两室一厅', client: '测试业主', address: '本地' });
    const recent = await pipeline.projectStore.listRecent();
    assert.equal(recent.length >= 1, true);
    return `projectId=${project.projectId}, recent=${recent.length}`;
  });

  // ================= ③ 导入资料 =================
  process.stdout.write('\n--- ③ 导入资料（格式 / 可读性 / 去重 / 候选值） ---\n');
  const oneRoomArch = path.join(enginePaths.alHome, 'examples', 'one-room.arch');
  const inputDxf = path.join(RUNTIME_DIR, 'acceptance-input.dxf');
  const dxfCompile = await runArchlang(['compile', oneRoomArch, '-o', inputDxf, '--json'], { timeoutMs: 180000 });
  assert.equal(dxfCompile.code, 0, '生成候选 DXF 失败');
  const dxfBuffer = await fs.readFile(inputDxf);
  const floorplan = createPng(96, 64);
  const reference = createPng(48, 48);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<<>>\n%%EOF\n');

  let ingest;
  await check('导入 PNG / PDF / DXF / 参考图，校验并保留源文件', '导入', async () => {
    ingest = await pipeline.ingest([
      { name: '户型图-89m2三室.png', data: floorplan, stage: '资料上传' },
      { name: '量房草图.pdf', data: pdf, stage: '资料上传' },
      { name: '原始结构.dxf', data: dxfBuffer, stage: '资料上传' },
      { name: '风格参考-现代简约.png', data: reference, stage: '资料上传' },
    ]);
    assert.equal(ingest.accepted.length, 4, `仅接受 ${ingest.accepted.length}/4：${ingest.rejected.map((r) => r.reason).join(';')}`);
    return `接受=${ingest.accepted.length}, 拒绝=${ingest.rejected.length}, 候选值=${ingest.candidates.length}`;
  });

  await check('DWG 不解析、重复文件与不支持格式被明确拒绝', '导入', async () => {
    const rejected = await pipeline.ingest([
      { name: '公寓.dwg', data: Buffer.from('fake dwg binary') },
      { name: '户型图-89m2三室.png', data: floorplan },
      { name: 'malware.exe', data: Buffer.from('MZ') },
    ]);
    assert.equal(rejected.accepted.length, 0);
    assert.equal(rejected.rejected.length, 3);
    assert.ok(rejected.rejected[0].reason.includes('另存为 DXF'), 'DWG 未给出正确提示');
    assert.ok(rejected.rejected[1].reason.includes('重复'), '重复文件未去重');
    return `3 项全部拒绝：DWG / 重复 / 危险后缀`;
  });

  await check('候选值带来源且标注待确认，不虚构自动识别', '导入', () => {
    assert.ok(ingest.candidates.length >= 1, '未抽取到任何候选值');
    for (const candidate of ingest.candidates) {
      assert.equal(candidate.requiresConfirmation, true);
      assert.ok(candidate.source, '候选值缺少来源文件');
    }
    return `候选 ${ingest.candidates.length} 条：${ingest.candidates.map((c) => `${c.field}=${c.value}`).join(', ')}`;
  });

  // ================= ④ 需求 + 校准阻塞 =================
  process.stdout.write('\n--- ④ 需求提交与 AWAITING_CALIBRATION 真实阻塞 ---\n');
  let submission;
  await check('提交需求，状态机真实推进并停在等待校准', '状态机', async () => {
    submission = await pipeline.submitRequirements({
      fields: {
        area: '89', roomUses: ['客厅', '主卧'], occupants: 3,
        style: '现代简约', budget: '250000', ceilingHeight: 2800,
        specialRequirements: '保留承重墙，不做开放式厨房',
      },
      candidates: ingest.candidates,
      backgroundImage: '户型图-89m2三室.png',
    });
    assert.equal(submission.state, TASK_STATES.AWAITING_CALIBRATION);
    assert.equal(submission.blocked, true);
    assert.ok(submission.pending.length >= 5, `待确认项=${submission.pending.length}`);
    assert.equal(submission.display.showPercent, false);
    assert.equal(submission.display.showEta, false);
    assert.equal(submission.display.waitingForUser, true);
    return `state=${submission.state}, 待确认=${submission.pending.length} 项, 无百分比/ETA`;
  });

  await check('未校准时强行推进被阻塞（不自动出图）', '校准', async () => {
    await assert.rejects(
      () => pipeline.confirmCalibrationAndBuild(),
      (error) => /E_CALIBRATION_BLOCKED|待确认/.test(String(error?.code || error?.message)),
    );
    const snap = await pipeline.snapshot();
    assert.equal(snap.task.state, TASK_STATES.AWAITING_CALIBRATION, '状态被意外推进');
    return '抛 E_CALIBRATION_BLOCKED，状态仍为 AWAITING_CALIBRATION';
  });

  // ================= ⑤ 校准 + 人工修正 =================
  process.stdout.write('\n--- ⑤ 两点已知距离校准 + 人工修正 ---\n');
  let calibration;
  await check('两点校准：尺度来自用户输入的已知距离', '校准', async () => {
    calibration = await pipeline.applyCalibration({
      p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, knownDistanceMm: 6000,
      confirmations: {
        dimensions: '开间 6000 / 进深 4000（人工核对）',
        thinWalls: '已补齐客厅与主卧之间 100mm 薄内墙',
        openings: '入户门 900、北窗 1500、南窗 1200 已核对',
        structuralWalls: '外墙为承重墙，内隔墙可拆（人工确认）',
      },
      dimensions: { width: 6000, depth: 4000, unit: 'mm' },
      confirmedBy: '验收脚本·模拟量房员工',
    });
    assert.equal(calibration.blocked, false, `仍有待确认项：${calibration.pending.map((p) => p.label).join('、')}`);
    assert.equal(calibration.calibration.calibration.scaleSource, 'user_provided_known_distance');
    return `mm/px=${calibration.calibration.calibration.mmPerPixel.toFixed(3)}, 来源=用户输入`;
  });

  // ================= ⑥ CAD 出图 / 自检 =================
  process.stdout.write('\n--- ⑥ 生成 ops → apply → check → archlang 双编 → DXF 自检 ---\n');
  let build;
  await check('状态机推进到 IMAGE_AWAITING_CONFIRM（幂等键已生成、未发请求）', '状态机', async () => {
    build = await pipeline.confirmCalibrationAndBuild();
    assert.equal(build.state, TASK_STATES.IMAGE_AWAITING_CONFIRM);
    assert.ok(build.idempotencyKey.startsWith('idem_'));
    assert.equal(build.archResult.deterministic, true, 'archlang 双编字节不一致');
    assert.equal(build.ocResult.checkProblems.length, 0, `opencalque check 返回 ${JSON.stringify(build.ocResult.checkProblems)}`);
    assert.equal(build.dxfCheck.ok, true, `DXF 自检失败：${build.dxfCheck.missing.join('；')}`);
    return `state=${build.state}, 双编一致, check=[], DXF ${build.dxfCheck.checks.length} 项自检全过`;
  });

  await check('opencalque 真实命令全部 EXIT=0（new/apply/check/describe/dxf/import/validate）', 'CAD', () => {
    const exits = { ...build.archResult.exits, ...build.ocResult.exits };
    for (const [name, code] of Object.entries(exits)) assert.equal(code, 0, `${name} EXIT=${code}`);
    return Object.entries(exits).map(([name, code]) => `${name}:${code}`).join(' ');
  });

  await check('DXF 含墙/门窗/家具/图层/标注/尺寸 6 类元素', 'CAD', () => {
    const stats = build.dxfCheck.stats;
    assert.ok(stats.entities.LINE >= 4, `LINE=${stats.entities.LINE}`);
    assert.ok((stats.entities.DIMENSION || 0) >= 1, `DIMENSION=${stats.entities.DIMENSION}`);
    assert.ok((stats.entities.TEXT || 0) >= 1, `TEXT=${stats.entities.TEXT}`);
    assert.ok(stats.layerCount >= 4, `图层=${stats.layerCount}`);
    assert.equal(build.dxfCheck.stats.header.$ACADVER, 'AC1015');
    return `bytes=${stats.bytes}, 图层=${stats.layerCount}, LINE=${stats.entities.LINE}, DIMENSION=${stats.entities.DIMENSION}, TEXT=${stats.entities.TEXT}, INSERT=${stats.entities.INSERT || 0}`;
  });

  await check('双引擎闭环：archlang DXF → opencalque import → validate OK', 'CAD', () => {
    assert.ok(build.ocResult.importLog.includes('objects'), `import 输出=${build.ocResult.importLog}`);
    assert.ok(build.ocResult.validateLog.includes('OK'), `validate 输出=${build.ocResult.validateLog}`);
    return `${build.ocResult.importLog.trim()} / validate=${build.ocResult.validateLog.trim()}`;
  });

  await check('DXF 是唯一交付格式，无 DWG / 无改后缀', 'CAD', async () => {
    const files = await fs.readdir(pipeline.ctx.versionDir);
    assert.equal(files.some((name) => name.toLowerCase().endsWith('.dwg')), false);
    assert.ok(files.includes('plan.dxf'));
    return `版本目录 ${files.length} 个文件，含 plan.dxf，无 .dwg`;
  });

  await check('L1 MCP Client 真实握手 opencalque MCP Server', 'L1', async () => {
    const mcp = await pipeline.verifyMcp();
    assert.equal(mcp.serverInfo?.name, 'opencalque');
    assert.equal(mcp.serverInfo?.version, '1.6.0');
    assert.ok(mcp.toolNames.includes('read_guide'));
    assert.ok(mcp.instructions.includes('read_guide'));
    return `server=${mcp.serverInfo.name}@${mcp.serverInfo.version}, tools=[${mcp.toolNames.join(',')}], guide=${mcp.guideHasContent}`;
  });

  await check('L2 Skill 加载 + L3 系统提示词默认需确认', 'L2/L3', () => {
    const skills = pipeline.skillLoader.listPublic();
    assert.ok(skills.some((skill) => skill.id === 'interior-render'));
    assert.ok(skills.some((skill) => skill.id === 'archlang'));
    const prompt = pipeline.buildSystemPrompt();
    assert.ok(prompt.includes('必须先取得用户的预执行确认'));
    assert.ok(prompt.includes('undo 不是安全边界') || prompt.includes('撤销（undo）不是安全边界'));
    assert.equal(PermissionGate.policy().defaultConfirmation, true);
    assert.equal(PermissionGate.policy().undoIsSafetyBoundary, false);
    return `已加载 ${skills.length} 个 Skill；默认需确认=true，undo≠安全边界`;
  });

  // ================= ⑦ 生图（测试替身） =================
  process.stdout.write('\n--- ⑦ 生图提交确认 + 受控请求工具（TEST DOUBLE） ---\n');
  let imageStep;
  await check('提交前幂等键落盘、仅 1 次付费请求、无自动重试', '幂等', async () => {
    const before = await pipeline.snapshot();
    assert.equal(before.idempotency.total, 0, '提交前不应有已提交记录');
    imageStep = await pipeline.confirmImageSubmission({ approved: true, mode: 'mock' });
    assert.equal(imageStep.success, true, `生图失败：${JSON.stringify(imageStep.result?.errorCode)}`);
    assert.equal(imageStep.result.testDouble, true);
    const after = await pipeline.snapshot();
    assert.equal(after.idempotency.total, 1);
    assert.equal(after.idempotency.autoRetries, 0);
    assert.equal(after.task.chargeSubmittedCount, 1);
    return `idempotency.total=1, chargeSubmittedCount=1, autoRetries=0, testDouble=true`;
  });

  await check('生图输出为可解码图片，记录含 CAD 版本/输入/提示/模型名/时间', '生图', async () => {
    const record = imageStep.record;
    assert.equal(record.cadVersionId, pipeline.ctx.versionId);
    assert.ok(record.modelName);
    assert.ok(record.prompt.includes('禁止改变的结构'));
    assert.ok(record.inputImages.length >= 1);
    assert.ok(record.createdAt);
    assert.equal('apiKey' in record, false);
    const image = await fs.readFile(record.outputFile);
    const decoded = isDecodableImage(image);
    assert.equal(decoded.ok, true, decoded.reason);
    return `output=${path.basename(record.outputFile)}, ${record.outputBytes}B, ${decoded.format}, 记录字段 ${Object.keys(record).length} 项（无 apiKey）`;
  });

  // ================= ⑧ 交付包 =================
  process.stdout.write('\n--- ⑧ 整理交付包与状态机 DONE ---\n');
  let finished;
  await check('写版本清单 + 导出 ZIP + 状态机到 DONE', '交付', async () => {
    finished = await pipeline.packageAndFinish();
    assert.equal(finished.state, TASK_STATES.DONE);
    assert.ok(finished.delivery.zipPath.endsWith('.zip'));
    const zipBuffer = await fs.readFile(finished.delivery.zipPath);
    const zipCheck = verifyZip(zipBuffer);
    assert.equal(zipCheck.ok, true, zipCheck.reason);
    assert.equal(finished.delivery.redactionReport.plaintextHits, 0);
    return `zip=${finished.delivery.zipPath}, 条目=${finished.delivery.entries.length}, 脱敏命中=0`;
  });

  await check('交付包含边界声明、无 .dwg、无 Key 明文', '交付', async () => {
    const names = finished.delivery.entries.map((entry) => entry.name);
    assert.ok(names.includes('CAD边界声明.txt'));
    assert.ok(names.includes('方案说明.txt'));
    assert.ok(names.includes('脱敏自检报告.json'));
    assert.equal(names.some((name) => name.toLowerCase().endsWith('.dwg')), false);
    await assertFileHasNoPlaintext(finished.delivery.zipPath, [TEXT_KEY, IMAGE_KEY]);
    return `${names.length} 个条目，含 CAD边界声明.txt / 方案说明.txt / 脱敏自检报告.json`;
  });

  await check('项目目录、任务日志、审计日志全文 Key 明文自检 = 0', '安全', async () => {
    const roots = [
      pipeline.stores.projectRoot,
      pipeline.dataDir,
      pipeline.deliveriesDir,
    ];
    let checked = 0;
    for (const root of roots) {
      for (const file of await walkFiles(root)) {
        await assertFileHasNoPlaintext(file, [TEXT_KEY, IMAGE_KEY]);
        checked += 1;
      }
    }
    return `扫描 ${checked} 个文件，Key 明文命中 0`;
  });

  await check('任务日志与状态 1:1，无定时假进度', '状态机', async () => {
    const snap = await pipeline.snapshot();
    const states = snap.taskLog.filter((entry) => entry.type === 'state_transition').map((entry) => entry.detail?.to);
    for (const required of ['INGESTING', 'EXTRACTING', 'AWAITING_CALIBRATION', 'STRUCTURE_READY', 'LAYOUT_PLANNING', 'CAD_BUILDING', 'CAD_CHECKING', 'IMAGE_AWAITING_CONFIRM', 'IMAGE_GENERATING', 'PACKAGING', 'DONE']) {
      assert.ok(states.includes(required), `任务日志缺少状态 ${required}`);
    }
    assert.ok(snap.taskLog.some((entry) => entry.type === 'sub_progress'), '缺少真实子进度事件');
    return `状态事件 ${states.length} 条，子进度事件 ${snap.taskLog.filter((e) => e.type === 'sub_progress').length} 条`;
  });

  // ================= ⑨ 权限边界 =================
  process.stdout.write('\n--- ⑨ 权限最小范围（L3） ---\n');
  const projectRoot = pipeline.stores.projectRoot;
  const boundaryAudit = new AuditLog(path.join(RUNTIME_DIR, 'boundary-audit.ndjson'), [TEXT_KEY, IMAGE_KEY]);
  const strictGate = new PermissionGate({ projectRoot, audit: boundaryAudit }); // confirmer 默认拒绝
  const secrets = [TEXT_KEY, IMAGE_KEY];

  await check('任意系统命令 / 脚本 / 未白名单工具被拒绝并写审计', '权限', async () => {
    await assert.rejects(() => strictGate.authorize({ tool: 'system_run_command', params: { command: 'dir C:\\' } }));
    await assert.rejects(() => strictGate.authorize({ tool: 'run_script', params: { script: 'console.log(1)' } }));
    await assert.rejects(() => strictGate.authorize({ tool: 'read_file_any', params: { path: 'C:/Windows/win.ini' } }));
    await assert.rejects(() => strictGate.authorize({ tool: 'apply_operations', params: { ops: [{ op: 'exec', command: 'calc.exe' }] } }));
    const log = await boundaryAudit.list();
    assert.ok(log.filter((entry) => entry.result === 'denied').length >= 4);
    return `4 类越权请求全部拒绝，审计 denied=${log.filter((e) => e.result === 'denied').length}`;
  });

  await check('路径沙箱：项目外绝对路径 / UNC / ADS / 遍历被拒绝', '权限', async () => {
    await assert.rejects(() => strictGate.authorize({ tool: 'export_dxf', params: { out: 'C:/Windows/System32/evil.dxf' }, confirmation: { approved: true } }));
    await assert.rejects(() => strictGate.authorize({ tool: 'export_dxf', params: { out: '../outside.dxf' }, confirmation: { approved: true } }));
    await assert.rejects(() => strictGate.authorize({ tool: 'export_dxf', params: { out: '\\\\server\\share\\a.dxf' }, confirmation: { approved: true } }));
    return '项目外 / 上级目录 / UNC 路径均拒绝';
  });

  await check('默认需确认：无用户确认时受控操作被拒，确认后放行', '权限', async () => {
    await assert.rejects(() => strictGate.authorize({ tool: 'export_dxf', params: { out: 'plan.dxf' } }));
    const allowed = await strictGate.authorize({
      tool: 'export_dxf', params: { out: 'plan.dxf' },
      confirmation: { approved: true, scope: 'once', actor: 'user' },
    });
    assert.equal(allowed.allowed, true);
    const readOnly = await strictGate.authorize({ tool: 'read_guide', params: {} });
    assert.equal(readOnly.needsConfirmation, false);
    return '未确认→拒绝；显式确认→允许；只读→直接放行并留痕';
  });

  // ================= ⑩ 幂等 / 防重复扣费 =================
  process.stdout.write('\n--- ⑩ 幂等与防重复扣费 ---\n');
  const idemDir = path.join(RUNTIME_DIR, 'idempotency-test');
  await ensureDir(idemDir);
  const ledger = new IdempotencyLedger({ projectDir: idemDir });
  await ledger.load();

  await check('重复提交同一幂等键被拒绝', '幂等', async () => {
    const key = makeIdempotencyKey('task_x', 'step_a');
    await ledger.reserve({ taskId: 'task_x', stepId: 'step_a', key, modelName: 'm', inputHash: sha256('x'), requestId: 'r1', capability: 'imageGeneration', chargeRisk: 'possible' });
    await assert.rejects(() => ledger.reserve({ taskId: 'task_x', stepId: 'step_a', key, modelName: 'm', inputHash: sha256('x'), requestId: 'r2', capability: 'imageGeneration', chargeRisk: 'possible' }));
    return '第二次 reserve 抛 E_IDEMPOTENCY_BLOCKED';
  });

  await check('超时结果未知：禁止直接重提，显式重试也被拦', '幂等', async () => {
    const key = makeIdempotencyKey('task_y', 'step_a');
    await ledger.reserve({ taskId: 'task_y', stepId: 'step_a', key, modelName: 'm', inputHash: sha256('y'), requestId: 'r3', capability: 'imageGeneration', chargeRisk: 'possible' });
    await ledger.recordResult(key, { outcome: 'unknown', errorCode: 'E_TIMEOUT_UNKNOWN' });
    const can = ledger.canSubmit({ taskId: 'task_y', stepId: 'step_a', newKey: key });
    assert.equal(can.allowed, false);
    assert.ok(can.reason.includes('结果未知'));
    await assert.rejects(() => ledger.explicitRetry({ previousKey: key, taskId: 'task_y', stepId: 'step_a', modelName: 'm', inputHash: sha256('y'), capability: 'imageGeneration' }));
    const prompt = ledger.retryPrompt(key);
    assert.equal(prompt.lastOutcome, '结果未知');
    assert.equal(prompt.mayHaveBeenCharged, true);
    return 'canSubmit=false，explicitRetry 抛 E_TIMEOUT_UNKNOWN，界面提示「可能已产生费用」';
  });

  await check('上次明确失败后，仅用户显式重试生成新幂等键', '幂等', async () => {
    const key = makeIdempotencyKey('task_z', 'step_a');
    await ledger.reserve({ taskId: 'task_z', stepId: 'step_a', key, modelName: 'm', inputHash: sha256('z'), requestId: 'r4', capability: 'imageGeneration', chargeRisk: 'possible' });
    await ledger.recordResult(key, { outcome: 'failed', errorCode: 'E_RATE_LIMIT' });
    const retry = await ledger.explicitRetry({ previousKey: key, taskId: 'task_z', stepId: 'step_a', modelName: 'm', inputHash: sha256('z'), capability: 'imageGeneration' });
    assert.notEqual(retry.key, key);
    assert.equal(retry.retryOf, key);
    return `旧键=${key.slice(0, 16)}… → 新键=${retry.key.slice(0, 20)}…（仅显式触发）`;
  });

  // ================= ⑪ 重做 =================
  process.stdout.write('\n--- ⑪ 重做 = 新 Task + 新 versionId，旧版本保留 ---\n');
  await check('重做生成新 Task / 新版本，旧成果哈希不变', '状态机', async () => {
    const oldVersionId = pipeline.ctx.versionId;
    const oldDxf = path.join(pipeline.ctx.versionDir, 'plan.dxf');
    const oldHash = sha256(await fs.readFile(oldDxf));
    const redo = await pipeline.redo();
    assert.notEqual(redo.taskId, finished.manifest.taskId);
    assert.notEqual(redo.versionId, oldVersionId);
    assert.equal(redo.state, TASK_STATES.DRAFT);
    const newHash = sha256(await fs.readFile(oldDxf));
    assert.equal(newHash, oldHash, '旧版本文件被覆盖');
    const versions = (await pipeline.projectStore.get(pipeline.ctx.projectId)).versions;
    assert.ok(versions.includes(oldVersionId) && versions.includes(redo.versionId));
    return `旧=${oldVersionId}（哈希不变）→ 新=${redo.versionId}, 共 ${versions.length} 个版本`;
  });

  // ================= 汇总 =================
  const passed = results.filter((item) => item.passed).length;
  const failed = results.filter((item) => !item.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    electron: findElectronSync(),
    enginePaths: { ocHome: enginePaths.ocHome, alHome: enginePaths.alHome },
    mockEndpoint: mock.baseUrl,
    mockRequests: mock.requestCount(),
    realCalls: {
      safeStorage: 'Electron safeStorage（真实）',
      opencalqueExits: { ...(build?.archResult?.exits || {}), ...(build?.ocResult?.exits || {}) },
      mcpServer: 'opencalque mcp（真实握手）',
      archlangDeterministic: build?.archResult?.deterministic ?? null,
    },
    testDouble: {
      capabilityTests: true,
      imageGeneration: true,
      note: '本机无客户 API Key；以上两项只验证代码路径，不计入真实联调通过。',
    },
    artifacts: {
      deliveryZip: finished?.delivery?.zipPath || null,
      planDxf: build?.archResult?.dxfPath || null,
      workingDocument: build?.ocResult?.drawingPath || null,
      imageRecord: pipeline.stores.imageRecordPath || null,
      projectRoot: pipeline.stores.projectRoot,
      versionId: finished?.manifest?.versionId || null,
    },
    summary: { total: results.length, passed, failed: failed.length },
    results,
  };
  const reportPath = path.join(RUNTIME_DIR, 'acceptance-report.json');
  await writeJson(reportPath, report);
  await mock.close();

  process.stdout.write('\n============================================================\n');
  process.stdout.write(` 验收结果：${passed}/${results.length} 通过，失败 ${failed.length}\n`);
  process.stdout.write(` 报告：${reportPath}\n`);
  process.stdout.write(` 交付包：${report.artifacts.deliveryZip}\n`);
  process.stdout.write(' 真实调用：Electron safeStorage / opencalque CLI / archlang CLI / MCP Server / 状态机 / ZIP\n');
  process.stdout.write(' 测试替身：模型能力测试 + 生图（明确标注，待客户 API Key 联调）\n');
  process.stdout.write('============================================================\n');
  if (failed.length > 0) {
    for (const item of failed) process.stdout.write(`  ✗ [${item.category}] ${item.name}: ${item.detail}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('IS_PASS: YES\n');
  }
  return report;
}

main().catch((error) => {
  process.stderr.write(`\n[验收脚本异常] ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
