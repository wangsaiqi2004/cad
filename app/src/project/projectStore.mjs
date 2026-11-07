// @ts-check
/**
 * 项目 / 版本 / 最近项目持久化（P0-06 / P0-18 / 5.9）。
 *
 * 目录约定（所有 Key 都不落在项目目录内）：
 *  projects/<projectId>/project.json
 *  projects/<projectId>/requirements.json
 *  projects/<projectId>/calibration.json
 *  projects/<projectId>/structured-plan.json
 *  projects/<projectId>/sources/          导入的原始资料（保留源文件）
 *  projects/<projectId>/versions/<vNNN>/ 每次生成一个新版本，绝不覆盖
 *  projects/<projectId>/tasks/           真实任务状态机落盘
 *  projects/<projectId>/audit.ndjson
 *  projects/<projectId>/idempotency.json
 *  projects/recent.json
 * @module project/projectStore
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { newId, nowIso, ensureDir, exists, readJson, writeJson, assertNotExists, assertWithin } from '../core/util.mjs';

export class ProjectStore {
  /** @param {{projectsRoot:string}} opts */
  constructor(opts) {
    this.projectsRoot = path.resolve(opts.projectsRoot);
    this.recentFile = path.join(this.projectsRoot, 'recent.json');
  }

  /** @param {string} projectId @returns {Object} 项目内各路径 */
  paths(projectId) {
    const root = path.join(this.projectsRoot, projectId);
    return {
      root,
      projectJson: path.join(root, 'project.json'),
      requirements: path.join(root, 'requirements.json'),
      calibration: path.join(root, 'calibration.json'),
      structuredPlan: path.join(root, 'structured-plan.json'),
      sources: path.join(root, 'sources'),
      versions: path.join(root, 'versions'),
      tasks: path.join(root, 'tasks'),
      audit: path.join(root, 'audit.ndjson'),
      idempotency: path.join(root, 'idempotency.json'),
      taskLog: path.join(root, 'task-log.ndjson'),
    };
  }

  /**
   * 新建项目（项目 ID 唯一，绝不覆盖已有项目）。
   * @param {{name:string, client?:string, address?:string, notes?:string}} input
   */
  async create(input) {
    if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 120) {
      throw Object.assign(new Error('项目名称必须是 1–120 字符的非空文本'), { code: 'E_VALIDATION' });
    }
    await ensureDir(this.projectsRoot);
    const projectId = `prj_${newId('p').slice(2, 14)}`;
    const p = this.paths(projectId);
    if (await exists(p.projectJson)) throw new Error('项目 ID 冲突');
    await ensureDir(p.sources);
    await ensureDir(p.versions);
    await ensureDir(p.tasks);
    const project = {
      projectId,
      name: input.name.trim(),
      client: String(input.client || '').trim(),
      address: String(input.address || '').trim(),
      notes: String(input.notes || '').trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      currentState: 'DRAFT',
      currentVersionId: null,
      versions: [],
    };
    await writeJson(p.projectJson, project);
    await this._touchRecent(projectId);
    return project;
  }

  /** @param {string} projectId */
  async get(projectId) {
    const project = await readJson(this.paths(projectId).projectJson, null);
    if (!project) throw Object.assign(new Error(`项目不存在：${projectId}`), { code: 'E_VALIDATION' });
    assertWithin(this.projectsRoot, this.paths(projectId).root);
    return project;
  }

  /** 最近项目列表（无假数据，空即为空）。 */
  async listRecent() {
    const ids = await readJson(this.recentFile, []);
    if (!Array.isArray(ids)) return [];
    /** @type {Array<Object>} */
    const result = [];
    for (const projectId of ids) {
      try {
        const project = await this.get(projectId);
        result.push({
          projectId: project.projectId,
          name: project.name,
          client: project.client,
          updatedAt: project.updatedAt,
          currentState: project.currentState,
          currentVersionId: project.currentVersionId,
          versionCount: (project.versions || []).length,
        });
      } catch { /* 项目已被手工移除，跳过 */ }
    }
    return result;
  }

  /** @param {string} projectId */
  async _touchRecent(projectId) {
    const ids = await readJson(this.recentFile, []);
    const list = Array.isArray(ids) ? ids.filter((id) => id !== projectId) : [];
    list.unshift(projectId);
    await writeJson(this.recentFile, list.slice(0, 8));
  }

  /**
   * 分配一个新的版本目录（永远不复用 / 不覆盖已有版本号）。
   * 重做 = 新 Task + 新 versionId，旧版本完整保留。
   * @param {string} projectId
   * @returns {Promise<{versionId:string,dir:string}>}
   */
  async newVersion(projectId) {
    const project = await this.get(projectId);
    const p = this.paths(projectId);
    await ensureDir(p.versions);
    const entries = await fs.readdir(p.versions, { withFileTypes: true });
    let max = 0;
    for (const entry of entries) {
      const match = /^v(\d{3,})$/.exec(entry.name);
      if (entry.isDirectory() && match) max = Math.max(max, Number(match[1]));
    }
    const versionId = `v${String(max + 1).padStart(3, '0')}`;
    const dir = path.join(p.versions, versionId);
    await ensureDir(dir);
    await ensureDir(path.join(dir, 'image'));
    await ensureDir(path.join(dir, 'human-edits'));
    project.versions = [...(project.versions || []), versionId];
    project.currentVersionId = versionId;
    project.updatedAt = nowIso();
    await writeJson(p.projectJson, project);
    await this._touchRecent(projectId);
    return { versionId, dir };
  }

  /** @param {string} projectId @param {string} versionId */
  versionDir(projectId, versionId) {
    const dir = path.join(this.paths(projectId).versions, versionId);
    assertWithin(this.projectsRoot, dir);
    return dir;
  }

  /**
   * 更新项目状态徽标（与状态机事件一一对应）。
   * @param {string} projectId
   * @param {{state?:string,versionId?:string}} patch
   */
  async updateMeta(projectId, patch) {
    const project = await this.get(projectId);
    if (patch.state) project.currentState = patch.state;
    if (patch.versionId) project.currentVersionId = patch.versionId;
    project.updatedAt = nowIso();
    await writeJson(this.paths(projectId).projectJson, project);
    return project;
  }

  /**
   * 写版本清单（不含 Key）。若已存在则拒绝覆盖，保护人工编辑。
   * @param {string} projectId @param {string} versionId @param {Object} manifest
   */
  async writeManifest(projectId, versionId, manifest) {
    const file = path.join(this.versionDir(projectId, versionId), 'manifest.json');
    await assertNotExists(file);
    await writeJson(file, { versionId, ...manifest, writtenAt: nowIso() });
    return file;
  }

  /** @param {string} projectId @param {string} versionId */
  async readManifest(projectId, versionId) {
    return readJson(path.join(this.versionDir(projectId, versionId), 'manifest.json'), null);
  }

  /**
   * 生成成果文件前调用：目标不存在才允许写入，避免覆盖人工编辑。
   * @param {string} projectId @param {string} versionId @param {string} relativeName
   */
  async guardedArtifact(projectId, versionId, relativeName) {
    const dir = this.versionDir(projectId, versionId);
    const file = path.join(dir, relativeName);
    assertWithin(dir, file);
    await assertNotExists(file);
    return file;
  }
}
