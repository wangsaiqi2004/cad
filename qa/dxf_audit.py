#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA 独立 DXF 审计（黑盒：只读产物文件，不 import 任何 app 模块）。

真实调用 ezdxf.readfile() 与 doc.audit()，输出结构化 JSON 到 stdout：
  - 可解析性 / audit errors / $ACADVER / 实体与图层统计
  - 六类元素（墙 / 门窗 / 家具 / 图层 / 标注 / 尺寸）分别给出证据

用法: python qa/dxf_audit.py <file.dxf>
退出码: 0=审计完成（含结论字段）, 2=ezdxf 不可用, 3=文件无法读取

注意：本脚本只作为 QA 验收的 Python 依赖，不是产品运行时依赖。
"""
import hashlib
import json
import os
import re
import sys
from collections import Counter

try:
    import ezdxf
except Exception as exc:  # pragma: no cover - 环境缺失时如实上报
    print(json.dumps({"ok": False, "error": "ezdxf unavailable: %s" % exc},
                     ensure_ascii=False))
    sys.exit(2)

WALL_LAYER = re.compile(r"(A-WALL|WALL|墙)", re.I)
OPEN_LAYER = re.compile(r"(A-DOOR|A-GLAZ|A-WIND|DOOR|WIND|GLAZ|门|窗)", re.I)
FURN_LAYER = re.compile(r"(A-FURN|FURNITURE|FURN|EQUIP|家具|陈设)", re.I)
ANNO_LAYER = re.compile(r"(A-ANNO-TEXT|ANNO-TEXT|NOTE|TEXT|标注|文字)", re.I)
DIM_LAYER = re.compile(r"(A-ANNO-DIMS|ANNO-DIMS|DIM|尺寸|标注尺寸)", re.I)
FURN_BLOCK = re.compile(r"(SOFA|BED|TABLE|CHAIR|CABINET|DESK|WARDROBE|SHELF|"
                        r"TOILET|SINK|BATH|Hob|FRIDGE|沙发|床|桌|椅|柜|家具|furn\.)",
                        re.I)
OPEN_BLOCK = re.compile(r"(DOOR|WINDOW|WIN-|GLAZ|门|窗)", re.I)


def main():
    target = sys.argv[1]
    result = {
        "ok": False,
        "path": os.path.abspath(target),
        "bytes": os.path.getsize(target) if os.path.isfile(target) else 0,
        "sha256": None,
        "readable": False,
        "audit_errors": None,
        "audit_fixes": None,
        "acadver": None,
        "dxfversion": None,
        "entities": {},
        "layers": [],
        "six_classes": {},
        "six_classes_complete": False,
        "error": None,
    }
    if not os.path.isfile(target):
        result["error"] = "file not found"
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(3)

    with open(target, "rb") as handle:
        result["sha256"] = hashlib.sha256(handle.read()).hexdigest()

    try:
        doc = ezdxf.readfile(target)
    except Exception as exc:
        result["error"] = "ezdxf.readfile failed: %s" % exc
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(3)

    result["readable"] = True
    try:
        auditor = doc.audit()
        result["audit_errors"] = len(auditor.errors)
        result["audit_fixes"] = len(auditor.fixes)
    except Exception as exc:
        result["error"] = "audit failed: %s" % exc
        result["audit_errors"] = -1

    try:
        result["acadver"] = str(doc.header.get("$ACADVER"))
    except Exception:
        result["acadver"] = None
    result["dxfversion"] = doc.dxfversion

    msp = doc.modelspace()
    ents = Counter()
    layers = set()
    inserts = []
    texts = []
    wall_ev, open_ev, furn_ev, anno_ev, dim_ev = [], [], [], [], []

    for entity in msp:
        etype = entity.dxftype()
        ents[etype] += 1
        layer = ""
        try:
            if entity.dxf.hasattr("layer"):
                layer = str(entity.dxf.layer)
                layers.add(layer)
        except Exception:
            pass

        if WALL_LAYER.search(layer) or (etype in ("LINE", "LWPOLYLINE", "HATCH")
                                        and WALL_LAYER.search(layer)):
            wall_ev.append("%s@%s" % (etype, layer or "-"))
        if OPEN_LAYER.search(layer):
            open_ev.append("%s@%s" % (etype, layer))
        if FURN_LAYER.search(layer):
            furn_ev.append("%s@%s" % (etype, layer))
        if ANNO_LAYER.search(layer) or etype in ("TEXT", "MTEXT"):
            anno_ev.append("%s@%s" % (etype, layer or "-"))
        if DIM_LAYER.search(layer) or etype == "DIMENSION":
            dim_ev.append("%s@%s" % (etype, layer or "-"))
        if etype == "INSERT":
            try:
                name = str(entity.dxf.name)
            except Exception:
                name = ""
            inserts.append({"name": name, "layer": layer})
            if OPEN_BLOCK.search(name):
                open_ev.append("INSERT:%s" % name)
            if FURN_BLOCK.search(name):
                furn_ev.append("INSERT:%s" % name)
        if etype in ("TEXT", "MTEXT"):
            try:
                texts.append(str(entity.dxf.text if etype == "TEXT" else entity.text))
            except Exception:
                pass

    result["entities"] = dict(ents)
    result["layers"] = sorted(layers)
    result["inserts"] = inserts
    result["texts"] = texts

    six = {
        "walls": {"present": len(wall_ev) > 0, "evidence": wall_ev[:8],
                  "count": len(wall_ev)},
        "openings": {"present": len(open_ev) > 0, "evidence": open_ev[:8],
                     "count": len(open_ev)},
        "furniture": {"present": len(furn_ev) > 0, "evidence": furn_ev[:8],
                      "count": len(furn_ev)},
        "layers": {"present": len(layers) >= 4,
                   "evidence": sorted(layers)[:12], "count": len(layers)},
        "annotation": {"present": len(anno_ev) > 0, "evidence": anno_ev[:8],
                       "count": len(anno_ev)},
        "dimensions": {"present": len(dim_ev) > 0, "evidence": dim_ev[:8],
                       "count": len(dim_ev)},
    }
    result["six_classes"] = six
    result["six_classes_complete"] = all(v["present"] for v in six.values())
    result["ok"] = True
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
