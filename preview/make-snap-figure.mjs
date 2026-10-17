/**
 * 生成落档动画图解：`preview/snap-frames.html`（静态 HTML，不跑 JS）。
 *
 * 为什么需要它：落档是**时间上**的东西，截图截不到"弹一下"。这个页面把同一段落档
 * 按时间切片：上半是位置-时间曲线（能直接看到冲过目标再回来），下半是逐帧胶片
 * （每一帧都是真 CSS + 真几何算出来的滑条）。
 *
 * 防漂移：CSS、常量、几何（knobOffsetOf / fillBackgroundFor / energyFor）、
 * 缓动（settlePctFor / snapEaseFor）**全部抽自 lib/client.js**，页面里一个数学都不重写。
 *
 * 截图：用系统自带的无头浏览器（见 README「重生成图解」一节）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_DIR,
  assertConstantsDeclared,
  extractConstants,
  extractCss,
  extractFunction,
  readBundle,
} from "./extract.mjs";

const OUT = join(PREVIEW_DIR, "snap-frames.html");
const source = readBundle();

const fns = [
  "clamp01",
  "pctFromIndex",
  "indexFromPct",
  "mixColor",
  "rgbOf",
  "fillColorFor",
  "fillBackgroundFor",
  "energyFor",
  "particleCountFor",
  "starCountFor",
  "starLayerOpacityFor",
  "starBrightnessFor",
  "starHash01",
  "knobOffsetOf",
  "knobHighlightFor",
  "buildParticles",
  "snapBackOvershootFor",
  "solveSnapBackC1",
  "snapEaseFor",
  "snapDurationFor",
  "settlePctFor",
].map((name) => extractFunction(source, name)).join("\n\n");

const constantNames = [
  "TRACK_HEIGHT",
  "KNOB_SIZE",
  "KNOB_RADIUS",
  "ENERGY_START",
  "ENERGY_END",
  "COLOR_BLUE",
  "COLOR_VIOLET",
  "COLOR_DEEP",
  "COLOR_TEXT_VIOLET",
  "SNAP_DURATION_MS",
  "SNAP_DURATION_REDUCED_MS",
  "SNAP_OVERSHOOT",
  "STARFIELD_MIN",
  // 水层结构 / 水位基准（CSS 里用到了，取值时必须声明）
  "WATER_PAD_PX",
  "FILL_BASE_RADIUS",
  "KNOB_SCALE_X",
  "KNOB_SCALE_Y",
  "KNOB_RX",
  "KNOB_RY",
  // buildParticles 要用的两个（粒子高度与相位的铺法）
  "GOLDEN_RATIO",
  "MIN_HEIGHT_SLOTS",
];
const { values: constants, source: constantsSource } = extractConstants(source, constantNames);
const css = extractCss(source, constantsSource);
assertConstantsDeclared(fns, [...constantNames, "PARTICLES", "SNAP_BACK_C1"]);

/* ── 真求值：把抽出来的函数装进一个沙箱，用它算出图解里的每个数字 ── */
const api = Function(
  `"use strict";
  ${constantsSource}
  ${fns}
  var SNAP_BACK_C1 = solveSnapBackC1();
  var PARTICLES = buildParticles();
  return { settlePctFor, snapEaseFor, snapDurationFor, snapBackOvershootFor, SNAP_BACK_C1,
           knobOffsetOf, knobHighlightFor, fillBackgroundFor, energyFor, particleCountFor, starLayerOpacityFor,
           starBrightnessFor, PARTICLES, pctFromIndex, indexFromPct,
           SNAP_DURATION_MS, SNAP_DURATION_REDUCED_MS, SNAP_OVERSHOOT };`,
)();

/* ── 这一段的真实参数：4 档模型，松手在 50.7%（clientX = 152 / 300px 轨道），
      刚好越过 Low↔High 的分界（50%），最近档位 = High（刻度 2/3）。──
   选这个例子是因为它最"有话说"：既证明"吸附到最近档位"（越过分界往上吸），
   又因为跨过了能量起点（1/3），落档途中能看到紫能量层渐入、星尘变密。 */
const LEVELS = 4;
const FROM = (152 - 14) / (300 - 28); // 与插件 pctAt 同一套内缩几何
const TARGET_INDEX = api.indexFromPct(FROM, LEVELS); // = 2（High）
const TARGET = api.pctFromIndex(TARGET_INDEX, LEVELS); // = 2/3
const D = api.SNAP_DURATION_MS;
const D_REDUCED = api.SNAP_DURATION_REDUCED_MS;
const NORMAL = (t) => api.settlePctFor(FROM, TARGET, t, false);
const REDUCED = (t) => api.settlePctFor(FROM, TARGET, t, true);

/** 峰值（过冲最大那一刻）——直接从曲线上扫出来，不猜。 */
let peakT = 0;
let peakPct = -1;
for (let t = 0; t <= D; t += 0.5) {
  const pct = NORMAL(t);
  if (pct > peakPct) { peakPct = pct; peakT = t; }
}
const overshoot = peakPct - TARGET;
/**
 * 向上越过刻度的那一刻（过冲段的起点）。
 * 注意 easeOutBack 的值只在 u=1 回到 1.0 —— 也就是说**越过刻度之后，整段回落都是贴着
 * 刻度从上方接近**，到终点才精确落上去。这就是"弹一下再停住"的手感来源。
 */
let crossUp = D;
for (let t = 0; t <= D; t += 0.5) {
  if (NORMAL(t) >= TARGET) { crossUp = t; break; }
}

/* ── 曲线图（SVG，坐标在 node 侧算好，页面里没有 JS）── */
const CHART = { w: 780, h: 250, padL: 62, padR: 132, padT: 26, padB: 40 };
const Y_LO = FROM - 0.012;
const Y_HI = peakPct + 0.014;
const xOf = (t) => CHART.padL + (t / D) * (CHART.w - CHART.padL - CHART.padR);
const yOf = (pct) => CHART.h - CHART.padB - ((pct - Y_LO) / (Y_HI - Y_LO)) * (CHART.h - CHART.padT - CHART.padB);
const pathOf = (fn, duration) => {
  const pts = [];
  for (let t = 0; t <= duration; t += 3) pts.push(`${xOf(t).toFixed(2)},${yOf(fn(t)).toFixed(2)}`);
  pts.push(`${xOf(duration).toFixed(2)},${yOf(fn(duration)).toFixed(2)}`);
  return `M${pts.join(" L")}`;
};

const yTicks = [0.52, 0.56, 0.6, 0.64, 0.68];
const xTicks = [0, 100, 200, 300, 420];

const chart = `
<svg class="chart" viewBox="0 0 ${CHART.w} ${CHART.h}" width="${CHART.w}" height="${CHART.h}" role="img"
     aria-label="落档位置-时间曲线：从 50.7% 弹性吸附到 66.7%，244ms 处冲过刻度再弹回来">
  ${yTicks.map((v) => `<line x1="${CHART.padL}" y1="${yOf(v).toFixed(2)}" x2="${CHART.w - CHART.padR}" y2="${yOf(v).toFixed(2)}" class="grid"/>
    <text x="${CHART.padL - 10}" y="${(yOf(v) + 4).toFixed(2)}" class="tick" text-anchor="end">${(v * 100).toFixed(0)}%</text>`).join("\n  ")}
  ${xTicks.map((t) => `<line x1="${xOf(t).toFixed(2)}" y1="${CHART.padT}" x2="${xOf(t).toFixed(2)}" y2="${CHART.h - CHART.padB}" class="grid"/>
    <text x="${xOf(t).toFixed(2)}" y="${CHART.h - CHART.padB + 18}" class="tick" text-anchor="middle">${t}ms</text>`).join("\n  ")}

  <line x1="${CHART.padL}" y1="${yOf(TARGET).toFixed(2)}" x2="${CHART.w - CHART.padR}" y2="${yOf(TARGET).toFixed(2)}" class="target"/>
  <text x="${CHART.w - CHART.padR + 8}" y="${(yOf(TARGET) + 4).toFixed(2)}" class="label targetLabel">High 刻度 66.7%</text>
  <line x1="${CHART.padL}" y1="${yOf(FROM).toFixed(2)}" x2="${CHART.w - CHART.padR}" y2="${yOf(FROM).toFixed(2)}" class="release"/>
  <text x="${CHART.w - CHART.padR + 8}" y="${(yOf(FROM) + 4).toFixed(2)}" class="label releaseLabel">松手位置 50.7%</text>

  <path d="${pathOf(REDUCED, D_REDUCED)}" class="curve reduced"/>
  <path d="${pathOf(NORMAL, D)}" class="curve normal"/>

  <line x1="${xOf(peakT).toFixed(2)}" y1="${yOf(peakPct).toFixed(2)}" x2="${xOf(peakT).toFixed(2)}" y2="${yOf(TARGET).toFixed(2)}" class="peakRule"/>
  <circle cx="${xOf(peakT).toFixed(2)}" cy="${yOf(peakPct).toFixed(2)}" r="5" class="peakDot"/>
  <text x="${xOf(peakT).toFixed(2)}" y="${(yOf(peakPct) - 12).toFixed(2)}" class="label peakLabel" text-anchor="middle">峰值 ${(peakPct * 100).toFixed(2)}%（过冲 +${(overshoot * 100).toFixed(2)}%）· ${peakT.toFixed(0)}ms</text>
  <circle cx="${xOf(crossUp).toFixed(2)}" cy="${yOf(TARGET).toFixed(2)}" r="3.5" class="crossDot"/>
  <text x="${xOf(crossUp).toFixed(2)}" y="${(yOf(TARGET) + 30).toFixed(2)}" class="label crossLabel" text-anchor="middle">${crossUp.toFixed(0)}ms 越过刻度（开始过冲）</text>
  <circle cx="${xOf(D).toFixed(2)}" cy="${yOf(TARGET).toFixed(2)}" r="4.5" class="endDot"/>
  <text x="${xOf(D).toFixed(2)}" y="${(yOf(TARGET) - 14).toFixed(2)}" class="label" text-anchor="end">420ms 精确停在刻度</text>
</svg>`;

/* ── 逐帧胶片：每一帧都是真 CSS + 真几何 ── */
const particles = api.PARTICLES;
const frameTimes = [...new Set([0, 40, 80, 120, 160, 200, Math.round(peakT), 300, 360, D])].sort((a, b) => a - b);

function frameMarkup(t) {
  const pct = NORMAL(t);
  const energy = api.energyFor(pct);
  const offset = api.knobOffsetOf(pct);
  const count = api.particleCountFor(pct);
  const delta = (pct - TARGET) * 100;
  const isPeak = Math.abs(t - Math.round(peakT)) < 1;
  const isEnd = t === D;
  const ticks = [];
  for (let i = 0; i < LEVELS; i += 1) {
    ticks.push(
      `<span class="ces-tick" data-on="${i <= TARGET_INDEX ? "1" : "0"}" style="left:${api.knobOffsetOf(api.pctFromIndex(i, LEVELS))}"></span>`,
    );
  }
  const stars = particles
    .slice(0, count)
    .map((p, i) => `<span class="ces-star" style="top:${p.y}%;animation:none"><span class="ces-star__dot" style="left:${(p.phase * 100).toFixed(1)}%;--ces-b:${api.starBrightnessFor(i).toFixed(3)};animation:none"></span></span>`)
    .join("");
  const tag = t === 0 ? "松手瞬间" : isPeak ? "峰值 · 过冲最大" : isEnd ? "落定 · 精确刻度" : delta > 0 ? "回弹中（仍在刻度右侧）" : "回落中";
  return `
  <div class="frame${isPeak ? " frame-peak" : ""}${isEnd ? " frame-end" : ""}">
    <div class="frameMeta">
      <b>${t}ms</b>
      <span>位置 ${(pct * 100).toFixed(2)}%</span>
      <span class="frameTag">${tag}</span>
    </div>
    <div class="frameStage">
      <div class="ces-inline" data-energy="${energy > 0 ? "1" : "0"}" data-settling="1" style="--ces-energy:${energy.toFixed(4)};width:340px">
        <div class="ces-track" role="slider">
          <div class="ces-water" style="width:calc(${offset} + ${constants.FILL_BASE_RADIUS} * ${constants.KNOB_RADIUS}px * ${constants.KNOB_SCALE_X})"><div class="ces-water-inner">
            <div class="ces-fill" style="background:${api.fillBackgroundFor(pct)}"></div>
            <div class="ces-energy"></div>
            <div class="ces-stars" style="opacity:${api.starLayerOpacityFor(pct).toFixed(3)}">${stars}</div>
          </div></div>
          ${ticks.join("")}
          <span class="tickRef" style="left:${api.knobOffsetOf(TARGET)}"></span>
          <div class="ces-knob" style="left:${offset};--ces-hl:${api.knobHighlightFor(pct)}"></div>
        </div>
      </div>
    </div>
    <div class="frameDelta${Math.abs(delta) < 0.005 ? " is-zero" : ""}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%<small>相对刻度</small></div>
    <div class="frameStars">${count} 颗星 · 能量 ${energy.toFixed(2)}</div>
  </div>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-glass-effort-slider — 落档（吸附 + 弹性回弹）图解</title>
<style>
body{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f5f5;--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:rgb(15 17 21 / 8%);--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-state-business-primary:#4d93f8;--dsw-radius-md:12px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4d93f8;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:26px 30px 34px;background:#fbfbfc;color:var(--dsw-alias-label-primary);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:17px;margin:0 0 4px}
.sub{font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary);margin:0 0 18px;max-width:840px}
.sub code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;background:#0000000a;padding:1px 4px;border-radius:4px}
.card{background:#fff;border:1px solid #00000014;border-radius:14px;padding:16px 18px 10px;margin-bottom:18px;box-shadow:0 1px 3px #0000000a}
.cardTitle{font-size:13px;font-weight:600;margin:0 0 10px;color:var(--dsw-alias-label-secondary)}
.chart{display:block}
.grid{stroke:#00000012;stroke-width:1}
.target{stroke:#9333ea;stroke-width:1.4;stroke-dasharray:5 4}
.release{stroke:#4d93f8;stroke-width:1.2;stroke-dasharray:2 4;opacity:.75}
.curve{fill:none;stroke-linecap:round}
.curve.normal{stroke:#7c3aed;stroke-width:2.6}
.curve.reduced{stroke:#9ca3af;stroke-width:2;stroke-dasharray:6 5}
.peakDot{fill:#7c3aed}
.peakRule{stroke:#7c3aed;stroke-width:1;stroke-dasharray:3 3;opacity:.6}
.crossDot{fill:#7c3aed;opacity:.85}
.crossLabel{fill:#8b5cf6}
.endDot{fill:#fff;stroke:#7c3aed;stroke-width:2}
.tick{font-size:10.5px;fill:#8b8f96}
.label{font-size:11px;fill:#6b7280}
.targetLabel{fill:#7c3aed}
.releaseLabel{fill:#3b82f6}
.peakLabel{fill:#6d28d9;font-weight:600}
.legend{display:flex;gap:18px;font-size:11.5px;color:#6b7280;margin:2px 0 8px 8px;flex-wrap:wrap}
.legend i{display:inline-block;width:16px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.frames{display:flex;flex-direction:column;gap:6px}
.frame{display:flex;align-items:center;gap:14px;padding:4px 8px;border-radius:10px}
.frame-peak{background:#7c3aed0f;outline:1px solid #7c3aed33}
.frame-end{background:#4d93f80d}
.frameMeta{width:196px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:1px}
.frameMeta b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.frameMeta span{font-variant-numeric:tabular-nums}
.frameTag{color:#8b8f96;font-size:11px}
.frame-peak .frameTag{color:#6d28d9;font-weight:600}
.frameStage{flex:none}
.frameDelta{width:96px;flex:none;font-size:13px;font-weight:600;color:#6d28d9;font-variant-numeric:tabular-nums;text-align:right}
.frameDelta small{display:block;font-size:10.5px;font-weight:400;color:#9aa0a6}
.frameDelta.is-zero{color:#0f9d58}
.frameStars{width:150px;flex:none;font-size:11px;color:#8b8f96;font-variant-numeric:tabular-nums}
/* 目标刻度的参考线：一眼看出"旋钮是不是冲过了刻度" */
.tickRef{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #9333ea;opacity:.85;pointer-events:none}
/* 胶片里的粒子静止：图解要的是"位置/能量/星数"，不是动画相位 */
.frameStage .ces-star,.frameStage .ces-star__dot,.frameStage .ces-energy__sweep{animation:none !important}
/* ── 以下是**从 lib/client.js 抽取的真 CSS** ── */
${css}
</style>
</head>
<body>
<h1>落档：松手吸附 + 弹性回弹</h1>
<p class="sub">
  拖动松手后，先把档位写回最近档位（这一步与旧版一字不差），视觉上再从<b>松手位置</b>弹性吸附到
  该档位的刻度：<b>冲过一点再弹回来</b>。下面是同一段落的两个视角 —— 曲线是时间上的形状，胶片是像素上的样子。
  曲线、几何与配色全部抽自 <code>lib/client.js</code>（<code>settlePctFor</code> / <code>snapEaseFor</code> /
  <code>knobOffsetOf</code> / <code>fillBackgroundFor</code> / <code>energyFor</code>），图解里没有第二份数学。
  这一段的具体参数：4 档模型、松手在 ${(FROM * 100).toFixed(1)}%（刚好越过分界 50%）→
  <b>吸附到最近档位 High</b>（刻度 ${(TARGET * 100).toFixed(1)}%）；行程 ${((TARGET - FROM) * 100).toFixed(2)}%，
  ≈${crossUp.toFixed(0)}ms 越过刻度、${peakT.toFixed(0)}ms 冲到最高（过冲 +${(overshoot * 100).toFixed(2)}%），
  ${D}ms 精确停在刻度上 —— 最后那一段是<b>贴着刻度从上方</b>落下来的（easeOutBack 只在终点回到 1.0）。
</p>

<div class="card">
  <p class="cardTitle">① 位置-时间曲线（正常 ${D}ms ↔ 减少动态效果 ${D_REDUCED}ms）</p>
  <div class="legend">
    <span><i style="background:#7c3aed"></i>正常：easeOutBack，回弹幅度 ${(api.SNAP_OVERSHOOT * 100).toFixed(0)}% × 行程</span>
    <span><i style="background:#9ca3af"></i>减少动态效果：${D_REDUCED}ms，ease-out，<b>不回弹</b></span>
    <span><i style="background:#9333ea"></i>目标刻度</span>
    <span><i style="background:#4d93f8"></i>松手位置</span>
  </div>
  ${chart}
</div>

<div class="card">
  <p class="cardTitle">② 逐帧胶片（同一段落档，${frameTimes.length} 帧）</p>
  <div class="frames">
    ${frameTimes.map(frameMarkup).join("\n")}
  </div>
</div>
</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`落档图解已生成：${OUT}`);
console.log(`（${frameTimes.length} 帧；松手 ${(FROM * 100).toFixed(2)}% → 目标 ${(TARGET * 100).toFixed(2)}%（index ${TARGET_INDEX}），峰值 ${(peakPct * 100).toFixed(2)}% @ ${peakT.toFixed(0)}ms，过冲 +${(overshoot * 100).toFixed(2)}%）`);
