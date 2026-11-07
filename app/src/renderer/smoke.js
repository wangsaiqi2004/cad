/**
 * 无人值守自检：`npm run smoke:desktop` 就是靠这段脚本证明
 * 「桌面壳 → 本地桥 → 领域核心 → 权限门」整条链路真的通。
 *
 * 只调用真实工具，不伪造结果；任何一步 code 不为 0 都会写进结论并让脚本判失败。
 * @module renderer/smoke
 */

/**
 * @param {{call:Function, info:Function, patch:Function}} deps
 */
export async function runSmoke({ call, info, patch }) {
  const out = { ok: true, startedAt: new Date().toISOString(), steps: [] };
  const push = (name, result, extra = {}) => {
    out.steps.push({ name, code: result.code, hasData: Boolean(result.data), message: result.message, ...extra });
    return result;
  };

  const readOnly = ['getHome', 'getSettings', 'getBoundary', 'getFormatMatrix', 'listRecent'];
  for (const name of readOnly) {
    const result = push(name, await call(name, {}));
    if (result.code !== 0) out.ok = false;
  }
  patch({ badge: '测试中' });

  // 未确认的受控动作必须被拒绝（权限门生效）。
  const denied = push('未确认的受控动作', await call('confirmAndBuild', {}), {});
  if (denied.code !== 1 || denied.data?.errorCode !== 'E_PERMISSION_DENIED') out.ok = false;

  // 不在白名单里的操作必须被拒绝。
  const forbidden = push('越权命令', await call('system_run_command', { command: 'dir' }), {});
  if (forbidden.code !== 1) out.ok = false;

  const project = push('新建项目', await call('newProject', { name: '桌面桥接冒烟项目', client: '自检' }), {
    projectId: null,
  });
  if (project.code !== 0) out.ok = false;
  else {
    out.steps[out.steps.length - 1].projectId = project.data?.project?.projectId || null;
    if (project.data?.project?.projectId) {
      patch({
        projectId: project.data.project.projectId,
        projectName: project.data.project.name || '',
      });
    }
  }

  push('任务状态', await call('getTaskStatus', {}), {});
  push('读校准项', await call('getCalibration', {}), {});
  push('版本列表', await call('getVersions', {}), {});

  try { out.info = await info(); } catch { out.info = { error: '无法读取运行信息' }; }
  // 冒烟只关心链路是否通，读不到版本列表也不算失败（新项目本来就没有版本）。
  out.finishedAt = new Date().toISOString();
  await globalThis.reno.smokeResult(out);
}
