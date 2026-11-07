// @ts-check
/**
 * 桌面桥接层无人值守冒烟（npm run smoke:desktop）。
 *
 * 验证链路：启动脚本清除宿主 ELECTRON_RUN_AS_NODE → Electron 桌面壳起来 →
 * 派生领域核心子进程 + 本地 HTTP 桥 → preload 窄 IPC → 中文渲染层加载 →
 * 通过桥真实调用 5 个只读工具 → 白名单拒绝越权命令 →
 * 未确认的受控动作被 L3 门拒绝 → 新建项目 → 读取任务状态 → 结果落盘 → 退出。
 *
 * **三分法如实说明**：这里验证的是**本产品的桌面桥接层**，不是 opencalque 上游 GUI 冒烟，
 * 也不是「员工可直接使用的完整软件已交付」。渲染层白标装配与安装包仍待完成。
 * @module scripts/smoke-desktop
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchDesktop, SMOKE_RESULT_FILE } from './launch-desktop.mjs';
import { RUNTIME_DIR } from '../src/core/enginePaths.mjs';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  try { fs.rmSync(SMOKE_RESULT_FILE, { force: true }); } catch { /* 不存在 */ }
  const { child, electron } = launchDesktop({ smoke: true });
  process.stdout.write(`[smoke:desktop] Electron=${electron}\n`);
  process.stdout.write('[smoke:desktop] 已清除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS；领域核心以独立子进程运行\n');

  const deadline = Date.now() + 120000;
  /** @type {Object|null} */
  let result = null;
  let childExit = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(SMOKE_RESULT_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(SMOKE_RESULT_FILE, 'utf8'));
        if (parsed && (parsed.ok !== undefined || parsed.error)) { result = parsed; break; }
      } catch { /* 文件还在写 */ }
    }
    if (child.exitCode !== null) { childExit = child.exitCode; break; }
    await sleep(200);
  }
  if (child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
  }
  // 给子进程一点时间写完整，再重读一次。
  if (!result && fs.existsSync(SMOKE_RESULT_FILE)) {
    try { result = JSON.parse(fs.readFileSync(SMOKE_RESULT_FILE, 'utf8')); } catch { /* 忽略 */ }
  }

  const reportPath = `${RUNTIME_DIR}/desktop-smoke-report.json`;
  const report = {
    generatedAt: new Date().toISOString(),
    electron,
    childExitCode: child.exitCode ?? childExit,
    resultFile: SMOKE_RESULT_FILE,
    result,
    verdict: 'FAIL',
  };
  if (result && result.ok === true && Array.isArray(result.steps)) {
    const bad = result.steps.filter((step) => step.code === 1
      && step.name !== '未确认的受控动作' && step.name !== '越权命令');
    report.verdict = bad.length === 0 ? 'PASS' : 'FAIL';
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  process.stdout.write(`[smoke:desktop] 子进程退出码=${report.childExitCode}\n`);
  if (result) {
    for (const step of result.steps || []) {
      process.stdout.write(`  · ${step.name}: code=${step.code}${step.errorCode ? ' / ' + step.errorCode : ''}${step.hasData ? ' / 有数据' : ''}\n`);
    }
    if (result.error) process.stdout.write(`  · 错误：${result.error}\n`);
  } else {
    process.stdout.write('  · 未收到冒烟结果（超时或启动失败）\n');
  }
  process.stdout.write(`[smoke:desktop] 结论=${report.verdict}，报告 ${reportPath}\n`);
  if (report.verdict !== 'PASS') process.exitCode = 1;
  return report;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`[smoke:desktop] 异常：${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
