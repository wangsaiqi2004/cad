// @ts-check
/**
 * 一键跑通主链路（npm run pipeline），用于人工快速复核。
 * 与验收脚本的差别：不做权限 / 幂等 / 边界的逐项断言，只跑链路并打印真实产物路径。
 * 模型与生图使用明确标注的测试替身（本机无客户 API Key）。
 * @module scripts/run-pipeline
 */

import path from 'node:path';
import { startMockServer } from './mock-image-server.mjs';
import { Pipeline } from '../src/orchestrator/pipeline.mjs';
import { APP_ROOT, RUNTIME_DIR, resolveEnginePaths, runArchlang } from '../src/core/enginePaths.mjs';
import { createPng } from '../src/image/png.mjs';
import { writeJson, ensureDir } from '../src/core/util.mjs';

async function main() {
  const mock = await startMockServer();
  const enginePaths = resolveEnginePaths();
  const pipeline = new Pipeline({
    mode: 'mock',
    confirmer: () => true,
    dataDir: path.join(RUNTIME_DIR, 'userdata'),
    projectsRoot: path.join(APP_ROOT, '.runtime', 'pipeline-projects'),
  });
  await pipeline.init();
  await ensureDir(RUNTIME_DIR);

  process.stdout.write('[1/8] 配置两组模型（测试替身端点）\n');
  const config = await pipeline.configureModels({
    textVision: { provider: 'openai-compatible', apiBaseUrl: mock.baseUrl, apiKey: 'pipeline-text-key-0001', modelName: 'mock-text-vision' },
    imageGen: { provider: 'openai-images', apiBaseUrl: mock.baseUrl, apiKey: 'pipeline-image-key-0002', modelName: 'mock-image' },
    mode: 'mock',
  });

  process.stdout.write('[2/8] 新建项目\n');
  const project = await pipeline.createProject({ name: '一键链路演示', client: '演示客户' });

  process.stdout.write('[3/8] 导入资料\n');
  const inputDxf = path.join(RUNTIME_DIR, 'pipeline-input.dxf');
  await runArchlang(['compile', path.join(enginePaths.alHome, 'examples', 'one-room.arch'), '-o', inputDxf, '--json']);
  const { readFile } = await import('node:fs/promises');
  const ingest = await pipeline.ingest([
    { name: '户型图-89m2三室.png', data: createPng(80, 60) },
    { name: '量房草图.pdf', data: Buffer.from('%PDF-1.4\n%%EOF\n') },
    { name: '原始结构.dxf', data: await readFile(inputDxf) },
  ]);

  process.stdout.write('[4/8] 提交需求（应停在等待校准）\n');
  const submission = await pipeline.submitRequirements({
    fields: { area: '89', roomUses: ['客厅', '主卧'], style: '现代简约', occupants: 3 },
    candidates: ingest.candidates,
  });

  process.stdout.write('[5/8] 两点校准 + 人工修正\n');
  await pipeline.applyCalibration({
    p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, knownDistanceMm: 6000,
    confirmations: {
      dimensions: '开间 6000 / 进深 4000', thinWalls: '已补 100mm 内墙',
      openings: '门窗洞口已核对', structuralWalls: '外墙承重已确认',
    },
    dimensions: { width: 6000, depth: 4000, unit: 'mm' },
  });

  process.stdout.write('[6/8] 生成 ops / apply / check / archlang 双编 / DXF 自检\n');
  const build = await pipeline.confirmCalibrationAndBuild();

  process.stdout.write('[7/8] 生图提交确认 + 受控请求工具（TEST DOUBLE）\n');
  const image = await pipeline.confirmImageSubmission({ approved: true, mode: 'mock' });

  process.stdout.write('[8/8] 整理交付包\n');
  const finished = await pipeline.packageAndFinish();

  const summary = {
    ranAt: new Date().toISOString(),
    projectId: project.projectId,
    versionId: finished.manifest.versionId,
    statesObserved: [submission.state, build.state, image.state, finished.state],
    safeStorage: config.safeStorage,
    archlangExits: build.archResult.exits,
    opencalqueExits: build.ocResult.exits,
    dxfDeterministic: build.archResult.deterministic,
    dxfCheckPassed: build.dxfCheck.ok,
    imageTestDouble: image.result?.testDouble ?? null,
    deliveryZip: finished.delivery.zipPath,
    mode: 'mock（测试替身，待客户 API Key 联调）',
  };
  await writeJson(path.join(RUNTIME_DIR, 'pipeline-summary.json'), summary);
  process.stdout.write(`\n完成。交付包：${finished.delivery.zipPath}\n`);
  process.stdout.write(`摘要：app/.runtime/pipeline-summary.json\n`);
  await mock.close();
  return summary;
}

main().catch((error) => {
  process.stderr.write(`[pipeline] 失败：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
