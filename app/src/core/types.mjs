// @ts-check
/**
 * 全局共享类型、枚举与静态文案。
 *
 * 约定（跨文件强制）：
 *  - 单位恒为毫米 (mm)；坐标原点在左上，X 向右、Y 向下（与 opencalque 一致）。
 *  - `StructuredPlan` 是唯一权威数据源，两条 CAD 发射器都由它驱动，不反向同步。
 *  - 任何外部付费请求必须绑定 taskId + stepId + idempotencyKey。
 *  - 界面文案一律中文；API Key 永不进入日志 / 对话 / 项目文件 / 导出包。
 *
 * @module core/types
 */

export const UNIT = 'mm';
export const SCHEMA_VERSION = '1.0.0';

/** 任务状态机状态（PRD 4.4）。 */
export const TASK_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  INGESTING: 'INGESTING',
  EXTRACTING: 'EXTRACTING',
  AWAITING_CALIBRATION: 'AWAITING_CALIBRATION',
  STRUCTURE_READY: 'STRUCTURE_READY',
  LAYOUT_PLANNING: 'LAYOUT_PLANNING',
  CAD_BUILDING: 'CAD_BUILDING',
  CAD_CHECKING: 'CAD_CHECKING',
  IMAGE_AWAITING_CONFIRM: 'IMAGE_AWAITING_CONFIRM',
  IMAGE_GENERATING: 'IMAGE_GENERATING',
  PACKAGING: 'PACKAGING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

/** 状态中文文案（界面与任务日志一一对应）。 */
export const STATE_LABELS = Object.freeze({
  DRAFT: '草稿，尚未提交',
  INGESTING: '读取资料',
  EXTRACTING: '解析资料',
  AWAITING_CALIBRATION: '等待尺寸确认',
  STRUCTURE_READY: '户型已确认',
  LAYOUT_PLANNING: '生成布局',
  CAD_BUILDING: '调用 CAD 出图',
  CAD_CHECKING: '检查图纸',
  IMAGE_AWAITING_CONFIRM: '等待你确认生图提交',
  IMAGE_GENERATING: '已提交生图请求，等待返回',
  PACKAGING: '整理交付',
  DONE: '完成',
  FAILED: '失败',
  CANCELLED: '已取消',
});

/** 阻塞态：必须真实停住，界面显示「等待你操作」，不显示百分比 / ETA。 */
export const BLOCKING_STATES = Object.freeze([
  'AWAITING_CALIBRATION',
  'IMAGE_AWAITING_CONFIRM',
]);

/** 外部等待态：不显示百分比、不显示 ETA。 */
export const WAITING_STATES = Object.freeze(['IMAGE_GENERATING']);

export const TERMINAL_STATES = Object.freeze(['DONE', 'FAILED', 'CANCELLED']);

/** 合法状态转移表；任何不在表内的转移直接抛错，杜绝假进度。 */
export const STATE_TRANSITIONS = Object.freeze({
  DRAFT: ['INGESTING', 'CANCELLED'],
  INGESTING: ['EXTRACTING', 'FAILED', 'CANCELLED'],
  EXTRACTING: ['AWAITING_CALIBRATION', 'FAILED', 'CANCELLED'],
  AWAITING_CALIBRATION: ['STRUCTURE_READY', 'FAILED', 'CANCELLED'],
  STRUCTURE_READY: ['LAYOUT_PLANNING', 'FAILED', 'CANCELLED'],
  LAYOUT_PLANNING: ['CAD_BUILDING', 'FAILED', 'CANCELLED'],
  CAD_BUILDING: ['CAD_CHECKING', 'FAILED', 'CANCELLED'],
  CAD_CHECKING: ['IMAGE_AWAITING_CONFIRM', 'STRUCTURE_READY', 'FAILED', 'CANCELLED'],
  IMAGE_AWAITING_CONFIRM: ['IMAGE_GENERATING', 'PACKAGING', 'FAILED', 'CANCELLED'],
  IMAGE_GENERATING: ['PACKAGING', 'FAILED', 'CANCELLED'],
  PACKAGING: ['DONE', 'FAILED'],
  FAILED: ['LAYOUT_PLANNING', 'IMAGE_AWAITING_CONFIRM', 'CANCELLED', 'INGESTING'],
  CANCELLED: ['INGESTING'],
  DONE: ['INGESTING'],
});

/** 模型配置两组（互不共用 URL / Key / 模型名）。 */
export const MODEL_GROUPS = Object.freeze({
  TEXT_VISION: 'textVision',
  IMAGE_GEN: 'imageGen',
});

export const MODEL_GROUP_LABELS = Object.freeze({
  textVision: '文本 / 视觉模型',
  imageGen: '图片生成模型',
});

/** 5 项独立测试的能力（PRD 4.8）。 */
export const CAPABILITIES = Object.freeze([
  'textGeneration',
  'toolCalling',
  'imageUnderstanding',
  'imageGeneration',
  'imageEditing',
]);

export const CAPABILITY_LABELS = Object.freeze({
  textGeneration: '文本生成',
  toolCalling: '工具调用',
  imageUnderstanding: '图片理解',
  imageGeneration: '图片生成',
  imageEditing: '图片编辑',
});

export const CAPABILITY_GROUP = Object.freeze({
  textGeneration: 'textVision',
  toolCalling: 'textVision',
  imageUnderstanding: 'textVision',
  imageGeneration: 'imageGen',
  imageEditing: 'imageGen',
});

/** 能力测试结论。 */
export const CAPABILITY_STATUS = Object.freeze({
  NOT_TESTED: 'not_tested',
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
  FAILED: 'failed',
  NOT_CONFIGURED: 'not_configured',
});

/** 能力结论对应的 UI 行为（不通过时禁用什么）。 */
export const CAPABILITY_DISABLES = Object.freeze({
  textGeneration: '布局与对话生成',
  toolCalling: '依赖工具调用的自动化步骤',
  imageUnderstanding: '资料图片自动解析（降级为仅人工填写，不假装已识别）',
  imageGeneration: '生成效果图',
  imageEditing: '基于 CAD 视图 / 参考图的图片编辑动作',
});

/** Provider / 接口类型预设（只是接口类型标签，不含任何 URL / Key / 模型名）。 */
export const PROVIDER_PRESETS = Object.freeze([
  { id: 'openai-compatible', label: 'OpenAI 兼容接口 /chat/completions' },
  { id: 'openai-images', label: 'OpenAI 兼容接口 /images' },
  { id: 'custom', label: '自定义 HTTP 接口' },
]);

/** 按阶段支持格式与处理方式（PRD 3.5）。逐行可在 UI 与交付说明中核对。 */
export const FORMAT_MATRIX = Object.freeze([
  {
    stage: '资料上传',
    inputs: '户型图 / 现场照片：JPG、PNG、HEIC、WEBP',
    handling: '校验可读性与去重、记录图片元数据，作为校准底图与视觉线索',
    output: '底图 + 图片元数据',
    boundary: '不自动矢量化；图片识别只给候选线索，不产出带尺寸的结构化平面',
  },
  {
    stage: '资料上传',
    inputs: 'PDF（户型图 / 量房草图）',
    handling: '校验 PDF 头并抽取可见文本片段；仅作为校准参考，比例未知',
    output: '页信息 + 文本片段',
    boundary: '比例未知，必须人工校准；不承诺自动提取尺寸、不承诺逐页渲染',
  },
  {
    stage: '资料上传',
    inputs: 'DXF',
    handling: '作为结构化候选输入，交由 opencalque import 解析图层 / 线段',
    output: '候选墙 / 门窗线段',
    boundary: 'V1 可读 DXF；不写 DWG',
  },
  {
    stage: '资料上传',
    inputs: 'DWG',
    handling: '不解析；明确提示「请用 CAD 另存为 DXF 后导入」',
    output: '提示信息',
    boundary: '不声称任何 DXF 库能直接读写 DWG；不把 DXF 改后缀叫 DWG',
  },
  {
    stage: '资料上传',
    inputs: '参考效果图：JPG、PNG',
    handling: '作为效果图风格 / 材质 / 光照的参考输入',
    output: '参考图引用',
    boundary: '图像模型可能改变结构与尺寸',
  },
  {
    stage: '校准',
    inputs: '底图 + 候选线段',
    handling: '人工补漏薄内墙、合并房间、核对洞口与尺寸、由用户输入两点 + 已知真实距离设定比例',
    output: '版本化结构化平面数据',
    boundary: '正式必经步骤，不可跳过；尺度来源必须是用户提供的已知距离',
  },
  {
    stage: '出图',
    inputs: '结构化平面 + 布局方案',
    handling: '程序生成 DXF / SVG：墙、门窗、家具、图层、标注、必要尺寸',
    output: '可编辑 DXF + 预览',
    boundary: '仅原始结构图 + 平面布置方案；不生成整套施工图',
  },
  {
    stage: '生图',
    inputs: 'CAD 视图 / 程序生成布局图 + 参考图 + 需求描述',
    handling: '调用客户配置的图片生成 / 编辑能力',
    output: 'PNG/JPG + 生图记录',
    boundary: '不承诺透视效果图与 CAD 几何 / 尺寸一致；效果图不作为施工依据',
  },
  {
    stage: '交付',
    inputs: '上述产物',
    handling: '写入新版本目录 + 导出 ZIP 交付包（导出前做 Key 明文自检）',
    output: '交付包（不含密钥）',
    boundary: '不覆盖人工编辑',
  },
]);

/** 必须出现在界面与交付说明中的边界声明（PRD 5.3–5.8 / DoD-9）。 */
export const BOUNDARY_STATEMENTS = Object.freeze([
  'V1 只交付「原始结构图 + 平面布置方案」，不生成整套施工图（水电 / 立面 / 节点 / 大样 / 材料表 / 造价清单）。',
  'V1 可交付的可编辑 CAD 格式只有 DXF（ASCII，AutoCAD R2000 / R12 兼容）；不提供、不宣称 DWG。',
  '如需 DWG，请在 AutoCAD / ZWCAD 中打开本 DXF 后另存为 DWG，该步骤由用户完成。软件不会把 DXF 改后缀称 DWG，也不声称任何 DXF 库能直接读写 DWG。',
  '软件不承诺把上传的户型图片 / PDF 自动转成带尺寸的结构化平面；「用户校准 + 人工修正」是正式必经步骤。',
  '图像模型可能改变结构和尺寸；不承诺透视效果图与 CAD 几何 / 尺寸完全一致，效果图不作为施工依据。',
  '本机未检测到任何建筑 CAD 与 COM 组件，V1 不做 AutoCAD COM 自动化与原生 DWG 读写。',
  '模型费用全部由客户自己的 API 账户承担；软件不做代付 / 余额 / 充值 / 模型中转，不部署公网后端。',
]);

/** 8 项需求字段（PRD 3.4）。 */
export const REQUIREMENT_FIELDS = Object.freeze([
  { key: 'area', label: '面积', required: 'suggested', unit: 'm²', candidateSource: '资料候选' },
  { key: 'dimensions', label: '尺寸（开间 / 进深 / 各房间尺寸）', required: 'after_calibration', unit: 'mm', candidateSource: '校准步骤' },
  { key: 'ceilingHeight', label: '层高', required: 'suggested', unit: 'mm', candidateSource: '用户填写 / 资料候选' },
  { key: 'roomUses', label: '房间用途', required: 'required', unit: '—', candidateSource: '资料候选 + 用户确认' },
  { key: 'occupants', label: '居住人数', required: 'suggested', unit: '人', candidateSource: '用户填写' },
  { key: 'style', label: '风格', required: 'for_image', unit: '—', candidateSource: '用户填写 / 参考图线索' },
  { key: 'budget', label: '预算', required: 'optional', unit: '元', candidateSource: '用户填写' },
  { key: 'specialRequirements', label: '特殊要求', required: 'optional', unit: '—', candidateSource: '用户填写 / 对话补充' },
]);

/** 错误码与可读中文文案（PRD 4.5）。 */
export const ERROR_CODES = Object.freeze({
  E_NO_MODEL_CONFIG: 'E_NO_MODEL_CONFIG',
  E_INVALID_KEY: 'E_INVALID_KEY',
  E_RATE_LIMIT: 'E_RATE_LIMIT',
  E_TIMEOUT_UNKNOWN: 'E_TIMEOUT_UNKNOWN',
  E_SERVICE_UNAVAILABLE: 'E_SERVICE_UNAVAILABLE',
  E_CAPABILITY_UNSUPPORTED: 'E_CAPABILITY_UNSUPPORTED',
  E_RESULT_INVALID: 'E_RESULT_INVALID',
  E_CALIBRATION_BLOCKED: 'E_CALIBRATION_BLOCKED',
  E_PERMISSION_DENIED: 'E_PERMISSION_DENIED',
  E_DXF_CHECK_FAILED: 'E_DXF_CHECK_FAILED',
  E_IDEMPOTENCY_BLOCKED: 'E_IDEMPOTENCY_BLOCKED',
  E_NO_SAFE_STORAGE: 'E_NO_SAFE_STORAGE',
  E_ENGINE_FAILED: 'E_ENGINE_FAILED',
  E_FILE_UNSUPPORTED: 'E_FILE_UNSUPPORTED',
  E_VALIDATION: 'E_VALIDATION',
});

export const ERROR_MESSAGES = Object.freeze({
  E_NO_MODEL_CONFIG: '尚未配置文本 / 图片模型，请先在模型设置中完成配置与能力测试。',
  E_INVALID_KEY: 'API Key 无效或无权限（不显示 Key 内容），请检查模型设置。',
  E_RATE_LIMIT: '接口返回限额（429），请稍后再试或更换模型配置；本次不会自动重试。',
  E_TIMEOUT_UNKNOWN: '请求超时，结果未知，未自动重发以避免重复计费。请先检查结果或放弃并新建任务。',
  E_SERVICE_UNAVAILABLE: '模型服务暂时不可用，请稍后重试或检查 API Base URL。',
  E_CAPABILITY_UNSUPPORTED: '当前端点不支持所需能力，请更换 Provider 或接口类型；相关功能已禁用，不静默失败。',
  E_RESULT_INVALID: '生成结果未通过检查，未写入版本。',
  E_CALIBRATION_BLOCKED: '尺寸 / 比例 / 结构墙存在待确认项，任务停在等待校准态。',
  E_PERMISSION_DENIED: '已拒绝：Agent 请求了项目路径外的访问、命令执行或未在白名单内的操作。',
  E_DXF_CHECK_FAILED: '图纸检查未通过，请回到校准或重新生成。',
  E_IDEMPOTENCY_BLOCKED: '该请求已经提交过；仅允许用户显式重试，超时结果未知时禁止直接重提。',
  E_NO_SAFE_STORAGE: '未找到可用的本机安全凭据存储（Electron safeStorage）。请运行 npm run setup 或设置 RENO_ELECTRON_PATH。',
  E_ENGINE_FAILED: '本地 CAD 引擎执行失败，未产出成果。',
  E_FILE_UNSUPPORTED: '文件格式不支持或不可读。',
  E_VALIDATION: '输入未通过校验。',
});

/** @typedef {'DRAFT'|'INGESTING'|'EXTRACTING'|'AWAITING_CALIBRATION'|'STRUCTURE_READY'|'LAYOUT_PLANNING'|'CAD_BUILDING'|'CAD_CHECKING'|'IMAGE_AWAITING_CONFIRM'|'IMAGE_GENERATING'|'PACKAGING'|'DONE'|'FAILED'|'CANCELLED'} TaskState */
/** @typedef {{ id: string, name: string, use: string, x: number, y: number, w: number, h: number }} PlanRoom */
/** @typedef {{ id: string, a: {x:number,y:number}, b: {x:number,y:number}, thickness: number, kind: 'exterior'|'interior' }} PlanWall */
/** @typedef {{ id: string, type: 'door'|'window', wallId: string, at: number, width: number }} PlanOpening */
/** @typedef {{ id: string, kind: string, x: number, y: number, w: number, h: number, roomId: string }} PlanFurniture */
/** @typedef {{ schemaVersion: string, unit: 'mm', planId: string, versionId: string, source: string, calibration: Object, shell: Object, rooms: PlanRoom[], walls: PlanWall[], openings: PlanOpening[], furniture: PlanFurniture[], dimensions: Array<Object>, requirements: Object, generatedAt: string }} StructuredPlan */
/** @typedef {{ taskId: string, projectId: string, versionId: string, state: TaskState, stateEnteredAt: string, subProgress: {done:number,total:number,unit:string}, events: Array<Object>, errorCode: string|null, idempotencyKey: string|null, chargeSubmittedCount: number, createdAt: string }} TaskRecord */
/** @typedef {{ provider: string, apiBaseUrl: string, apiKey: string, modelName: string, capabilityNote: string }} ModelGroupConfig */
/** @typedef {{ textVision: ModelGroupConfig, imageGen: ModelGroupConfig }} ModelSettings */
