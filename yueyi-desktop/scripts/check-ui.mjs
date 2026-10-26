#!/usr/bin/env node
/**
 * UI 护栏：扫描页面/组件里的「一次性设计值」。
 *
 * 用法：
 *   node scripts/check-ui.mjs          报告模式（始终退出 0）
 *   node scripts/check-ui.mjs --strict 严格模式（发现违规退出 1，可挂 CI）
 *
 * 规则：
 *  - 字号只允许 10/11/12/13/14/15/18/22px 或相对 em
 *  - 不允许裸 hex 颜色（收进 tokens.css）
 *  - 统计 !px- / !py- 覆盖次数，提醒改用基元尺寸
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ALLOW_FONT = new Set(["10", "11", "12", "13", "14", "15", "18", "22"]);
const SKIP_DIRS = new Set(["ui"]);
/** 颜色定义与浏览器 mock 属于数据源，不算一次性设计值 */
const SKIP_FILES = new Set(["utils/palette.ts", "services/api.ts"]);
const strict = process.argv.includes("--strict");

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(ROOT);
const violations = [];
let bumpCount = 0;

for (const file of files) {
  const text = await readFile(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (SKIP_FILES.has(rel)) continue;

  for (const m of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    if (!ALLOW_FONT.has(m[1])) {
      violations.push(`${rel}: 非标准字号 text-[${m[1]}px]`);
    }
  }
  // 裸 hex（排除注释里举例说明的 #RRGGBB 与纯白/纯黑）
  for (const m of text.matchAll(/(?:^|[\s"'(])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = m[1].toLowerCase();
    if (hex === "ffffff" || hex === "000000") continue;
    violations.push(`${rel}: 裸色值 #${m[1]}`);
  }
  bumpCount += (text.match(/!(?:px|py|text)-/g) ?? []).length;
}

console.log(`已扫描 ${files.length} 个文件`);
if (violations.length) {
  console.log(`\n发现 ${violations.length} 处一次性设计值：`);
  for (const v of violations.slice(0, 60)) console.log("  · " + v);
  if (violations.length > 60) console.log(`  … 其余 ${violations.length - 60} 处省略`);
} else {
  console.log("✓ 没有发现非标准字号或裸色值");
}
console.log(`\n!important 尺寸覆盖：${bumpCount} 处（理想值 0，优先用基元 size/variant）`);

if (strict && violations.length) process.exit(1);
