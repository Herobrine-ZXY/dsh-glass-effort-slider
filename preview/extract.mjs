/**
 * 预览类脚本共用的"从产物里抽真代码"工具。
 *
 * 存在的理由：`preview/panel.html` 与 `preview/snap-frames.html` 都必须用
 * **产物里的同一份 CSS / 常量 / 函数**，否则预览会慢慢变成一张骗人的图。
 * 抽取逻辑本身也只能有一份 —— 两个脚本各写一套就是新的漂移点。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const BUNDLE = join(ROOT, "lib", "client.js");
export const PREVIEW_DIR = join(ROOT, "preview");

export function readBundle() {
  return readFileSync(BUNDLE, "utf8");
}

/**
 * 取 `var CSS = [ ... ].join("\n");` —— **真求值**，不做文本抽取。
 *
 * 为什么必须求值：有几条规则用了字符串拼接（`"...height:" + TRACK_HEIGHT + "px;..."`），
 * 纯文本抽取会在拼接处断掉，把 `.ces-track` 的 height 截成空值 —— 轨道就变成 0px 高、
 * 预览页上根本看不见（这个 bug 真实发生过：实测 `track rect=254x0`）。
 */
export function extractCss(text, constantsSource) {
  const start = text.indexOf("var CSS = [");
  if (start < 0) throw new Error("产物里找不到 CSS 数组");
  const end = text.indexOf('].join("\\n");', start);
  if (end < 0) throw new Error("产物里 CSS 数组的结尾形状变了");
  const expression = text.slice(start + "var CSS = ".length, end + '].join("\\n")'.length);
  const css = Function(`"use strict";\n${constantsSource}\nreturn ${expression};`)();
  if (typeof css !== "string" || css.length === 0) throw new Error("CSS 数组求值结果异常");
  if (css.includes('" +') || css.includes('+ "')) throw new Error("CSS 里残留拼接片段（求值没走对）");
  return css;
}

/**
 * 按名字抽出一个函数（含 `function name(...) { ... }` 整体）。
 * 扫描器会跳过字符串与注释里的花括号，所以函数体里写字面量 `{` 不会被算错。
 */
export function extractFunction(text, name) {
  const head = `function ${name}(`;
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`产物里找不到函数 ${name}（预览页必须用真函数，不能自己复制一份）`);
  let depth = 0;
  const i = text.indexOf("{", start);
  if (i < 0) throw new Error(`${name} 没有函数体`);
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    const next = text[j + 1];
    if (ch === "/" && next === "/") { j = text.indexOf("\n", j); continue; }
    if (ch === "/" && next === "*") { j = text.indexOf("*/", j) + 1; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      j += 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\") j += 1;
        j += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  throw new Error(`${name} 的函数体没有闭合`);
}

/**
 * 抽一组 `var NAME = <表达式>;` 并**在同一个作用域里按顺序求值**（因为常量之间会互相引用，
 * 例如 `KNOB_SIZE = TRACK_HEIGHT`）。求值的是产物里我自己的常量声明，不涉及外部输入。
 */
export function extractConstants(text, names) {
  const declarations = names.map((name) => {
    const match = new RegExp(`var ${name} = ([^;]+);`).exec(text);
    if (!match) throw new Error(`产物里找不到常量 ${name}`);
    return `var ${name} = ${match[1]};`;
  });
  const source = declarations.join("\n");
  const body = `${source}\nreturn { ${names.join(", ")} };`;
  return { values: Function(`"use strict";\n${body}`)(), source };
}

/**
 * 生成期守卫：抽出来的函数引用到的每个大写常量，页面里都必须声明过。
 * 漏一个就是 `ReferenceError`，而它会让**整个页面脚本**挂掉（滑条都不出现）。
 * 这个 bug 真的发生过一次（COLOR_BLUE 没发出去），所以在这里钉死。
 */
export function assertConstantsDeclared(functionsSource, declaredNames, builtinNames = []) {
  const declared = new Set(declaredNames);
  const BUILTINS = new Set([
    "Math", "JSON", "Object", "String", "Array", "Number", "Boolean", "Date", "RegExp",
    "Error", "Infinity", "NaN", "Function", "Set", "Map", "WeakMap", "URLSearchParams", "DOMMatrixReadOnly",
    ...builtinNames,
  ]);
  const referenced = new Set();
  for (const match of functionsSource.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) referenced.add(match[1]);
  const missing = [...referenced].filter((name) => !declared.has(name) && !BUILTINS.has(name));
  if (missing.length > 0) {
    throw new Error(`页面缺常量声明：${missing.join("、")} —— 会 ReferenceError 让整页脚本挂掉`);
  }
}
