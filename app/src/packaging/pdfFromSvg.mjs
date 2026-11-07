// @ts-check
/**
 * 把 archlang 产出的 `plan.svg` 转成**矢量 PDF 预览**（PRD F7 / P0-11：DXF + SVG/PDF 预览）。
 *
 * 对外 API（`svgFileToPdf` 为唯一入口，`writePlanPdf` 是同引用别名）：
 *  - `svgFileToPdf({ svgPath, pdfPath }) → {ok:true, bytes, pages, shapes, texts, skippedTexts}`，
 *    成功返回统计值、失败抛错（调用方必须捕获，PDF 失败不得阻断交付）；
 *  - `svgTextToPdf(svgText)`：纯内存辅助，单测用。
 *
 * 硬约束：
 *  - 纯 JS、**零第三方依赖**（只用 `node:fs` / `node:path`）；不调用任何外部可执行文件，
 *    因此不依赖 archlang 的可选依赖 pdfkit，也不受外网 / npx 影响。
 *  - 只渲染已实测的 archlang SVG 子集：`rect` / `line` / `polygon` / `path(M L A Z)` / `text` /
 *    `g`（分组）/ `defs>pattern`（斜向剖面填充，近似为浅色实心）。
 *  - 文本用 Helvetica + WinAnsiEncoding（`²`=0xB2 可编码）；遇到 WinAnsi 之外的字符（例如中文）
 *    **跳过该条文本并计数**，绝不抛错、绝不输出乱码。
 *  - 页面固定 A4 横向 842×595 pt，按 viewBox 等比缩放并居中，留 20pt 边距。
 *  - PDF 1.4、内容流不压缩、手写 xref / trailer / startxref。
 *  - 已知保真度损失：`<pattern>` 斜线纹理不渲染；WinAnsi 之外的标注（如中文项目名）不渲染。
 * @module packaging/pdfFromSvg
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** A4 横向页面尺寸（pt）。 */
export const PAGE = Object.freeze({ width: 842, height: 595 });
/** 页边距（pt）。 */
const MARGIN = 20;

/** 未解析到 `<pattern>` 填充时的兜底浅色（接近 archlang 的 #e9e4db）。 */
const PATTERN_FALLBACK = '#e9e4db';

/** 极简命名色表（archlang 只用十六进制，这里只兜底常见写法）。 */
const NAMED_COLORS = Object.freeze({
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
});

/**
 * 非 ASCII 但属于 WinAnsi 码表、允许渲染的字符（码位 → 字节）。
 * `²` 是最常用的一项（房间面积标注）。
 * @type {Map<number, number>}
 */
const WIN_ANSI_EXTRA = new Map([
  [0x00b0, 0xb0], // °
  [0x00b1, 0xb1], // ±
  [0x00b2, 0xb2], // ²
  [0x00b3, 0xb3], // ³
  [0x00b5, 0xb5], // µ
  [0x00b7, 0xb7], // ·
  [0x00d7, 0xd7], // ×
  [0x00f7, 0xf7], // ÷
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95], // •
  [0x2026, 0x85], // …
  [0x20ac, 0x80], // €
]);

/**
 * **唯一入口**：读 `plan.svg` → 写 `plan.pdf`（纯 JS、零依赖、不调外部程序）。
 * 成功返回统计值（含 `ok:true`）；读文件 / 写盘失败时抛错，由调用方决定是否降级
 * （交付流程必须捕获它，PDF 失败绝不能阻断 DXF / SVG 交付）。
 * @param {{svgPath:string, pdfPath:string}} opts
 * @returns {Promise<{ok:true, bytes:number, pages:number, shapes:number, texts:number, skippedTexts:number}>}
 */
export async function svgFileToPdf(opts) {
  const svgPath = String(opts.svgPath);
  const pdfPath = String(opts.pdfPath);
  const svgText = await fs.readFile(svgPath, 'utf8');
  const result = svgTextToPdf(svgText);
  await fs.mkdir(path.dirname(pdfPath), { recursive: true });
  await fs.writeFile(pdfPath, result.buffer);
  return {
    ok: true,
    bytes: result.buffer.length,
    pages: 1,
    shapes: result.shapes,
    texts: result.texts,
    skippedTexts: result.skippedTexts,
  };
}

/**
 * 兼容别名：`docs/INCREMENT-DESIGN.md` §6 曾用 `writePlanPdf` 这个名字，
 * 这里做同引用导出，照文档调用也不会踩空（行为与 `svgFileToPdf` 完全一致）。
 */
export const writePlanPdf = svgFileToPdf;

/**
 * 内部辅助（便于单测，不触碰磁盘）：SVG 文本 → PDF Buffer + 统计值。
 * @param {string} svgText
 * @returns {{buffer:Buffer, shapes:number, texts:number, skippedTexts:number}}
 */
export function svgTextToPdf(svgText) {
  const doc = parseSvg(String(svgText || ''));
  const rendered = renderAll(doc);
  const buffer = buildPdfFile(rendered.content, doc.viewBox);
  return {
    buffer,
    shapes: doc.shapes.length,
    texts: rendered.texts,
    skippedTexts: rendered.skippedTexts,
  };
}

// ======================================================================
// 1. 解析 SVG
// ======================================================================

/** @typedef {{x:number,y:number,c1x?:number,c1y?:number,c2x?:number,c2y?:number}} SegPoint */
/** @typedef {{op:'m'|'l'|'c'|'h', x?:number, y?:number, c1x?:number, c1y?:number, c2x?:number, c2y?:number}} PathSeg */
/**
 * @typedef {{
 *   segs: PathSeg[],
 *   fill: string|null,
 *   stroke: string|null,
 *   width: number,
 *   dash: number[]|null,
 *   rotate: {deg:number,cx:number,cy:number}|null,
 * }} Shape
 */
/**
 * @typedef {{
 *   text: string,
 *   x: number,
 *   y: number,
 *   size: number,
 *   bold: boolean,
 *   anchor: 'start'|'middle'|'end',
 *   central: boolean,
 *   fill: string|null,
 *   rotate: {deg:number,cx:number,cy:number}|null,
 * }} TextItem
 */

/** @typedef {{minX:number,minY:number,width:number,height:number}} ViewBox */

/** @param {string} svgText @returns {ViewBox} */
function readViewBox(svgText) {
  const tagMatch = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)/.exec(svgText);
  const attrs = tagMatch ? parseAttrs(tagMatch[1]) : {};
  const raw = attrs.viewBox || attrs.viewbox;
  if (raw) {
    const nums = raw.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) {
      return { minX: nums[0], minY: nums[1], width: nums[2], height: nums[3] };
    }
  }
  const width = Number.parseFloat(attrs.width || '');
  const height = Number.parseFloat(attrs.height || '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { minX: 0, minY: 0, width, height };
  }
  // 兜底：A4 横向比例的 1:1 用户坐标系，保证永远能出图。
  return { minX: 0, minY: 0, width: PAGE.width, height: PAGE.height };
}

/**
 * 解析 `name="value"` / `name='value'` 属性表。
 * @param {string} attrText @returns {Record<string,string>}
 */
function parseAttrs(attrText) {
  /** @type {Record<string,string>} */
  const attrs = {};
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = re.exec(attrText);
  while (match) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
    match = re.exec(attrText);
  }
  return attrs;
}

/**
 * `<pattern id="x">…<rect fill="#rrggbb">…</pattern>` → `{x:'#rrggbb'}`。
 * 斜线纹理不渲染，只取底色作近似实心填充。
 * @param {string} svgText @returns {Record<string,string>}
 */
function readPatternFills(svgText) {
  /** @type {Record<string,string>} */
  const map = {};
  const re = /<pattern\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/pattern>/g;
  let match = re.exec(svgText);
  while (match) {
    const attrs = parseAttrs(match[1]);
    const inner = match[2];
    const rectMatch = /<rect\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(inner);
    let color = PATTERN_FALLBACK;
    if (rectMatch) {
      const rectAttrs = parseAttrs(rectMatch[1]);
      const fill = rectAttrs.fill;
      if (fill && fill !== 'none' && !/^url\(/i.test(fill)) color = fill;
    }
    if (attrs.id) map[attrs.id] = color;
    match = re.exec(svgText);
  }
  return map;
}

/**
 * 找到标签结束位置（跳过引号内的 `>`）。
 * @param {string} text @param {number} from @returns {number}
 */
function findTagEnd(text, from) {
  let quote = '';
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '>') return index;
  }
  return -1;
}

/** 解码最小实体集（archlang 不产出实体，这里只做防御）。 @param {string} text */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * 解析整份 SVG。
 * @param {string} svgText
 * @returns {{viewBox:ViewBox, shapes:Shape[], texts:TextItem[], patterns:Record<string,string>}}
 */
function parseSvg(svgText) {
  const viewBox = readViewBox(svgText);
  const patterns = readPatternFills(svgText);
  /** @type {Shape[]} */
  const shapes = [];
  /** @type {TextItem[]} */
  const texts = [];

  /** 继承样式栈：SVG 的 fill / stroke / stroke-width / font-* 可继承。 */
  const stack = [{ fill: '#000000', stroke: 'none', strokeWidth: 1, fontSize: 16, fontWeight: 400 }];
  const currentStyle = () => stack[stack.length - 1];

  let inDefs = 0;
  let index = 0;
  while (index < svgText.length) {
    const lt = svgText.indexOf('<', index);
    if (lt === -1) break;
    if (svgText.startsWith('<!--', lt)) {
      const end = svgText.indexOf('-->', lt);
      index = end === -1 ? svgText.length : end + 3;
      continue;
    }
    if (svgText.startsWith('<?', lt) || svgText.startsWith('<!', lt)) {
      const end = svgText.indexOf('>', lt);
      index = end === -1 ? svgText.length : end + 1;
      continue;
    }
    const gt = findTagEnd(svgText, lt);
    if (gt === -1) break;
    const raw = svgText.slice(lt + 1, gt);
    const isClose = raw.startsWith('/');
    const selfClosing = /\/\s*$/.test(raw);
    const body = isClose ? raw.slice(1) : (selfClosing ? raw.replace(/\/\s*$/, '') : raw);
    const nameMatch = /^\s*([a-zA-Z_][\w:.-]*)/.exec(body);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const attrs = nameMatch ? parseAttrs(body.slice(nameMatch[0].length)) : {};
    index = gt + 1;
    if (!name) continue;

    if (isClose) {
      if (name === 'g' || name === 'svg') {
        if (stack.length > 1) stack.pop();
      } else if (name === 'defs' && inDefs > 0) {
        inDefs -= 1;
      }
      continue;
    }

    if (name === 'defs') {
      if (!selfClosing) inDefs += 1;
      continue;
    }
    if (inDefs > 0) continue; // pattern 内部图元不参与页面绘制

    if (name === 'g' || name === 'svg') {
      if (!selfClosing) stack.push({ ...currentStyle(), ...styleOf(attrs) });
      continue;
    }

    const style = { ...currentStyle(), ...styleOf(attrs) };

    if (name === 'text') {
      let content = '';
      if (!selfClosing) {
        const closeIdx = svgText.indexOf('</text>', index);
        content = closeIdx === -1 ? '' : svgText.slice(index, closeIdx);
        index = closeIdx === -1 ? svgText.length : closeIdx + '</text>'.length;
      }
      const item = readTextItem(attrs, style, decodeEntities(content).trim(), patterns);
      if (item) texts.push(item);
      continue;
    }

    const shape = readShape(name, attrs, style, patterns);
    if (shape) shapes.push(shape);
  }

  return { viewBox, shapes, texts, patterns };
}

/**
 * 从属性表里取出可继承的样式。
 * @param {Record<string,string>} attrs
 * @returns {{fill?:string,stroke?:string,strokeWidth?:number,fontSize?:number,fontWeight?:number}}
 */
function styleOf(attrs) {
  /** @type {{fill?:string,stroke?:string,strokeWidth?:number,fontSize?:number,fontWeight?:number}} */
  const style = {};
  if (typeof attrs.fill === 'string') style.fill = attrs.fill;
  if (typeof attrs.stroke === 'string') style.stroke = attrs.stroke;
  if (typeof attrs['stroke-width'] === 'string') {
    const width = Number.parseFloat(attrs['stroke-width']);
    if (Number.isFinite(width)) style.strokeWidth = width;
  }
  if (typeof attrs['font-size'] === 'string') {
    const size = Number.parseFloat(attrs['font-size']);
    if (Number.isFinite(size)) style.fontSize = size;
  }
  if (typeof attrs['font-weight'] === 'string') {
    const weight = Number.parseFloat(attrs['font-weight']);
    if (Number.isFinite(weight)) style.fontWeight = weight;
  }
  return style;
}

/**
 * 解析 `transform` 里的 `rotate(deg [cx cy])`；其他变换忽略（archlang 只产出 rotate）。
 * @param {string|undefined} transform
 * @returns {{deg:number,cx:number,cy:number}|null}
 */
function readRotate(transform) {
  if (typeof transform !== 'string') return null;
  const match = /rotate\s*\(\s*([-+]?[0-9]*\.?[0-9]+)(?:[,\s]+([-+]?[0-9]*\.?[0-9]+))?(?:[,\s]+([-+]?[0-9]*\.?[0-9]+))?\s*\)/.exec(transform);
  if (!match) return null;
  const deg = Number(match[1]);
  if (!Number.isFinite(deg) || deg === 0) return null;
  const cx = match[2] !== undefined ? Number(match[2]) : 0;
  const cy = match[3] !== undefined ? Number(match[3]) : 0;
  return { deg, cx, cy };
}

/**
 * 构造一个图元（rect / line / polygon / path）。
 * @param {string} name
 * @param {Record<string,string>} attrs
 * @param {{fill:string,stroke:string,strokeWidth:number}} style
 * @param {Record<string,string>} patterns
 * @returns {Shape|null}
 */
function readShape(name, attrs, style, patterns) {
  /** @type {PathSeg[]|null} */
  let segs = null;
  if (name === 'rect') segs = rectSegments(attrs);
  else if (name === 'line') segs = lineSegments(attrs);
  else if (name === 'polygon') segs = polygonSegments(attrs);
  else if (name === 'polyline') segs = polylineSegments(attrs);
  else if (name === 'path') segs = pathSegments(attrs.d || '');
  else if (name === 'circle') segs = circleSegments(attrs);
  else if (name === 'ellipse') segs = ellipseSegments(attrs);
  else return null; // 未知元素静默跳过（不崩溃）

  if (!segs || segs.length === 0) return null;
  // `line` / `polyline` 没有可填充面积：只按显式 fill 属性填充，避免继承默认黑色误填。
  const openShape = name === 'line' || name === 'polyline';
  const fill = openShape && attrs.fill === undefined ? null : resolveColor(style.fill, patterns);
  const stroke = resolveColor(style.stroke, patterns);
  if (!fill && !stroke) return null;
  const dash = parseDashArray(attrs['stroke-dasharray']);
  return {
    segs,
    fill,
    stroke,
    width: Number.isFinite(style.strokeWidth) && style.strokeWidth > 0 ? style.strokeWidth : 1,
    dash,
    rotate: readRotate(attrs.transform),
  };
}

/**
 * 构造一个文本项。
 * @param {Record<string,string>} attrs
 * @param {{fontSize:number,fontWeight:number,fill:string}} style
 * @param {string} text
 * @param {Record<string,string>} patterns
 * @returns {TextItem|null}
 */
function readTextItem(attrs, style, text, patterns) {
  if (!text) return null;
  const x = Number.parseFloat(attrs.x || '0');
  const y = Number.parseFloat(attrs.y || '0');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = Number.isFinite(style.fontSize) && style.fontSize > 0 ? style.fontSize : 16;
  const anchorRaw = (attrs['text-anchor'] || 'start').toLowerCase();
  const anchor = anchorRaw === 'middle' || anchorRaw === 'end' ? anchorRaw : 'start';
  return {
    text,
    x,
    y,
    size,
    bold: Number.isFinite(style.fontWeight) ? style.fontWeight >= 600 : false,
    anchor,
    central: String(attrs['dominant-baseline'] || '').toLowerCase() === 'central',
    fill: resolveColor(style.fill, patterns) || '#000000',
    rotate: readRotate(attrs.transform),
  };
}

// ======================================================================
// 2. 图元 → 绝对坐标线段
// ======================================================================

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function rectSegments(attrs) {
  const x = Number.parseFloat(attrs.x || '0');
  const y = Number.parseFloat(attrs.y || '0');
  const width = Number.parseFloat(attrs.width || '0');
  const height = Number.parseFloat(attrs.height || '0');
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  if (width === 0 || height === 0) return null;
  const rxRaw = Number.parseFloat(attrs.rx || attrs.ry || '0');
  const rx = Number.isFinite(rxRaw) && rxRaw > 0 ? Math.min(rxRaw, width / 2, height / 2) : 0;

  if (rx === 0) {
    return [
      { op: 'm', x, y },
      { op: 'l', x: x + width, y },
      { op: 'l', x: x + width, y: y + height },
      { op: 'l', x, y: y + height },
      { op: 'h' },
    ];
  }
  // 圆角矩形：4 段 90° 圆弧（用三次贝塞尔，k = 0.5523）。
  const k = 0.5523 * rx;
  return [
    { op: 'm', x: x + rx, y },
    { op: 'l', x: x + width - rx, y },
    { op: 'c', c1x: x + width - rx + k, c1y: y, c2x: x + width, c2y: y + rx - k, x: x + width, y: y + rx },
    { op: 'l', x: x + width, y: y + height - rx },
    { op: 'c', c1x: x + width, c1y: y + height - rx + k, c2x: x + width - rx + k, c2y: y + height, x: x + width - rx, y: y + height },
    { op: 'l', x: x + rx, y: y + height },
    { op: 'c', c1x: x + rx - k, c1y: y + height, c2x: x, c2y: y + height - rx + k, x, y: y + height - rx },
    { op: 'l', x, y: y + rx },
    { op: 'c', c1x: x, c1y: y + rx - k, c2x: x + rx - k, c2y: y, x: x + rx, y },
    { op: 'h' },
  ];
}

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function lineSegments(attrs) {
  const x1 = Number.parseFloat(attrs.x1 || '0');
  const y1 = Number.parseFloat(attrs.y1 || '0');
  const x2 = Number.parseFloat(attrs.x2 || '0');
  const y2 = Number.parseFloat(attrs.y2 || '0');
  if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return null;
  return [{ op: 'm', x: x1, y: y1 }, { op: 'l', x: x2, y: y2 }];
}

/** @param {string} points @returns {Array<{x:number,y:number}>} */
function parsePoints(points) {
  const nums = String(points).trim().split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value));
  /** @type {Array<{x:number,y:number}>} */
  const out = [];
  for (let index = 0; index + 1 < nums.length; index += 2) out.push({ x: nums[index], y: nums[index + 1] });
  return out;
}

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function polygonSegments(attrs) {
  const points = parsePoints(attrs.points || '');
  if (points.length < 2) return null;
  /** @type {PathSeg[]} */
  const segs = [{ op: 'm', x: points[0].x, y: points[0].y }];
  for (let index = 1; index < points.length; index += 1) segs.push({ op: 'l', x: points[index].x, y: points[index].y });
  segs.push({ op: 'h' });
  return segs;
}

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function polylineSegments(attrs) {
  const points = parsePoints(attrs.points || '');
  if (points.length < 2) return null;
  /** @type {PathSeg[]} */
  const segs = [{ op: 'm', x: points[0].x, y: points[0].y }];
  for (let index = 1; index < points.length; index += 1) segs.push({ op: 'l', x: points[index].x, y: points[index].y });
  return segs;
}

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function circleSegments(attrs) {
  const cx = Number.parseFloat(attrs.cx || '0');
  const cy = Number.parseFloat(attrs.cy || '0');
  const r = Number.parseFloat(attrs.r || '0');
  if (![cx, cy, r].every((value) => Number.isFinite(value)) || r <= 0) return null;
  return ellipseSegments({ cx: String(cx), cy: String(cy), rx: String(r), ry: String(r) });
}

/** @param {Record<string,string>} attrs @returns {PathSeg[]|null} */
function ellipseSegments(attrs) {
  const cx = Number.parseFloat(attrs.cx || '0');
  const cy = Number.parseFloat(attrs.cy || '0');
  const rx = Number.parseFloat(attrs.rx || '0');
  const ry = Number.parseFloat(attrs.ry || '0');
  if (![cx, cy, rx, ry].every((value) => Number.isFinite(value)) || rx <= 0 || ry <= 0) return null;
  const kx = 0.5523 * rx;
  const ky = 0.5523 * ry;
  return [
    { op: 'm', x: cx + rx, y: cy },
    { op: 'c', c1x: cx + rx, c1y: cy + ky, c2x: cx + kx, c2y: cy + ry, x: cx, y: cy + ry },
    { op: 'c', c1x: cx - kx, c1y: cy + ry, c2x: cx - rx, c2y: cy + ky, x: cx - rx, y: cy },
    { op: 'c', c1x: cx - rx, c1y: cy - ky, c2x: cx - kx, c2y: cy - ry, x: cx, y: cy - ry },
    { op: 'c', c1x: cx + kx, c1y: cy - ry, c2x: cx + rx, c2y: cy - ky, x: cx + rx, y: cy },
    { op: 'h' },
  ];
}

/** SVG path 记号（命令字母 + 数字）。 */
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
/** 每个命令需要的数字个数。 */
const ARG_COUNT = Object.freeze({ M: 2, L: 2, H: 1, V: 1, C: 6, A: 7, Z: 0 });

/**
 * 解析 `d`（支持 M/L/H/V/C/A/Z 及小写相对写法；archlang 产出全部为绝对坐标）。
 * @param {string} d
 * @returns {PathSeg[]}
 */
function pathSegments(d) {
  /** @type {PathSeg[]} */
  const segs = [];
  if (typeof d !== 'string' || d.length === 0) return segs;
  /** @type {Array<{cmd?:string,num?:number}>} */
  const tokens = [];
  PATH_TOKEN.lastIndex = 0;
  let token = PATH_TOKEN.exec(d);
  while (token) {
    if (token[1]) tokens.push({ cmd: token[1] });
    else tokens.push({ num: Number(token[2]) });
    token = PATH_TOKEN.exec(d);
  }

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let command = '';
  let index = 0;
  while (index < tokens.length) {
    const head = tokens[index];
    if (head.cmd) {
      command = head.cmd;
      index += 1;
      if (command === 'Z' || command === 'z') {
        segs.push({ op: 'h' });
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (!command) {
      index += 1;
      continue;
    }
    const upper = command.toUpperCase();
    const need = ARG_COUNT[/** @type {keyof typeof ARG_COUNT} */ (upper)];
    if (need === undefined) return segs; // 不支持的命令（Q/S/T 等）：停止解析，保留已解析部分
    if (need === 0) { command = ''; continue; }
    /** @type {number[]} */
    const args = [];
    while (args.length < need && index < tokens.length && tokens[index].num !== undefined) {
      args.push(/** @type {number} */ (tokens[index].num));
      index += 1;
    }
    if (args.length < need) break;
    const relative = command !== upper;

    if (upper === 'M') {
      cx = relative ? cx + args[0] : args[0];
      cy = relative ? cy + args[1] : args[1];
      sx = cx;
      sy = cy;
      segs.push({ op: 'm', x: cx, y: cy });
      command = relative ? 'l' : 'L'; // 后续坐标对按 lineto 处理
      continue;
    }
    if (upper === 'L') {
      cx = relative ? cx + args[0] : args[0];
      cy = relative ? cy + args[1] : args[1];
      segs.push({ op: 'l', x: cx, y: cy });
      continue;
    }
    if (upper === 'H') {
      cx = relative ? cx + args[0] : args[0];
      segs.push({ op: 'l', x: cx, y: cy });
      continue;
    }
    if (upper === 'V') {
      cy = relative ? cy + args[0] : args[0];
      segs.push({ op: 'l', x: cx, y: cy });
      continue;
    }
    if (upper === 'C') {
      const x0 = relative ? cx : 0;
      const y0 = relative ? cy : 0;
      const c1x = x0 + args[0];
      const c1y = y0 + args[1];
      const c2x = x0 + args[2];
      const c2y = y0 + args[3];
      cx = x0 + args[4];
      cy = y0 + args[5];
      segs.push({ op: 'c', c1x, c1y, c2x, c2y, x: cx, y: cy });
      continue;
    }
    if (upper === 'A') {
      const rx = args[0];
      const ry = args[1];
      const rotation = args[2];
      const largeArc = args[3] !== 0;
      const sweep = args[4] !== 0;
      const ex = relative ? cx + args[5] : args[5];
      const ey = relative ? cy + args[6] : args[6];
      const curves = arcToCubics(cx, cy, rx, ry, rotation, largeArc, sweep, ex, ey);
      if (curves) {
        for (const curve of curves) segs.push(curve);
      } else {
        segs.push({ op: 'l', x: ex, y: ey });
      }
      cx = ex;
      cy = ey;
      continue;
    }
  }
  return segs;
}

/**
 * 椭圆弧 → 三次贝塞尔（标准「端点 → 圆心 → 角度」算法，每段 ≤ 90°）。
 * @param {number} x0 起点 x
 * @param {number} y0 起点 y
 * @param {number} rx 椭圆 x 半径
 * @param {number} ry 椭圆 y 半径
 * @param {number} rotationDeg 椭圆相对 x 轴的旋转角（度）
 * @param {boolean} largeArc 是否取大弧
 * @param {boolean} sweep 是否顺时针（SVG 坐标、y 向下为正）
 * @param {number} x1 终点 x
 * @param {number} y1 终点 y
 * @returns {PathSeg[]|null} `null` 表示应退化成直线
 */
function arcToCubics(x0, y0, rx, ry, rotationDeg, largeArc, sweep, x1, y1) {
  let rxA = Math.abs(rx);
  let ryA = Math.abs(ry);
  if (!Number.isFinite(rxA) || !Number.isFinite(ryA) || rxA === 0 || ryA === 0) return null;
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rxA * rxA) + (y1p * y1p) / (ryA * ryA);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxA *= scale;
    ryA *= scale;
  }

  const rx2 = rxA * rxA;
  const ry2 = ryA * ryA;
  const numerator = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
  if (denominator === 0) return null;
  let coefficient = Math.sqrt(Math.max(0, numerator / denominator));
  if (largeArc === sweep) coefficient = -coefficient;

  const cxp = (coefficient * (rxA * y1p)) / ryA;
  const cyp = (coefficient * -(ryA * x1p)) / rxA;
  const centerX = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const centerY = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const v1 = { x: (x1p - cxp) / rxA, y: (y1p - cyp) / ryA };
  const v2 = { x: (-x1p - cxp) / rxA, y: (-y1p - cyp) / ryA };

  const theta1 = Math.atan2(v1.y, v1.x);
  let delta = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const pointAt = (angle) => ({
    x: centerX + rxA * cosPhi * Math.cos(angle) - ryA * sinPhi * Math.sin(angle),
    y: centerY + rxA * sinPhi * Math.cos(angle) + ryA * cosPhi * Math.sin(angle),
  });
  const derivativeAt = (angle) => ({
    x: -rxA * cosPhi * Math.sin(angle) - ryA * sinPhi * Math.cos(angle),
    y: -rxA * sinPhi * Math.sin(angle) + ryA * cosPhi * Math.cos(angle),
  });

  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segmentCount;
  const alpha = (4 / 3) * Math.tan(step / 4);

  /** @type {PathSeg[]} */
  const curves = [];
  let angle = theta1;
  for (let index = 0; index < segmentCount; index += 1) {
    const nextAngle = angle + step;
    const p1 = pointAt(angle);
    const p2 = pointAt(nextAngle);
    const d1 = derivativeAt(angle);
    const d2 = derivativeAt(nextAngle);
    curves.push({
      op: 'c',
      c1x: p1.x + alpha * d1.x,
      c1y: p1.y + alpha * d1.y,
      c2x: p2.x - alpha * d2.x,
      c2y: p2.y - alpha * d2.y,
      x: p2.x,
      y: p2.y,
    });
    angle = nextAngle;
  }
  // 收尾对齐到精确终点，避免累计误差造成缝隙。
  const last = curves[curves.length - 1];
  last.x = x1;
  last.y = y1;
  return curves;
}

// ======================================================================
// 3. 颜色 / 数值
// ======================================================================

/**
 * `#rgb` / `#rrggbb` / `rgb(...)` / `none` / `url(#id)` → `{r,g,b}`（0–1）或 `null`(无)。
 * @param {string|undefined} value
 * @param {Record<string,string>} patterns
 * @returns {string|null} 归一化的 `#rrggbb`，`null` 表示不绘制
 */
function resolveColor(value, patterns) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'transparent') return null;
  const urlMatch = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/.exec(raw);
  if (urlMatch) {
    const target = patterns[urlMatch[1]];
    return target ? resolveColor(target, patterns) || PATTERN_FALLBACK : PATTERN_FALLBACK;
  }
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw];
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (hex.length === 3) {
      const r = hex[0].repeat(2);
      const g = hex[1].repeat(2);
      const b = hex[2].repeat(2);
      return `#${r}${g}${b}`;
    }
    if (hex.length === 6 && /^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
    return null;
  }
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/.exec(raw);
  if (rgbMatch) {
    const toHex = (channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0');
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }
  return null;
}

/**
 * `#rrggbb` → PDF 颜色分量字符串（0–1，3 位小数）。
 * @param {string} hex @returns {string}
 */
function colorComponents(hex) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return `${num(r)} ${num(g)} ${num(b)}`;
}

/** 数值格式化（最多 3 位小数，去掉多余的 0）。 @param {number} value */
function num(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** @param {string|undefined} value @returns {number[]|null} */
function parseDashArray(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/[\s,]+/).map(Number).filter((item) => Number.isFinite(item) && item > 0);
  if (parts.length === 0) return null;
  if (parts.length % 2 === 1) parts.push(parts[parts.length - 1]);
  return parts;
}

// ======================================================================
// 4. 渲染为 PDF 内容流
// ======================================================================

/**
 * @param {{viewBox:ViewBox, shapes:Shape[], texts:TextItem[]}} doc
 * @returns {{content:string, texts:number, skippedTexts:number, layout:Object}}
 */
function renderAll(doc) {
  const { viewBox } = doc;
  const availableWidth = PAGE.width - MARGIN * 2;
  const availableHeight = PAGE.height - MARGIN * 2;
  const scale = Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height);
  const drawWidth = viewBox.width * scale;
  const drawHeight = viewBox.height * scale;
  const offsetX = (PAGE.width - drawWidth) / 2;
  const offsetY = (PAGE.height - drawHeight) / 2;

  // SVG 用户坐标 → PDF 点：x' = scale*x + e，y' = -scale*y + f（Y 轴翻转 + viewBox 平移）
  const e = offsetX - viewBox.minX * scale;
  const f = PAGE.height - offsetY + viewBox.minY * scale;
  const toPageX = (x) => scale * x + e;
  const toPageY = (y) => -scale * y + f;

  /** @type {string[]} */
  const parts = [];
  parts.push('q');
  parts.push(`${num(scale)} 0 0 ${num(-scale)} ${num(e)} ${num(f)} cm`);
  for (const shape of doc.shapes) parts.push(...renderShape(shape));
  parts.push('Q');

  let renderedTexts = 0;
  let skippedTexts = 0;
  for (const item of doc.texts) {
    const encoded = encodeWinAnsi(item.text);
    if (encoded === null) {
      skippedTexts += 1; // WinAnsi 之外的字符（如中文）：跳过，不抛错
      continue;
    }
    renderedTexts += 1;
    parts.push(...renderText(item, { scale, toPageX, toPageY }));
  }

  return {
    content: `${parts.join('\n')}\n`,
    texts: renderedTexts,
    skippedTexts,
    layout: { scale, offsetX, offsetY, e, f },
  };
}

/**
 * 单图元 → 内容流片段（独立 `rg` / `RG` / `w` + 路径 + 一次 paint）。
 * @param {Shape} shape @returns {string[]}
 */
function renderShape(shape) {
  /** @type {string[]} */
  const out = [];
  const rotated = shape.rotate && shape.rotate.deg !== 0;
  if (rotated) {
    out.push('q');
    out.push(rotateMatrix(/** @type {{deg:number,cx:number,cy:number}} */ (shape.rotate)));
  }
  if (shape.fill) out.push(`${colorComponents(shape.fill)} rg`);
  if (shape.stroke) {
    out.push(`${colorComponents(shape.stroke)} RG`);
    out.push(`${num(shape.width)} w`);
    if (shape.dash) out.push(`[${shape.dash.map((item) => num(item)).join(' ')}] 0 d`);
  }
  out.push(pathData(shape.segs));
  if (shape.fill && shape.stroke) out.push('B');
  else if (shape.fill) out.push('f');
  else out.push('S');
  if (rotated) out.push('Q');
  return out;
}

/**
 * SVG 坐标里的 rotate(deg cx cy) → PDF `cm` 参数（在 SVG 用户坐标系内先旋转，再由外层 CTM 翻转）。
 * @param {{deg:number,cx:number,cy:number}} rotate @returns {string}
 */
function rotateMatrix(rotate) {
  const rad = (rotate.deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tx = rotate.cx - rotate.cx * cos + rotate.cy * sin;
  const ty = rotate.cy - rotate.cx * sin - rotate.cy * cos;
  return `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(tx)} ${num(ty)} cm`;
}

/**
 * 线段列表 → PDF 路径操作符（绝对坐标）。
 * @param {PathSeg[]} segs @returns {string}
 */
function pathData(segs) {
  /** @type {string[]} */
  const ops = [];
  for (const seg of segs) {
    if (seg.op === 'm') ops.push(`${num(/** @type {number} */ (seg.x))} ${num(/** @type {number} */ (seg.y))} m`);
    else if (seg.op === 'l') ops.push(`${num(/** @type {number} */ (seg.x))} ${num(/** @type {number} */ (seg.y))} l`);
    else if (seg.op === 'c') {
      ops.push([
        num(/** @type {number} */ (seg.c1x)), num(/** @type {number} */ (seg.c1y)),
        num(/** @type {number} */ (seg.c2x)), num(/** @type {number} */ (seg.c2y)),
        num(/** @type {number} */ (seg.x)), num(/** @type {number} */ (seg.y)), 'c',
      ].join(' '));
    } else {
      ops.push('h');
    }
  }
  return ops.join('\n');
}

/**
 * 文本项 → `BT … ET`（绝对页面坐标，不做 Y 翻转，避免文字镜像）。
 * @param {TextItem} item
 * @param {{scale:number, toPageX:(x:number)=>number, toPageY:(y:number)=>number}} ctx
 * @returns {string[]}
 */
function renderText(item, ctx) {
  const encoded = encodeWinAnsi(item.text);
  const glyphs = encoded === null ? '' : encoded;
  // 近似字宽：Helvetica 平均 0.5em，粗体略宽。
  const charWidth = 0.5 * item.size * (item.bold ? 1.08 : 1);
  const approxWidth = charWidth * item.text.length;
  let anchorShift = 0;
  if (item.anchor === 'middle') anchorShift = -approxWidth / 2;
  else if (item.anchor === 'end') anchorShift = -approxWidth;

  let x = item.x + anchorShift;
  let y = item.y + (item.central ? 0.36 * item.size : 0);
  const rotate = item.rotate;
  if (rotate && rotate.deg !== 0) {
    // 在 SVG 用户坐标里先绕 (cx,cy) 旋转，再换算到页面坐标。
    const rad = (rotate.deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const relX = x - rotate.cx;
    const relY = y - rotate.cy;
    x = rotate.cx + relX * cos - relY * sin;
    y = rotate.cy + relX * sin + relY * cos;
  }
  const pageX = ctx.toPageX(x);
  const pageY = ctx.toPageY(y);
  // y 轴已翻转：SVG 顺时针角度在 PDF 里是逆时针，故取负号。
  const textRad = rotate ? (-rotate.deg * Math.PI) / 180 : 0;
  const cosT = Math.cos(textRad);
  const sinT = Math.sin(textRad);
  const sizePt = item.size * ctx.scale;
  const font = item.bold ? '/F2' : '/F1';

  return [
    'BT',
    `${font} ${num(sizePt)} Tf`,
    `${colorComponents(item.fill || '#000000')} rg`,
    `${num(cosT)} ${num(sinT)} ${num(-sinT)} ${num(cosT)} ${num(pageX)} ${num(pageY)} Tm`,
    `(${glyphs}) Tj`,
    'ET',
  ];
}

/**
 * WinAnsi 编码：返回可直接放进 `( … )` 的转义字符串；不可编码返回 `null`。
 * @param {string} text @returns {string|null}
 */
function encodeWinAnsi(text) {
  let out = '';
  for (const char of text) {
    const codePoint = /** @type {number} */ (char.codePointAt(0));
    let byte = null;
    if (codePoint >= 0x20 && codePoint <= 0x7e) byte = codePoint;
    else if (WIN_ANSI_EXTRA.has(codePoint)) byte = WIN_ANSI_EXTRA.get(codePoint);
    if (byte === null || byte === undefined) return null; // 中文等 WinAnsi 外字符 → 整条跳过
    if (byte === 0x28) out += '\\(';
    else if (byte === 0x29) out += '\\)';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

// ======================================================================
// 5. PDF 文件结构（手写 xref / trailer）
// ======================================================================

/**
 * 组装单页 PDF 1.4（内容流不压缩）。
 * @param {string} content 内容流（ASCII / Latin-1）
 * @param {ViewBox} viewBox
 * @returns {Buffer}
 */
function buildPdfFile(content, viewBox) {
  void viewBox; // 页面尺寸固定 A4 横向，viewBox 只用于缩放，不写进 MediaBox
  /** @type {string[]} */
  const chunks = [];
  let offset = 0;
  /** @param {string} text */
  const push = (text) => {
    chunks.push(text);
    offset += Buffer.byteLength(text, 'latin1');
  };

  push('%PDF-1.4\n');
  push('%\xE2\xE3\xCF\xD3\n');

  /** @type {number[]} */
  const offsets = [];
  /** @param {string} body */
  const addObject = (body) => {
    offsets.push(offset);
    push(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject([
    '<< /Type /Page',
    '   /Parent 2 0 R',
    `   /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}]`,
    '   /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /ProcSet [/PDF /Text] >>',
    '   /Contents 6 0 R',
    '>>',
  ].join('\n'));
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const contentLength = Buffer.byteLength(content, 'latin1');
  addObject(`<< /Length ${contentLength} >>\nstream\n${content}endstream`);

  const xrefOffset = offset;
  push(`xref\n0 ${offsets.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const objectOffset of offsets) push(`${String(objectOffset).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'latin1');
}
