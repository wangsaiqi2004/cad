#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA 交付包 ZIP 全文检索（Key 明文 / 禁用词 / 后缀）。

用法: python qa/lib/zip_scan.py <zip路径> <key1> <key2> ...
输出 JSON 到 stdout。真实读取 ZIP 内每个 member 的原始字节，
按 UTF-8 与 Latin-1 双解码检索，避免二进制残留明文漏检。
"""
import hashlib
import json
import os
import re
import sys
import zipfile

BANNED = re.compile(r"\bMCP\b|\bSkill\b|\bYAML\b|终端|Agent\s*Runtime|"
                    r"(?<![A-Za-z0-9._-])JSON\b", re.I)
CHINESE = re.compile(r"[\u4e00-\u9fff]")


def main():
    target = sys.argv[1]
    keys = [k for k in sys.argv[2:] if k and len(k) >= 6]
    result = {
        "ok": False, "path": os.path.abspath(target),
        "bytes": os.path.getsize(target) if os.path.isfile(target) else 0,
        "sha256": None, "entries": [], "keyHits": [],
        "dwgFiles": [], "pdfFiles": [], "bannedHits": [],
        "error": None,
    }
    if not os.path.isfile(target):
        result["error"] = "file not found"
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(3)
    with open(target, "rb") as fh:
        result["sha256"] = hashlib.sha256(fh.read()).hexdigest()
    try:
        zf = zipfile.ZipFile(target)
    except Exception as exc:
        result["error"] = "zip open failed: %s" % exc
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(3)

    for info in zf.infolist():
        raw = zf.read(info.filename)
        variants = [raw.decode("utf-8", "replace"), raw.decode("latin-1", "replace")]
        item = {
            "name": info.filename,
            "bytes": info.file_size,
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        result["entries"].append(item)
        low = info.filename.lower()
        if low.endswith(".dwg"):
            result["dwgFiles"].append(info.filename)
        if low.endswith(".pdf"):
            result["pdfFiles"].append(info.filename)
        for key in keys:
            for variant in variants:
                idx = variant.find(key)
                if idx >= 0:
                    result["keyHits"].append({
                        "file": info.filename, "key": key[:6] + "…",
                        "index": idx,
                    })
                    break
        # 用户可见文案：只检查文本类成员，排除 .json 里的键名等技术字段
        if low.endswith((".txt", ".md", ".html", ".htm")):
            for lineno, line in enumerate(variants[0].splitlines(), 1):
                if not CHINESE.search(line):
                    continue
                for match in BANNED.finditer(line):
                    result["bannedHits"].append({
                        "file": info.filename, "line": lineno,
                        "word": match.group(0), "text": line.strip()[:160],
                    })
    result["ok"] = True
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
