// @ts-check
/**
 * L2 Skill / 提示词加载器（薄层 #2）。
 *
 * 只做 front-matter markdown 装载，不实现 Agent Runtime：
 *  - 读 vendor/archlang/skills 下各子目录的 SKILL.md（5 个现成资产）
 *  - 读 app/skills 下各子目录的 SKILL.md（本产品的装修效果图 / 校准工作流指令）
 *  - 注入 systemPrompt（对应 opencalque `apps/web/src/ai/agent.ts:75` 挂点）
 *
 * 加载结果不含任何 URL / Key / 模型名，Skill 不存密钥、不承担安全或网络职责。
 * @module skill/skillLoader
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * 解析极简 YAML front-matter（key: value，值不做复杂 YAML 解析）。
 * @param {string} text
 * @returns {{meta:Record<string,string>,body:string}}
 */
export function parseFrontMatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: normalized };
  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  /** @type {Record<string,string>} */
  const meta = {};
  for (const line of head.split('\n')) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) meta[match[1]] = match[2].trim();
  }
  return { meta, body: body.trim() };
}

export class SkillLoader {
  /** @param {{roots?:string[]}} [opts] */
  constructor(opts = {}) {
    this.roots = opts.roots || [
      path.join(APP_ROOT, 'skills'),
      path.join(WORKSPACE_ROOT, 'vendor', 'archlang', 'skills'),
    ];
    /** @type {Array<{id:string,name:string,description:string,license:string,body:string,sourcePath:string}>} */
    this.skills = [];
  }

  /** 递归加载所有 SKILL.md。 @returns {Promise<Array<Object>>} */
  async loadAll() {
    /** @type {string[]} */
    const files = [];
    const walk = async (dir, depth) => {
      if (depth > 3) return;
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') files.push(full);
      }
    };
    for (const root of this.roots) await walk(root, 0);
    this.skills = [];
    for (const file of files.sort()) {
      const text = await fs.readFile(file, 'utf8');
      const { meta, body } = parseFrontMatter(text);
      const id = meta.name || path.basename(path.dirname(file));
      this.skills.push({
        id,
        name: meta.name || id,
        description: meta.description || '',
        license: meta.license || '',
        body,
        sourcePath: file,
      });
    }
    return this.skills;
  }

  /** @param {string} id */
  get(id) {
    return this.skills.find((skill) => skill.id === id) || null;
  }

  /** 列出 Skill 摘要（界面可显示为斜杠命令，不暴露 MCP / YAML / 终端字样）。 */
  listPublic() {
    return this.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description.slice(0, 160),
      license: skill.license,
    }));
  }

  /**
   * 构造注入 Agent 的中文提示词片段。
   * 关键：**默认需用户确认**（覆盖 opencalque agent.ts:76 的「不确认」策略）。
   * @param {{projectRoot:string, boundaryStatements:string[]}} opts
   * @returns {string}
   */
  buildSystemPrompt(opts) {
    const skillLines = this.skills.map((skill) => `- ${skill.name}：${skill.description.slice(0, 120)}`).join('\n');
    const boundary = opts.boundaryStatements.map((line) => `- ${line}`).join('\n');
    return [
      '你是装修设计软件内置的绘图助手，员工正在一个项目里工作。',
      '',
      '# 权限与确认（默认需确认）',
      `你只能在当前项目路径内工作：${opts.projectRoot}`,
      '任何会修改文件、调用外部模型、导出图纸或发起付费请求的操作，都**必须先取得用户的预执行确认**；',
      '未获确认一律不执行。只读查看（图纸说明、检查、测量）可以直接进行。',
      '撤销（undo）不是安全边界，不得据此跳过确认。',
      '禁止：任意系统命令、任意脚本执行、项目路径外的读写、未受控绝对路径。',
      '',
      '# 图纸编辑规范',
      '所有坐标与长度单位为毫米。墙由 a→b 中线 + thickness 定义；共享角点必须坐标完全相同。',
      '门 / 窗会切墙（cutsWalls），插入点须落在墙中线上，rotation 取墙 a→b 的方向角。',
      '第一次编辑前先读取图纸编辑指南；改完后检查图纸并核对房间是否闭合。',
      '',
      '# 已加载的工作流说明（Skill）',
      skillLines || '（无）',
      '',
      '# 必须如实说明的边界',
      boundary,
    ].join('\n');
  }
}
