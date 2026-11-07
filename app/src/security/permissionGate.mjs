// @ts-check
/**
 * L3 权限确认中间件（PRD P0-13 / 4.6 / 5.10）。
 *
 * 对应 opencalque 精确改造点：
 *  - `apps/web/src/ai/agent.ts:76` 原文 "it is fine to act on a clear request without asking
 *    for confirmation first" —— 这里改为「白名单只读放行 + 其余默认需用户预执行确认」，
 *    明确不把 undo 当安全边界。
 *  - `apps/web/src/ai/agent.ts:211` runDrawingTool 前置切面 —— 本类即该切面。
 *
 * 五项硬约束：工具白名单、路径沙箱、参数校验、预执行用户确认、审计日志。
 * 明确禁用：任意系统命令、任意脚本执行、未受控绝对路径读写。
 * Autocad-MCP 的 denylist 不作为安全边界（仓库自身 ≥4 处否认），本类自建正向白名单。
 * @module security/permissionGate
 */

import path from 'node:path';
import { PermissionDeniedError } from '../core/errors.mjs';
import { isPlainObject, isSafeFileName, assertWithin, safeResolve, assertNumberInRange } from '../core/util.mjs';

/** 只读工具：允许直接执行（仍写审计），不改变任何文件、不发起外部请求。 */
export const READ_ONLY_TOOLS = Object.freeze([
  'read_guide', 'describe_drawing', 'check_drawing', 'measure_drawing', 'view_drawing',
  'open_drawing', 'list_versions', 'read_task_log', 'list_capabilities',
  'read_settings_public', 'check_result', 'read_audit_log',
]);

/** 受控工具：默认需要用户预执行确认。 */
export const CONTROLLED_TOOLS = Object.freeze([
  'apply_operations', 'compile_arch', 'export_dxf', 'export_svg', 'export_package',
  'generate_image', 'edit_image', 'import_dxf', 'write_structured_plan',
  'write_calibration', 'write_requirements', 'save_image_record', 'mark_done',
]);

export const TOOL_ALLOWLIST = new Set([...READ_ONLY_TOOLS, ...CONTROLLED_TOOLS]);

/** 明确点名禁止的工具名（用于更清楚的拒绝理由，不是安全边界本身）。 */
export const EXPLICITLY_FORBIDDEN = Object.freeze([
  'system_run_command', 'system_run_lisp', 'run_script', 'exec', 'spawn', 'shell',
  'eval', 'read_file_any', 'write_file_any', 'delete_any', 'set_env',
  'drawing_open_any', 'drawing_export_dwg', 'xref_attach_any', 'app_load',
]);

/** apply_operations 允许的操作动词（正向白名单，不依赖命令 denylist）。 */
export const ALLOWED_OPS = new Set([
  'set_document', 'add_node', 'update_node', 'remove_node',
  'add_layer', 'update_layer', 'remove_layer',
  'add_color', 'update_color', 'remove_color',
  'add_dimension_style', 'update_dimension_style', 'remove_dimension_style',
  'add_material', 'update_material', 'remove_material',
]);

const DANGEROUS_KEYS = new Set([
  'command', 'cmd', 'script', 'shell', 'exec', 'executable', 'code', 'eval',
  '__proto__', 'constructor', 'prototype', 'proc', 'subprocess',
]);

const PATH_KEYS = new Set([
  'path', 'file', 'out', 'output', 'target', 'source', 'dir', 'directory',
  'imagePath', 'dxfPath', 'opsPath', 'packagePath', 'archPath', 'svgPath',
  'pdfPath', 'drawingPath', 'backgroundImage', 'referenceImage',
]);

const MAX_STRING = 200_000;
const MAX_OPS = 500;

/**
 * 递归扫描参数对象：拒绝危险键、非有限数值、超长字符串、非 mm 单位。
 * @param {unknown} value
 * @param {string} trail
 */
function scanValue(value, trail = 'params') {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) {
      throw new PermissionDeniedError(`参数 ${trail} 超过 ${MAX_STRING} 字符上限`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
      throw new PermissionDeniedError(`参数 ${trail} 不是有限毫米数值`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_OPS * 4) throw new PermissionDeniedError(`参数 ${trail} 数组过长`);
    value.forEach((item, index) => scanValue(item, `${trail}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new PermissionDeniedError(`参数 ${trail}.${key} 属于被禁止的命令 / 脚本通道`);
      }
      if (key === 'unit' && item !== 'mm') {
        throw new PermissionDeniedError(`单位必须为 mm，收到 ${String(item)}`);
      }
      scanValue(item, `${trail}.${key}`);
    }
  }
}

/**
 * 校验所有路径参数：必须落在当前项目根目录内；拒绝 UNC / ADS / 遍历 / 危险后缀。
 * @param {Record<string, unknown>} params
 * @param {string} projectRoot
 * @param {string} trail
 */
function validatePaths(params, projectRoot, trail = 'params') {
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && PATH_KEYS.has(key)) {
      const raw = value.trim();
      if (raw.startsWith('\\\\') || raw.includes('?\\')) {
        throw new PermissionDeniedError(`拒绝 UNC / 设备路径：${key}`);
      }
      if (!isSafeFileName(path.basename(raw))) {
        throw new PermissionDeniedError(`文件名不安全或后缀不在允许范围：${key}=${raw}`);
      }
      const absolute = path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)
        ? path.resolve(raw)
        : safeResolve(projectRoot, raw);
      assertWithin(projectRoot, absolute);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isPlainObject(item)) validatePaths(/** @type {Record<string,unknown>} */ (item), projectRoot, `${trail}.${key}`);
      }
    } else if (isPlainObject(value)) {
      validatePaths(/** @type {Record<string,unknown>} */ (value), projectRoot, `${trail}.${key}`);
    }
  }
}

/**
 * 工具特定参数校验。
 * @param {string} tool
 * @param {Record<string, unknown>} params
 */
function validateToolSpecific(tool, params) {
  if (tool === 'apply_operations') {
    const ops = params.ops;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) {
      throw new PermissionDeniedError(`apply_operations 需要 1–${MAX_OPS} 条操作`);
    }
    for (const op of ops) {
      if (!isPlainObject(op) || !ALLOWED_OPS.has(String(op.op))) {
        throw new PermissionDeniedError(`绘图操作未在白名单内：${String(isPlainObject(op) ? op.op : op)}`);
      }
    }
  }
  if (tool === 'compile_arch' || tool === 'write_structured_plan') {
    const source = params.source ?? params.plan;
    if (typeof source !== 'string' && !isPlainObject(source)) {
      throw new PermissionDeniedError('compile_arch 需要 .arch 源码或结构化平面对象');
    }
    if (typeof source === 'string' && source.length > MAX_STRING) {
      throw new PermissionDeniedError('.arch 源码超过长度上限');
    }
  }
  if (tool === 'generate_image' || tool === 'edit_image') {
    const prompt = params.prompt;
    if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 8000) {
      throw new PermissionDeniedError('生图提示词必须是 1–8000 字符的非空文本');
    }
  }
  if (params.thickness !== undefined) assertNumberInRange(Number(params.thickness), 1, 1000, '墙厚(mm)');
  if (params.width !== undefined) assertNumberInRange(Number(params.width), 1, 100000, '宽度(mm)');
  if (params.height !== undefined) assertNumberInRange(Number(params.height), 1, 100000, '高度(mm)');
}

/**
 * 权限确认门。
 *
 * 默认策略：**所有非只读操作都需要用户预执行确认**；未提供确认时一律拒绝（不静默放行、
 * 不降级、不把 undo 当安全边界）。「记住本次选择」只对完全相同的范围生效。
 */
export class PermissionGate {
  /**
   * @param {{projectRoot:string, audit:{append:(e:Object)=>Promise<Object>}, confirmer?:(req:Object)=>Promise<boolean>|boolean}} opts
   */
  constructor(opts) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.audit = opts.audit;
    // 默认拒绝：没有任何确认器时，所有受控操作都被拦下。
    this.confirmer = opts.confirmer || (() => false);
    /** @type {Set<string>} 已记住的授权范围 */
    this.remembered = new Set();
    /** @type {Array<Object>} 最近一次弹窗内容，供 UI / 验收核对 */
    this.lastPrompt = null;
  }

  /** 弹窗内容（PRD 4.6），中文、无 MCP / Skill / 终端字样。 @returns {Object} */
  describeGate(tool, params) {
    return {
      title: '请确认本次操作',
      allowedScope: this.projectRoot,
      allowedTool: tool,
      allowedDrawingOps: [...ALLOWED_OPS],
      explicitlyForbidden: ['任意系统命令', '任意脚本执行', '项目路径外的读写', '未受控绝对路径'],
      target: this._summarizeTarget(params),
      note: '仅本次允许 / 拒绝；可勾选「记住本次选择」，但扩大访问范围时会重新询问。',
    };
  }

  /** @param {Record<string,unknown>} params */
  _summarizeTarget(params) {
    for (const key of PATH_KEYS) {
      if (typeof params[key] === 'string') return String(params[key]);
    }
    return '(项目内操作)';
  }

  /**
   * 授权一次工具调用。
   * @param {{tool:string, params?:Record<string,unknown>, actor?:string, confirmation?:{approved:boolean,scope?:'once'|'remember',actor?:string}}} request
   * @returns {Promise<{allowed:true, tool:string, needsConfirmation:boolean, scope:string, remembered:boolean}>}
   */
  async authorize(request) {
    const tool = String(request.tool || '');
    const params = request.params && isPlainObject(request.params)
      ? /** @type {Record<string,unknown>} */ (request.params)
      : {};
    const actor = request.actor || 'agent';
    const target = this._summarizeTarget(params);
    const base = { actor, action: 'tool_call', tool, target };

    const deny = async (reason) => {
      await this.audit.append({ ...base, result: 'denied', detail: { reason } });
      throw new PermissionDeniedError(`已拒绝 ${tool || '(空工具名)'}：${reason}`);
    };

    // 1) 工具白名单（deny by default）
    if (!TOOL_ALLOWLIST.has(tool)) {
      const hint = EXPLICITLY_FORBIDDEN.includes(tool) ? '（明确禁止的命令 / 脚本 / 越权通道）' : '';
      await deny(`工具不在允许清单内${hint}`);
    }

    // 2) 参数校验：危险键、类型、数值范围、单位、后缀、工具特定约束
    try {
      scanValue(params);
      validatePaths(params, this.projectRoot);
      validateToolSpecific(tool, params);
    } catch (error) {
      await deny(error instanceof Error ? error.message : String(error));
    }

    const needsConfirmation = !READ_ONLY_TOOLS.includes(tool);
    let remembered = false;

    if (needsConfirmation) {
      const scope = `${tool}|${this.projectRoot}|${target}`;
      if (this.remembered.has(scope)) {
        remembered = true;
      } else {
        this.lastPrompt = this.describeGate(tool, params);
        const explicit = request.confirmation;
        const approved = explicit
          ? explicit.approved === true
          : Boolean(await this.confirmer(this.lastPrompt));
        if (!approved) await deny('用户未确认本次操作（默认需确认）');
        if (explicit && explicit.scope === 'remember') this.remembered.add(scope);
      }
    }

    await this.audit.append({
      ...base,
      result: 'allowed',
      detail: {
        needsConfirmation,
        remembered,
        readOnly: READ_ONLY_TOOLS.includes(tool),
        paramsKeys: Object.keys(params),
      },
    });
    return { allowed: true, tool, needsConfirmation, scope: `${tool}|${target}`, remembered };
  }

  /** 清空「记住本次选择」，扩大范围或换项目时必须调用。 */
  resetRemembered() {
    this.remembered.clear();
  }

  /** 只读放行 / 受控需确认的策略说明（用于全局一致性审查与文档）。 */
  static policy() {
    return {
      defaultConfirmation: true,
      readOnlyTools: READ_ONLY_TOOLS,
      controlledTools: CONTROLLED_TOOLS,
      denyByDefault: true,
      undoIsSafetyBoundary: false,
      pathSandbox: '当前项目根目录（绝对路径白名单，不在表内一律拒绝）',
      explicitlyForbidden: EXPLICITLY_FORBIDDEN,
    };
  }
}
