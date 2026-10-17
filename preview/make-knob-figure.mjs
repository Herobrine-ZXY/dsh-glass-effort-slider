/**
 * 生成旋钮（那颗表示当前档位的珠子）的**材质特写**：`preview/knob-glass.html`。
 *
 * 为什么单独出一张：液态玻璃是"一两百像素里才看得出来"的东西 —— 在 28px 的滑条上，
 * 珠子只有那么大，靠普通截图根本分不清"半透明玻璃"和"纯白实心"。这张图把它放到 6× 看，
 * 并且**故意让它压在两种背景的交界上**（左边=档位填充色 / 右边=轨道底色），
 * 这样一眼就能看出 backdrop 折射真的在把背景透上来。
 *
 * 防漂移：CSS 与几何（knobOffsetOf / knobHighlightFor / fillBackgroundFor / energyFor）
 * 全部抽自 `lib/client.js`，页面里一个像素级的数字都没有重写。
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

const OUT = join(PREVIEW_DIR, "knob-glass.html");
const source = readBundle();

const fns = [
  "clamp01",
  "pctFromIndex",
  "energyFor",
  "mixColor",
  "rgbOf",
  "fillColorFor",
  "fillBackgroundFor",
  "particleCountFor",
  "starCountFor",
  "starLayerOpacityFor",
  "starBrightnessFor",
  "starHash01",
  "knobOffsetOf",
  "knobHighlightFor",
  // 灵动：速度 → 拉伸、过冲 → "叮"；水感：速度 → 液面偏移
  "velocityFor",
  "knobStretchFor",
  "knobBounceFor",
  "fillLeadTargetFor",
  "fillSkewTargetFor",
  "buildParticles",
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
  "STARFIELD_MIN",
  "GOLDEN_RATIO",
  "MIN_HEIGHT_SLOTS",
  "SNAP_OVERSHOOT",
  "KNOB_STRETCH_MAX",
  "KNOB_VELOCITY_SOFT",
  "KNOB_BOUNCE_MAX",
  "KNOB_MOTION_REDUCED_SCALE",
  "KNOB_VELOCITY_LIMIT",
  "FILL_LEAD_MAX",
  "FILL_VELOCITY_SOFT",
  "FILL_LAG_TAU_MS",
  "FILL_DRAIN_MS",
  "SKEW_MAX_DEG",
  "SKEW_VELOCITY_SOFT",
  "SKEW_LAG_TAU_MS",
  "WATER_PAD_PX",
  "FILL_BASE_RADIUS",
  "KNOB_SCALE_X",
  "KNOB_SCALE_Y",
  "KNOB_RX",
  "KNOB_RY",
];
const { values: constants, source: constantsSource } = extractConstants(source, constantNames);
const css = extractCss(source, constantsSource);
assertConstantsDeclared(fns, [...constantNames, "PARTICLES"]);

const api = Function(
  `"use strict";
  ${constantsSource}
  ${fns}
  var PARTICLES = buildParticles();
  return { knobOffsetOf, knobHighlightFor, velocityFor, knobStretchFor, knobBounceFor,
           fillLeadTargetFor, fillSkewTargetFor, fillColorFor, fillBackgroundFor, energyFor, pctFromIndex,
           particleCountFor, starLayerOpacityFor, starBrightnessFor, PARTICLES,
           KNOB_STRETCH_MAX, KNOB_BOUNCE_MAX, SNAP_OVERSHOOT, FILL_LEAD_MAX, SKEW_MAX_DEG };`,
)();

const LEVELS = [
  { id: "off", name: "Off", index: 0 },
  { id: "low", name: "Low", index: 1 },
  { id: "high", name: "High", index: 2 },
  { id: "max", name: "Max", index: 3 },
];
const TRACK_W = 260;
/** 可用轨道宽（260 − 2×14）：真实拖动速度按它换算成 pct/秒 —— 标定就靠这个数。 */
const TRACK_USABLE = TRACK_W - 28;

/** 一条真滑条：真 CSS + 真几何（水管裁切层 + 水层 + 刻度 + 珠子）。 */
function sliderMarkup(index, { width = TRACK_W, scale = 1, shapeVars = "", lead = 0, skew = 0 } = {}) {
  const pct = api.pctFromIndex(index, LEVELS.length);
  const offset = api.knobOffsetOf(pct);
  // 水宽 = 到圆心 + **珠子当下的横向半径**（按压 / 回弹 / 跟手拉伸）+ min(0, 液面偏移)；珠子的位置**不含**液面项。
  // `min(0px, …)` = "水不能超过珠子"；活体半径让水跟着珠子一起变扁 —— 端面就不再是直角，角上不溢水。
  const edge = `calc(${offset} + ${constants.FILL_BASE_RADIUS} * ${constants.KNOB_RADIUS}px * ${constants.KNOB_SCALE_X} + min(0px, var(--ces-fill-offset,0) * ${constants.KNOB_RADIUS}px))`;
  const energy = api.energyFor(pct);
  const count = api.particleCountFor(pct);
  const stars = api.PARTICLES.slice(0, count)
    .map((p, i) => `<span class="ces-star" style="top:${p.y}%;animation:none"><span class="ces-star__dot" style="left:${(p.phase * 100).toFixed(1)}%;--ces-b:${api.starBrightnessFor(i).toFixed(3)};animation:none"></span></span>`)
    .join("");
  const ticks = LEVELS.map((level) =>
    `<span class="ces-tick" data-on="${level.index <= index ? "1" : "0"}" style="left:${api.knobOffsetOf(api.pctFromIndex(level.index, LEVELS.length))}"></span>`).join("");
  // 水面倾角（高低落差）：**度**，水层绕左端旋转；珠子的形变（按压/回弹/拉伸）写在**根**上，
  // 水层右端的椭圆端面要用它们（珠子靠继承照样拿得到）。
  const water = `--ces-fill-offset:${lead.toFixed(4)};--ces-skew:${skew.toFixed(3)}deg${shapeVars}`;
  const style = `width:${width}px;${water}` + (scale === 1 ? "" : `;transform:scale(${scale});transform-origin:${(14 + pct * (width - 28)).toFixed(2)}px 14px`);
  return `<div class="ces-inline" data-energy="${energy > 0 ? "1" : "0"}" style="${`--ces-energy:${energy.toFixed(4)};`}${style}">
    <div class="ces-track" role="slider">
      <div class="ces-water" style="width:${edge}"><div class="ces-water-inner">
        <div class="ces-fill" style="background:${api.fillBackgroundFor(pct)}"></div>
        <div class="ces-energy"></div>
        <div class="ces-stars" style="opacity:${api.starLayerOpacityFor(pct).toFixed(3)}">${stars}</div>
      </div></div>
      ${ticks}
      <div class="ces-knob" style="left:${offset};--ces-hl:${api.knobHighlightFor(pct)}"></div>
    </div>
  </div>`;
}

/**
 * 一帧"高低落差"：倾角用产物的纯函数算（不写死数字），放大 3× 对准珠子看水面怎么斜。
 * @param spec { pxPerSec } 或 { skewDeg, lead }（排水荡波中途的某一帧）
 */
function tiltRow(label, spec) {
  const index = 2;
  const v = spec.pxPerSec !== undefined ? spec.pxPerSec / TRACK_USABLE : 0;
  const skew = spec.skewDeg !== undefined ? spec.skewDeg : api.fillSkewTargetFor(v, false);
  const lead = spec.pxPerSec !== undefined ? api.fillLeadTargetFor(v, false) : spec.lead || 0;
  const heightPx = Math.tan((Math.abs(skew) * Math.PI) / 180) * TRACK_USABLE;
  const detail = spec.skewDeg !== undefined
    ? `荡波中途的一帧：水面还斜着 ${skew.toFixed(2)}°（≈ ${heightPx.toFixed(1)}px，反方向荡回来）`
    : v === 0
      ? "静止：倾角 0 → 水面是**水平的**，且水面在珠子右缘（珠子泡在水里）"
      : `拖 ${spec.pxPerSec}px/秒（= ${v.toFixed(2)} pct/秒）→ 倾角 ${skew.toFixed(2)}° ≈ ${heightPx.toFixed(1)}px 高差（${skew < 0 ? "**右端抬起**：水在珠子后侧堆起来" : "**右端压下**：水面被推着往前追"}）`;
  const zoom = 3;
  const box = 300;
  const pct = api.pctFromIndex(index, LEVELS.length);
  const center = 14 + pct * (TRACK_W - 28);
  const left = -(center * zoom - box / 2);
  return `<div class="row"><span class="tag">${label}</span>
    <div class="closeup" style="width:${box}px;height:${(constants.TRACK_HEIGHT * zoom + 20).toFixed(0)}px">
      <div class="closeupInner" style="left:${left.toFixed(1)}px;top:10px;transform:scale(${zoom});transform-origin:0 0;width:${TRACK_W}px">
        ${sliderMarkup(index, { width: TRACK_W, lead, skew })}
      </div>
    </div>
    <span class="detail">${detail}</span></div>`;
}

/**
 * 一帧"水感"状态：液面偏移同样用产物的纯函数算（不写死数字）。
 * @param label  左侧标签
 * @param spec   { pxPerSec } 或 { drainFrom }（排水起点）
 */
function waterRow(label, spec) {
  const index = 2;
  const v = spec.pxPerSec !== undefined ? spec.pxPerSec / TRACK_USABLE : 0;
  const lead = spec.drainFrom !== undefined ? spec.drainFrom : api.fillLeadTargetFor(v, false);
  const leadPx = Math.abs(lead) * constants.KNOB_RADIUS;
  const detail = spec.drainFrom !== undefined
    ? `排水回摆：松手后液面排回 0，过冲那一下到了 ${lead.toFixed(3)}（这一帧就是过冲瞬间；正向偏移已被 min(0px,…) 夹在珠子右缘，所以只能往珠子内侧摆）`
    : v === 0
      ? "偏移 0 → 液面正好在珠子**圆心**（静止态，与旧版逐像素一致）"
      : `拖 ${spec.pxPerSec}px/秒 → 偏移 ${lead.toFixed(3)} ≈ ${leadPx.toFixed(1)}px（${lead > 0 ? "液面停在珠子**右缘**方向 = 珠子泡在水里" : "液面贴到珠子**左缘**方向 = 珠子领着水走"}）`;
  // 液面位移只有 ±7px（一个半径的 .52），整轨视图下看不出来 —— 所以这里放大 3× 对准珠子
  const zoom = 3;
  const box = 300;
  const pct = api.pctFromIndex(index, LEVELS.length);
  const center = 14 + pct * (TRACK_W - 28);
  const left = -(center * zoom - box / 2);
  return `<div class="row"><span class="tag">${label}</span>
    <div class="closeup" style="width:${box}px;height:${(constants.TRACK_HEIGHT * zoom + 20).toFixed(0)}px">
      <div class="closeupInner" style="left:${left.toFixed(1)}px;top:10px;transform:scale(${zoom});transform-origin:0 0;width:${TRACK_W}px">
        ${sliderMarkup(index, { width: TRACK_W, lead })}
      </div>
    </div>
    <span class="detail">${detail}</span></div>`;
}

/**
 * 一帧"灵动"状态：把当帧该写进珠子的变量算出来（**用产物里的纯函数**，不写死数字）。
 * @param label  左侧标签
 * @param spec   { pxPerSec }（真实速度）或 { bounce } 或 { press }
 */
function livelyRow(label, spec) {
  const index = 2; // High（能量 0.5，玻璃最有看头）
  const travel = 1 / 6; // 从 Low 吸到 High 的行程（和落档图同一段）
  const v = spec.pxPerSec !== undefined ? spec.pxPerSec / TRACK_USABLE : 0;
  const stretch = api.knobStretchFor(v, false);
  const bounce = spec.bounce ? api.knobBounceFor(api.pctFromIndex(index, LEVELS.length) + api.SNAP_OVERSHOOT * travel, api.pctFromIndex(index, LEVELS.length), travel, false) : 1;
  const press = spec.press || 1;
  const vars = `;--ces-stx:${stretch.x.toFixed(4)};--ces-sty:${stretch.y.toFixed(4)};--ces-bounce:${bounce.toFixed(4)};--ces-press:${press}`;
  const detail = spec.pxPerSec !== undefined
    ? `拖 ${spec.pxPerSec}px/秒（= ${v.toFixed(2)} pct/秒）→ 横向 ×${stretch.x.toFixed(4)}、纵向 ×${stretch.y.toFixed(4)}（横×纵 = ${(stretch.x * stretch.y).toFixed(4)}，折合约 ${((stretch.x - 1) * constants.KNOB_SIZE).toFixed(2)}px）`
    : spec.bounce
      ? `落档冲过刻度那一刻 → ×${bounce.toFixed(4)}（过冲峰值 = 1 + KNOB_BOUNCE_MAX = ${(1 + api.KNOB_BOUNCE_MAX).toFixed(2)}）`
      : spec.press
        ? `按住（data-dragging）→ ×${press}（CSS 给的，不用 JS）`
        : `速度 0 → 横向 ×${stretch.x.toFixed(4)}、纵向 ×${stretch.y.toFixed(4)}（完美的圆）`;
  return `<div class="row"><span class="tag">${label}</span>${sliderMarkup(index, { shapeVars: vars })}<span class="detail">${detail}</span></div>`;
}

/** 6× 特写：珠子正好压在"填充 / 轨道"的交界上（左边紫蓝、右边浅灰）。 */
function closeupMarkup(index, zoom) {
  const pct = api.pctFromIndex(index, LEVELS.length);
  const center = 14 + pct * (TRACK_W - 28);
  const box = 620;
  const left = -(center * zoom - box / 2);
  return `<div class="closeup" style="width:${box}px;height:${(constants.TRACK_HEIGHT * zoom + 40).toFixed(0)}px">
    <div class="closeupInner" style="left:${left.toFixed(1)}px;top:20px;transform:scale(${zoom});transform-origin:0 0;width:${TRACK_W}px">
      ${sliderMarkup(index, { width: TRACK_W })}
    </div>
    <div class="closeupNote">${zoom}× · ${LEVELS[index].name}</div>
  </div>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-glass-effort-slider — 旋钮材质特写（液态玻璃）</title>
<style>
body{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f5f5;--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:rgb(15 17 21 / 8%);--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-state-business-primary:#4d93f8;--dsw-radius-md:12px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4d93f8;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:24px 28px 30px;background:#fbfbfc;color:var(--dsw-alias-label-primary);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:16px;margin:0 0 4px}
.sub{font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary);margin:0 0 18px;max-width:900px}
.sub code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;background:#0000000a;padding:1px 4px;border-radius:4px}
.card{background:#fff;border:1px solid #00000014;border-radius:14px;padding:14px 18px 16px;margin-bottom:16px;box-shadow:0 1px 3px #0000000a}
.cardTitle{font-size:12.5px;font-weight:600;margin:0 0 10px;color:var(--dsw-alias-label-secondary)}
.dark{background:#1b1c20;border-color:#ffffff1f;color:#ebeef2}
.dark .cardTitle{color:#adb2b8}
.row{display:flex;align-items:center;gap:14px;padding:5px 0}
.row + .row{border-top:1px dashed #0000000f}
.dark .row + .row{border-top-color:#ffffff14}
.tag{width:52px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.detail{margin-left:14px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dark .tag{color:#adb2b8}
.closeups{display:flex;gap:14px;flex-wrap:wrap}
.closeup{position:relative;overflow:hidden;border-radius:12px;background:linear-gradient(90deg,#ffffff00,#ffffff00)}
.closeup .closeupInner{position:absolute;left:0;top:0}
.closeupNote{position:absolute;right:8px;bottom:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);background:#ffffffc9;border-radius:6px;padding:1px 6px}
/* 特写里的粒子静止（要看清材质，不是看动画相位） */
.closeup .ces-star,.closeup .ces-star__dot{animation:none !important}
/* ── 以下是**从 lib/client.js 抽取的真 CSS** ── */
${css}
</style>
</head>
<body>
<h1>旋钮：液态玻璃珠子（材质 + 灵动 + 水感）</h1>
<p class="sub">
  这是 <b>iOS 26 式液态玻璃</b>，不是毛玻璃：<b>没有 <code>backdrop-filter</code></b>，珠子背后的填充、星尘、
  轨道底色是<b>清晰</b>透出来的（毛玻璃会把它们糊掉）。玻璃感全部来自"光在曲面上"——
  珠体只有 .03~.16 的白（几乎空的）、<code>::after</code> 一片大柔光加一枚<b>小亮斑</b>（那一滴镜面光，
  位置随档位反向滑 = 滚珠感）、<code>::before</code> 底部一道透射光弧随能量变亮；
  形状则由<b>内侧 1px 亮边 + 外侧极细暗发丝 + 两层软投影</b>撑住（浅色轨道上全靠这些）。
  下面全是<b>真 CSS + 真几何</b>（抽自 <code>lib/client.js</code>），没有一处手绘。
  <b>注意珠子压在填充边界上的那两张 6× 特写</b>：左半边透出档位色、右半边透出轨道灰，边界是锐的 —— 这就是液态玻璃。
  最后两张卡片是<b>水感</b>与<b>灵动</b>：填充的液面贴着珠子的后缘走（<b>上限就是珠子右缘</b> ——
  宽度里的 <code>min(0px, …)</code> 保证<b>水不会溢到珠子右边</b>；向后拖时珠子整颗泡在水里，
  松手排水还回摆一下）、珠子拖得越快横向拉得越长、落档冲过刻度那一下会"叮"、光慢半拍地跟着晃 ——
  那几个数字**同样是现算的**（<code>fillLeadTargetFor</code> / <code>knobStretchFor</code> / <code>knobBounceFor</code>）。
</p>

<div class="card">
  <p class="cardTitle">四档 · 浅色主题（珠子随档位变亮/变深，高光也跟着滑）</p>
  ${LEVELS.map((level) => `<div class="row"><span class="tag">${level.name}</span>${sliderMarkup(level.index)}</div>`).join("\n  ")}
</div>

<div class="card dark">
  <p class="cardTitle">四档 · 深色主题（珠子在暗底上变成"烟熏玻璃"）</p>
  ${LEVELS.map((level) => `<div class="row"><span class="tag">${level.name}</span>${sliderMarkup(level.index)}</div>`).join("\n  ")}
</div>

<div class="card">
  <p class="cardTitle">6× 特写：珠子正好压在「已填充 / 未填充」的交界上</p>
  <div class="closeups">
    ${closeupMarkup(1, 6)}
    ${closeupMarkup(2, 6)}
  </div>
</div>

<div class="card">
  <p class="cardTitle">高低落差：水面会斜（按**真实拖动速度**现算，3× 对准珠子）</p>
  ${tiltRow("静止", {})}
  ${tiltRow("向左拖", { pxPerSec: -400 })}
  ${tiltRow("向右拖", { pxPerSec: 400 })}
  ${tiltRow("荡波中途", { skewDeg: -3.4, lead: 0.2 })}
</div>

<div class="card">
  <p class="cardTitle">水感：填充的液面贴着珠子的后缘走（按**真实拖动速度**现算，3× 对准珠子）</p>
  ${waterRow("静止", {})}
  ${waterRow("慢慢拖", { pxPerSec: 100 })}
  ${waterRow("正常拖", { pxPerSec: 400 })}
  ${waterRow("快拖", { pxPerSec: 900 })}
  ${waterRow("排水回摆", { drainFrom: -0.05 })}
</div>

<div class="card">
  <p class="cardTitle">灵动：同样的珠子，一动起来就变形（按**真实拖动速度**现算）</p>
  ${livelyRow("静止", {})}
  ${livelyRow("正常拖", { pxPerSec: 400 })}
  ${livelyRow("快拖", { pxPerSec: 900 })}
  ${livelyRow("落档峰值", { bounce: true })}
  ${livelyRow("按压", { press: 0.95 })}
</div>
</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`旋钮材质 + 灵动特写已生成：${OUT}`);
console.log(`（4 档 × 浅/深 + 2 张 6× 特写 + 5 帧灵动；珠子直径 ${constants.KNOB_SIZE}px，CSS ${css.length} 字符）`);
