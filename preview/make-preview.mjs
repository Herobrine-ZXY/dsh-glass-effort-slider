/**
 * 生成观感预览页：`preview/panel.html`
 *
 * 存在的理由：真插件要重启 DSH Desktop 才看得见。这个页面把**官方模型菜单**也一起复刻出来，
 * 并且用与插件 DOM 桥**同样的 4 个内联样式 + 同样的 append** 把滑条注入到「推理等级」那一行里，
 * 所以看到的加高、折行、能量层就是真东西。
 *
 * 防漂移的两条硬措施（否则预览页会慢慢变成一张骗人的图）：
 *   1. CSS 直接从 `lib/client.js` 里**抽出来**，不是复制一份；
 *   2. 拖动数学（indexFromPct / pctFromIndex / energyFor / 粒子参数）也是从产物里
 *      **抽函数体**内联进页面 —— 抽取失败就抛错，绝不悄悄生成一个数学不一样的预览。
 *
 * 明确它不是什么：静态复刻，不接宿主、不发生任何档位写回。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_DIR,
  assertConstantsDeclared,
  extractConstants,
  extractCss,
  extractFunction,
  readBundle,
} from "./extract.mjs";

const OUT = join(PREVIEW_DIR, "panel.html");

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
  "speedFor",
  "particleCountFor",
  "starCountFor",
  "starLayerOpacityFor",
  "starBrightnessFor",
  "starDurationFor",
  "starDelayFor",
  "starHash01",
  "knobOffsetOf",
  "knobHighlightFor",
  "buildParticles",
  "isOffLevel",
  "valueColorFor",
  // 落档（吸附 + 弹性回弹）：预览页也要弹出真动画，所以缓动必须从产物里抽
  "snapBackOvershootFor",
  "solveSnapBackC1",
  "snapEaseFor",
  "snapDurationFor",
  "settlePctFor",
  // 上下键切模型 + 滚轮归一化：同一份函数，预览页不重写
  "toggleModelFor",
  "wheelNotchesFor",
  // 珠子的灵动：速度 / 拉伸 / 落档"叮" / 高光滞后
  "velocityFor",
  "knobStretchFor",
  "knobBounceFor",
  "knobLagPctFor",
  "approachFor",
  // 进度条的水感：液面偏移 / 倾斜（高低落差）/ 排水荡波
  "fillLeadTargetFor",
  "fillSkewTargetFor",
  "sloshHash",
  "sloshSpecFor",
  "sloshEaseFor",
].map((name) => extractFunction(source, name)).join("\n\n");
const constantNames = [
  "ROW_PADDING_BLOCK",
  "TRACK_HEIGHT",
  "KNOB_SIZE",
  "KNOB_RADIUS",
  "BASE_SPEEDUP",
  "STARFIELD_DURATION_MEAN",
  "STARFIELD_DURATION_SPREAD",
  "STARFIELD_MIN",
  "GOLDEN_RATIO",
  "MAX_SPEED_FACTOR",
  "MIN_HEIGHT_SLOTS",
  "ENERGY_START",
  "ENERGY_END",
  "COLOR_BLUE",
  "COLOR_VIOLET",
  "COLOR_DEEP",
  "COLOR_TEXT_VIOLET",
  "SNAP_DURATION_MS",
  "SNAP_DURATION_REDUCED_MS",
  "SNAP_OVERSHOOT",
  "WHEEL_NOTCH_PX",
  "WHEEL_ACC_LIMIT",
  "MODEL_TOGGLE_TOKENS",
  // 灵动的幅度常量（预览页与真插件同一份）
  "KNOB_STRETCH_MAX",
  "KNOB_VELOCITY_SOFT",
  "KNOB_BOUNCE_MAX",
  "KNOB_LAG_TAU_MS",
  "KNOB_MOTION_STALE_MS",
  "KNOB_MOTION_REDUCED_SCALE",
  "KNOB_VELOCITY_LIMIT",
  // 水感的幅度与时间常数
  "FILL_LEAD_MAX",
  "FILL_VELOCITY_SOFT",
  "FILL_LAG_TAU_MS",
  "FILL_DRAIN_MS",
  "FILL_LEAD_EPSILON",
  // 高低落差（倾斜）+ 水舌 + 排水荡波
  "SKEW_MAX_DEG",
  "SKEW_VELOCITY_SOFT",
  "SKEW_LAG_TAU_MS",
  "WATER_PAD_PX",
  "FILL_BASE_RADIUS",
  "KNOB_SCALE_X",
  "KNOB_SCALE_Y",
  "KNOB_RX",
  "KNOB_RY",
  "SLOSH_DURATION_MIN",  "SLOSH_DURATION_MAX",
  "SLOSH_WAVES_MIN",
  "SLOSH_WAVES_MAX",
  "SLOSH_DAMPING_MIN",
  "SLOSH_DAMPING_MAX",
  "SLOSH_AMPLITUDE_MIN",
  "SLOSH_AMPLITUDE_MAX",
];
const { values: constants, source: constantsSource } = extractConstants(source, constantNames);
const css = extractCss(source, constantsSource);
if (constants.KNOB_SIZE !== constants.TRACK_HEIGHT) {
  throw new Error("产物里旋钮直径 ≠ 轨道高度（用户要求「与滑条同宽」）");
}
if (!css.includes(".ces-energy") || !css.includes(".ces-star__dot")) {
  throw new Error("抽出来的 CSS 里没有能量层/星空规则（产物结构变了）");
}

/* ── 生成期守卫：抽出来的函数引用到的每个大写常量，预览页里都必须声明过 ──
   漏一个就是 `ReferenceError`，而它会让**整个页面脚本**挂掉（滑条都不出现）。
   这个 bug 真的发生过一次（COLOR_BLUE 没发出去），所以在这里钉死。 */
assertConstantsDeclared(fns, [
  ...constantNames,
  "PARTICLES",
  // 页面里由 `solveSnapBackC1()` 现算出来的（产物里那个 IIFE 的结果），不是抽出来的标量
  "SNAP_BACK_C1",
]);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-glass-effort-slider — 观感预览（官方菜单那一行）</title>
<style>
/* ── 预览页自带的最小主题令牌（取自 DSH 官方 ui-theme 的真实取值）──
   真插件在 DSH 里直接用官方令牌，这里只是为了在浏览器里还原同一套观感。 */
body{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f5f5;--dsw-alias-bg-layer-3:#fff;--dsw-menu-surface-fill:#f8f9fa94;--dsw-alias-border-l1:rgb(15 17 21 / 8%);--dsw-alias-border-l2:#0000001a;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-state-business-primary:#4d93f8;--dsw-alias-state-error-primary:#e5484d;--dsw-alias-menu-icon:#979da6;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-menu-backdrop-filter:blur(20px);--dsw-elevation-prominent:0 12px 32px rgb(0 0 0 / 18%);--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4d93f8;color-scheme:light}
body[data-ds-dark-theme]{--dsw-alias-bg-layer-1:#212123;--dsw-alias-bg-layer-2:#17171a;--dsw-alias-bg-layer-3:#292929;--dsw-menu-surface-fill:#43454a73;--dsw-alias-border-l1:rgb(255 255 255 / 6%);--dsw-alias-border-l2:#ffffff1f;--dsw-alias-label-primary:#ebeef2;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;--dsw-alias-label-caption:#979da6;--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-state-business-primary:#7aaaff;--dsw-alias-state-error-primary:#ff6b6b;--dsw-elevation-prominent:0 12px 32px rgb(0 0 0 / 45%);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;gap:18px;padding:32px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.stage{width:560px;max-width:100%}
.note{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary);margin-bottom:14px}
.note b{color:var(--dsw-alias-label-secondary)}
/* 复刻官方模型菜单外壳（.menu / .cell 的真实取值：flex 行、34px 高、padding 0 8px、gap 6px） */
.mock-menu{z-index:1100;width:max-content;min-width:280px;max-width:420px;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);border:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;padding:4px}
.mock-cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex;font-family:inherit}
.mock-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mock-cellLabel{white-space:nowrap;flex:none}
.mock-cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.mock-chev{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}
.mock-composer{margin-top:18px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px}
/* 复刻官方**收起态**模型席按钮（triggerLabel / triggerEffort 两个 span） */
.mock-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.mock-triggerLabel{font-weight:600}
.mock-triggerEffort{color:var(--dsw-alias-label-caption);font-weight:500}
.mock-trigger .mock-chev{width:14px;height:14px}
.mock-send{width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-state-business-primary);opacity:.85;flex:none}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.controls button{font:inherit;font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.controls button:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* ── 以下是**从 lib/client.js 抽取的真 CSS** ── */
${css}
</style>
</head>
<body>
<div class="stage">
  <div class="note">
    这是 <b>观感预览</b>（静态复刻）：CSS 与拖动数学都是从 <code>lib/client.js</code> 抽取的真代码，
    注入手法也与插件一致（同样 4 个内联样式 + append 一个容器）。<b>拖到最右</b>看最高档能量层；
    <b>松手</b>看落档：旋钮会从松手位置<b>弹性吸附</b>到最近档位（冲过一点再弹回来）——
    曲线与时长同样抽自产物（<code>settlePctFor</code> / <code>SNAP_*</code> 常量）。
    <b>点一下滑条再按键盘</b>：<code>←</code>/<code>→</code> 一档一档走（到端点钳住、不环绕）、
    <code>↑</code>/<code>↓</code> 在 Flash ↔ Pro 之间切模型（不动档位）、<code>Home</code>/<code>End</code> 跳两端；
    <b>鼠标停在滑条上滚轮</b>也是调档位（一格一档，且不会连带滚页面）。
    <b>珠子是"活"的</b>：拖得越快横向拉得越长（保体积地压扁），松手落档冲过刻度那一下会"叮"一下，
    镜面高光比珠子慢半拍（光在液体里晃）——全部由产物里的纯函数驱动（<code>velocityFor</code> /
    <code>knobStretchFor</code> / <code>knobBounceFor</code>）。
    注意输入框那一行<b>不再有任何东西</b>——控制项只在官方菜单的「推理等级」那一行里。
  </div>

  <div class="mock-menu" role="menu" aria-label="模型与推理等级">
    <button class="mock-cell" role="menuitem" type="button" id="modelRow">
      <span class="mock-cellLabel">模型</span>
      <span class="mock-cellValue" id="modelValue">DeepSeek-V41-Flash</span>
      <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
    </button>
    <button class="mock-cell" role="menuitem" type="button" id="effortRow">
      <span class="mock-cellLabel">推理等级</span>
      <span class="mock-cellValue" id="effortValue">High</span>
      <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
    </button>
  </div>

  <div class="mock-composer">
    <button class="mock-trigger" type="button" id="seat">
      <span class="mock-triggerLabel" id="seatLabel">DeepSeek-V41-Flash</span>
      <span class="mock-triggerEffort" id="seatEffort">High</span>
      <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 11 8.5 6.5 13" transform="rotate(90 8.5 8.5)"></path></svg>
    </button>
    <span class="mock-send"></span>
  </div>

  <div class="controls">
    <button id="theme">切换浅色/深色</button>
    <button id="levels4">4 档（Off/Low/High/Max）</button>
    <button id="levels2">2 档（High/Max）</button>
    <button id="levels6">6 档（含 minimal/xhigh）</button>
    <button id="replay">重放落档（从 16.9% 弹到 Low）</button>
    <button id="model">切模型（Flash ↔ Pro）</button>
    <button id="breath">玻璃呼吸（活泼档）：关</button>
    <button id="motion">模拟「减少动态效果」：关</button>
  </div>
</div>

<script>
/* ── 以下函数体从 lib/client.js 抽取（数学与真插件逐字一致）── */
${fns}

var ROW_PADDING_BLOCK = ${JSON.stringify(constants.ROW_PADDING_BLOCK)};
var TRACK_HEIGHT = ${JSON.stringify(constants.TRACK_HEIGHT)};
var KNOB_SIZE = ${JSON.stringify(constants.KNOB_SIZE)};
var KNOB_RADIUS = ${JSON.stringify(constants.KNOB_RADIUS)};
var BASE_SPEEDUP = ${JSON.stringify(constants.BASE_SPEEDUP)};
var STARFIELD_DURATION_MEAN = ${JSON.stringify(constants.STARFIELD_DURATION_MEAN)};
var STARFIELD_DURATION_SPREAD = ${JSON.stringify(constants.STARFIELD_DURATION_SPREAD)};
var STARFIELD_MIN = ${JSON.stringify(constants.STARFIELD_MIN)};
var GOLDEN_RATIO = ${JSON.stringify(constants.GOLDEN_RATIO)};
var MAX_SPEED_FACTOR = ${JSON.stringify(constants.MAX_SPEED_FACTOR)};
var MIN_HEIGHT_SLOTS = ${JSON.stringify(constants.MIN_HEIGHT_SLOTS)};
var ENERGY_START = ${JSON.stringify(constants.ENERGY_START)};
var ENERGY_END = ${JSON.stringify(constants.ENERGY_END)};
var COLOR_BLUE = ${JSON.stringify(constants.COLOR_BLUE)};
var COLOR_VIOLET = ${JSON.stringify(constants.COLOR_VIOLET)};
var COLOR_DEEP = ${JSON.stringify(constants.COLOR_DEEP)};
var COLOR_TEXT_VIOLET = ${JSON.stringify(constants.COLOR_TEXT_VIOLET)};
/* 落档（松手吸附 + 弹性回弹）：时长与回弹幅度也用产物的常量；
   SNAP_BACK_C1 在产物里是"由回弹幅度二分反解"的 IIFE —— 这里直接调同一个函数，
   不复制数学（预览页的铁律：数学只能有一份）。 */
var SNAP_DURATION_MS = ${JSON.stringify(constants.SNAP_DURATION_MS)};
var SNAP_DURATION_REDUCED_MS = ${JSON.stringify(constants.SNAP_DURATION_REDUCED_MS)};
var SNAP_OVERSHOOT = ${JSON.stringify(constants.SNAP_OVERSHOOT)};
var SNAP_BACK_C1 = solveSnapBackC1();
/* 键盘 / 滚轮：归一化常量也来自产物（滚轮一格 = 多少像素、累积上限、两个模型的关键词）。 */
var WHEEL_NOTCH_PX = ${JSON.stringify(constants.WHEEL_NOTCH_PX)};
var WHEEL_ACC_LIMIT = ${JSON.stringify(constants.WHEEL_ACC_LIMIT)};
var MODEL_TOGGLE_TOKENS = ${JSON.stringify(constants.MODEL_TOGGLE_TOKENS)};
/* 珠子的灵动：幅度常量也来自产物（预览页与真插件同一份）。 */
var KNOB_STRETCH_MAX = ${JSON.stringify(constants.KNOB_STRETCH_MAX)};
var KNOB_VELOCITY_SOFT = ${JSON.stringify(constants.KNOB_VELOCITY_SOFT)};
var KNOB_BOUNCE_MAX = ${JSON.stringify(constants.KNOB_BOUNCE_MAX)};
var KNOB_LAG_TAU_MS = ${JSON.stringify(constants.KNOB_LAG_TAU_MS)};
var KNOB_MOTION_STALE_MS = ${JSON.stringify(constants.KNOB_MOTION_STALE_MS)};
var KNOB_MOTION_REDUCED_SCALE = ${JSON.stringify(constants.KNOB_MOTION_REDUCED_SCALE)};
var KNOB_VELOCITY_LIMIT = ${JSON.stringify(constants.KNOB_VELOCITY_LIMIT)};
/* 进度条的水感：幅度与时间常数也来自产物。 */
var FILL_LEAD_MAX = ${JSON.stringify(constants.FILL_LEAD_MAX)};
var FILL_VELOCITY_SOFT = ${JSON.stringify(constants.FILL_VELOCITY_SOFT)};
var FILL_LAG_TAU_MS = ${JSON.stringify(constants.FILL_LAG_TAU_MS)};
var FILL_DRAIN_MS = ${JSON.stringify(constants.FILL_DRAIN_MS)};
var FILL_LEAD_EPSILON = ${JSON.stringify(constants.FILL_LEAD_EPSILON)};
/* 高低落差（倾斜）+ 水舌 + 排水荡波：同一份常量。 */
var SKEW_MAX_DEG = ${JSON.stringify(constants.SKEW_MAX_DEG)};
var SKEW_VELOCITY_SOFT = ${JSON.stringify(constants.SKEW_VELOCITY_SOFT)};
var SKEW_LAG_TAU_MS = ${JSON.stringify(constants.SKEW_LAG_TAU_MS)};
/* 水位基准与"水层比轨道高多少"——CSS 里用了，页面脚本（水宽、星尘 inset）也要用。 */
var FILL_BASE_RADIUS = ${JSON.stringify(constants.FILL_BASE_RADIUS)};
var WATER_PAD_PX = ${JSON.stringify(constants.WATER_PAD_PX)};
var SLOSH_DURATION_MIN = ${JSON.stringify(constants.SLOSH_DURATION_MIN)};
var SLOSH_DURATION_MAX = ${JSON.stringify(constants.SLOSH_DURATION_MAX)};
var SLOSH_WAVES_MIN = ${JSON.stringify(constants.SLOSH_WAVES_MIN)};
var SLOSH_WAVES_MAX = ${JSON.stringify(constants.SLOSH_WAVES_MAX)};
var SLOSH_DAMPING_MIN = ${JSON.stringify(constants.SLOSH_DAMPING_MIN)};
var SLOSH_DAMPING_MAX = ${JSON.stringify(constants.SLOSH_DAMPING_MAX)};
var SLOSH_AMPLITUDE_MIN = ${JSON.stringify(constants.SLOSH_AMPLITUDE_MIN)};
var SLOSH_AMPLITUDE_MAX = ${JSON.stringify(constants.SLOSH_AMPLITUDE_MAX)};
/* 星尘参数表：抽出来的 starDelayFor 会读 PARTICLES，这里必须真的建出来
   （少了它预览页会 ReferenceError 整个脚本挂掉 —— 生成期有守卫盯着这件事）。 */
var PARTICLES = buildParticles();
var LEVELS = {
  "4": [{id:"off",name:"Off"},{id:"low",name:"Low"},{id:"high",name:"High"},{id:"max",name:"Max"}],
  "2": [{id:"high",name:"High"},{id:"max",name:"Max"}],
  "6": [{id:"off",name:"Off"},{id:"minimal",name:"Minimal"},{id:"low",name:"Low"},{id:"medium",name:"Medium"},{id:"xhigh",name:"XHigh"},{id:"max",name:"Max"}]
};
var current = "4";
var index = 2;
var dragging = false;

/* 预览页的假目录：就是真机的两个模型（id 形状一致），↑/↓ 用**产物里的**
   toggleModelFor 在两个之间切 —— 所以「只会在 flash/pro 间切」这条规则也是真的在跑。 */
var MODELS = [
  { id: "deepseek-flash", name: "DeepSeek-V41-Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }
];
var modelIndex = 0;
function previewSnapshot() {
  return { current: { provider: "deepseek", model: MODELS[modelIndex].id }, groups: [{ id: "deepseek", models: MODELS }] };
}

/* ── 复刻插件的 DOM 桥：同样 4 个内联样式 + append 一个容器 ── */
var row = document.getElementById("effortRow");
row.style.height = "auto";
row.style.flexWrap = "wrap";
row.style.paddingTop = ROW_PADDING_BLOCK;
row.style.paddingBottom = ROW_PADDING_BLOCK;

var host = document.createElement("div");
host.className = "ces-inline";
host.setAttribute("data-energy", "0");
row.appendChild(host);

var track = document.createElement("div");
track.className = "ces-track";
track.setAttribute("role", "slider");
track.setAttribute("tabindex", "0");
// 与真组件同结构：.ces-water（管子形状的裁切层）> .ces-water-inner（比轨道高、绕左端旋转）
var water = document.createElement("div");
water.className = "ces-water";
var waterInner = document.createElement("div");
waterInner.className = "ces-water-inner";
var fill = document.createElement("div");
fill.className = "ces-fill";
var energy = document.createElement("div");
energy.className = "ces-energy";
var sweep = document.createElement("div");
sweep.className = "ces-energy__sweep";
energy.appendChild(sweep);
var ticks = document.createElement("span");
var knob = document.createElement("div");
knob.className = "ces-knob";
waterInner.appendChild(fill);
waterInner.appendChild(energy);
water.appendChild(waterInner);
track.appendChild(water);
track.appendChild(ticks); // 刻度画在水上面（和真组件一致）
track.appendChild(knob);
host.appendChild(track);
var valueSpan = document.getElementById("effortValue");
var seatEffortSpan = document.getElementById("seatEffort");
var modelValueSpan = document.getElementById("modelValue");
var seatLabelSpan = document.getElementById("seatLabel");

/* 星空（所有出现粒子的档位共用）：外层是整轨宽度的轨道（自己在横穿），内层圆点带亮度。 */
var starDefs = buildParticles().map(function (p, i) {
  return { top: p.y, brightness: starBrightnessFor(i) };
});
/* 星星单独一层（与真组件同结构）：不跟星云淡入，否则 high 档会被星云的 0.5 透明度压暗。 */
var starHost = document.createElement("span");
starHost.className = "ces-stars";
starHost.setAttribute("data-ces-part", "stars");
starHost.style.position = "absolute";
// 星尘放在水层里（跟着水一起转）；垂直范围由 .ces-water-inner > .ces-stars 的 CSS 钉在轨道高度上
starHost.style.inset = WATER_PAD_PX + "px auto " + WATER_PAD_PX + "px 0";
starHost.style.borderRadius = "999px";
starHost.style.overflow = "hidden";
starHost.style.pointerEvents = "none";
waterInner.insertBefore(starHost, energy);
var starEls = starDefs.map(function (def, i) {
  var star = document.createElement("span");
  star.className = "ces-star";
  star.style.top = def.top + "%";
  var dot = document.createElement("span");
  dot.className = "ces-star__dot";
  dot.style.setProperty("--ces-b", def.brightness.toFixed(3));
  star.appendChild(dot);
  star.style.display = "none";
  starHost.appendChild(star);
  return star;
});

/** 速度随位置变化（保留）：MAX 1.5s、high 3s、左端 ~8.6s；各星只差 ±8%。
 *  时长/相位与生产一致：**直接内联**，不走 CSS 变量（变量会让负相位在真宿主里失效）。 */
function applyParticles(pct) {
  var count = particleCountFor(pct);
  var speedFactor = speedFor(pct);
  // 宽度由「.ces-water」这一层统一给（水盖到哪，星亮到哪），这里不再各层设宽
  starHost.style.opacity = String(starLayerOpacityFor(pct));
  starEls.forEach(function (el, i) {
    var duration = starDurationFor(i, speedFactor);
    el.style.display = i < count ? "" : "none";
    el.style.animationDuration = duration.toFixed(3) + "s";
    el.style.animationDelay = starDelayFor(i, duration).toFixed(3) + "s";
  });
  starHost.setAttribute("data-count", String(count));
}

/* 系统开了「减少动态效果」时真插件用 title 说明原因；预览页照做。
   （预览页多给一个开关来**模拟**它，这样不用改系统设置也能看见"更短且不回弹"的落档。） */
var motionQuery = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
var reduced = !!(motionQuery && motionQuery.matches);
host.setAttribute("data-motion", reduced ? "reduced" : "full");
host.setAttribute("data-breath", "0"); // 与真插件默认一致：呼吸（活泼档）默认关，按钮可开
if (reduced) track.title = "推理等级（系统「减少动态效果」已开启：粒子已放缓）";

/* ── 落档动画（与真插件同一套：settlePctFor + rAF，只用产物的常量和曲线）── */
var settle = null;
var settleRaf = null;
var shownPctNow = pctFromIndex(index, LEVELS[current].length);

/* ── 珠子的灵动 + 进度条的"水感"（液面 / 倾斜落差 / 水舌 / 荡波）：与真插件同一套纯函数 ── */
var motion = { pct: null, at: 0, velocity: 0, lag: null, lagAt: 0, lead: 0, leadAt: 0, skew: 0, skewAt: 0 };
var relaxTimer = null;
var drainRaf = null;
var drainCount = 0;
var drainStart = { lead: 0, skew: 0 };

/**
 * 排水"荡波"：液面 + 倾斜一起按**产物里的荡波曲线**荡回 0。
 * 这一荡的时长/波数/阻尼/水量由 sloshSpecFor(种子) 每次重新给（和真插件同一套"随机"）。
 */
function drainWater() {
  if (drainRaf !== null) { cancelAnimationFrame(drainRaf); drainRaf = null; }
  drainCount += 1;
  var seed = drainCount * 37 + Math.abs(drainStart.lead) * 100 + Math.abs(drainStart.skew) / 10;
  var spec = sloshSpecFor(seed);
  var startAt = performance.now();
  host.setAttribute("data-slosh", spec.durationMs + "ms/" + spec.waves.toFixed(2) + "波");
  function stepDrain() {
    var t = spec.durationMs > 0 ? (performance.now() - startAt) / spec.durationMs : 1;
    var g = t >= 1 ? 1 : sloshEaseFor(t, spec, reduced);
    motion.lead = drainStart.lead * (1 - g);
    motion.skew = drainStart.skew * (1 - g);
    if (t >= 1) {
      drainRaf = null;
      motion.lead = 0;
      motion.skew = 0;
      render(motion.pct);
      return;
    }
    render(motion.pct);
    drainRaf = requestAnimationFrame(stepDrain);
  }
  stepDrain();
}

function motionTick(shownPct, moved) {
  var at = performance.now();
  if (motion.pct !== null) {
    motion.velocity = moved ? velocityFor(motion.pct, shownPct, at - motion.at) : 0;
  }
  var lagDt = motion.lagAt > 0 ? at - motion.lagAt : 0;
  if (motion.lag === null) motion.lag = shownPct;
  motion.lag = knobLagPctFor(motion.lag, shownPct, lagDt);
  motion.lagAt = at;
  // 液面 + 倾斜：都由速度给目标，自己指数逼近（"先停在珠子后缘，再继续流过去"，同时水面斜着甩）
  if (moved) {
    if (drainRaf !== null) { cancelAnimationFrame(drainRaf); drainRaf = null; } // 手又动了：荡波让位
    motion.lead = approachFor(motion.lead, fillLeadTargetFor(motion.velocity, reduced), motion.leadAt > 0 ? at - motion.leadAt : 0, FILL_LAG_TAU_MS);
    motion.skew = approachFor(motion.skew, fillSkewTargetFor(motion.velocity, reduced), motion.skewAt > 0 ? at - motion.skewAt : 0, SKEW_LAG_TAU_MS);
  }
  motion.leadAt = at;
  motion.skewAt = at;
  motion.pct = shownPct;
  motion.at = at;
  if (motion.velocity !== 0) {
    if (relaxTimer !== null) clearTimeout(relaxTimer);
    relaxTimer = setTimeout(function () { // 停手后把速度归零（与真插件一样，一个 timer）
      relaxTimer = null;
      motion.velocity = 0;
      if (Math.abs(motion.lead) > FILL_LEAD_EPSILON || Math.abs(motion.skew) > FILL_LEAD_EPSILON) {
        drainStart = { lead: motion.lead, skew: motion.skew };
        drainWater(); // 荡回去（每次的时长/波数/水量都不一样）
        return;
      }
      motion.lead = 0;
      motion.skew = 0;
      render(motion.pct);
    }, KNOB_MOTION_STALE_MS);
  }
}

function cancelSettle() {
  if (settleRaf !== null) { cancelAnimationFrame(settleRaf); settleRaf = null; }
  if (settle !== null) { settle = null; host.setAttribute("data-settling", "0"); }
}

function settleStep() {
  if (settle === null) return;
  var elapsed = performance.now() - settle.startAt;
  if (elapsed >= snapDurationFor(reduced)) {
    var target = settle.to;
    settle = null;
    settleRaf = null;
    host.setAttribute("data-settling", "0");
    render(target); // 末帧落在**精确刻度**上
    return;
  }
  render(settlePctFor(settle.from, settle.to, elapsed, reduced));
  settleRaf = requestAnimationFrame(settleStep);
}

/** 从 fromPct 弹性吸附到 targetIndex 的刻度（回弹幅度 = SNAP_OVERSHOOT）。 */
function startSettle(fromPct, targetIndex) {
  cancelSettle();
  var levels = LEVELS[current];
  index = targetIndex; // 落档期间的读数/刻度就是目标档位（与真插件的 shownIndex 一样）
  settle = {
    from: typeof fromPct === "number" ? fromPct : pctFromIndex(targetIndex, levels.length),
    to: pctFromIndex(targetIndex, levels.length),
    startAt: performance.now(),
  };
  host.setAttribute("data-settling", "1");
  settleStep();
}

function renderTicks() {
  var levels = LEVELS[current];
  ticks.innerHTML = "";
  levels.forEach(function (level, i) {
    var tick = document.createElement("span");
    tick.className = "ces-tick";
    tick.style.left = knobOffsetOf(pctFromIndex(i, levels.length));
    tick.dataset.on = i <= index ? "1" : "0";
    ticks.appendChild(tick);
  });
}

function render(pct) {
  var levels = LEVELS[current];
  var shownPct = typeof pct === "number" ? pct : pctFromIndex(index, levels.length);
  var moved = motion.pct !== null && Math.abs(shownPct - motion.pct) > 1e-6;
  shownPctNow = shownPct;
  motionTick(shownPct, moved); // 灵动 + 水感：先按"上一帧 → 这一帧"推进速度/滞后/液面
  var stretch = knobStretchFor(motion.velocity, reduced);
  var bounce = settle === null ? 1 : knobBounceFor(shownPct, settle.to, Math.abs(settle.to - settle.from), reduced);
  var strength = energyFor(shownPct);
  var shown = levels[index];
  var offset = knobOffsetOf(shownPct);
  // 水宽 = 到圆心 + 珠子当下的横向半径（按压 / 回弹 / 跟手拉伸）+ min(0, 液面偏移 × 半径)
  //        —— min(0px, …) = "水不能超过珠子"；活体半径让水跟着珠子一起变扁/变长（角上不溢水）。
  //        宽度挂在「.ces-water」上：它的右缘就是水面，端面椭圆（KNOB_RX/KNOB_RY）随之成形。
  var edge = "calc(" + offset + " + " + FILL_BASE_RADIUS + " * " + KNOB_RADIUS + "px * " + KNOB_SCALE_X + " + min(0px, var(--ces-fill-offset,0) * " + KNOB_RADIUS + "px))";
  water.style.width = edge;
  fill.style.background = fillBackgroundFor(shownPct);
  knob.style.left = offset;
  knob.style.setProperty("--ces-hl", knobHighlightFor(motion.lag === null ? shownPct : motion.lag));
  // 珠子当下的形变写在**根**上：水层右端的椭圆端面要用它们（珠子靠继承照样拿得到）
  host.style.setProperty("--ces-stx", stretch.x.toFixed(4));
  host.style.setProperty("--ces-sty", stretch.y.toFixed(4));
  host.style.setProperty("--ces-bounce", bounce.toFixed(4));
  host.style.setProperty("--ces-fill-offset", motion.lead.toFixed(4));
  // 水面倾角（高低落差）：**度**，水层绕左端旋转
  host.style.setProperty("--ces-skew", motion.skew.toFixed(3) + "deg");
  host.style.setProperty("--ces-energy", String(strength));
  host.dataset.energy = strength > 0 ? "1" : "0";
  row.style.boxShadow = strength > 0 ? "inset 0 0 0 1px rgba(168,85,247," + (0.16 + 0.34 * strength).toFixed(2) + ")" : "";
  valueSpan.textContent = shown.name;
  // 官方菜单里那一行的数值文字：跟着**显示中**的位置/档位着色（Off 档 = 空串 = 官方灰）
  valueSpan.style.color = valueColorFor(shownPct, shown);
  // 收起态的席按钮：显示的是**已生效**档位（预览里没有草稿，就是当前档），同样着色
  seatEffortSpan.textContent = shown.name;
  seatEffortSpan.style.color = valueColorFor(pctFromIndex(index, levels.length), shown);
  track.setAttribute("aria-valuemax", String(levels.length - 1));
  track.setAttribute("aria-valuenow", String(index));
  track.setAttribute("aria-valuetext", shown.name);
  applyParticles(shownPct);
  renderTicks();
}

function pctAt(clientX) {
  var rect = track.getBoundingClientRect();
  var usable = rect.width - KNOB_RADIUS * 2;
  if (!(usable > 0)) return null;
  return clamp01((clientX - rect.left - KNOB_RADIUS) / usable);
}

function onMove(clientX) {
  var pct = pctAt(clientX);
  if (pct === null) return;
  index = indexFromPct(pct, LEVELS[current].length);
  render(pct);
}

track.addEventListener("pointerdown", function (event) {
  cancelSettle(); // 打断上一段落档：手指立刻接管显示
  host.setAttribute("data-dragging", "1");
  dragging = true;
  track.setPointerCapture(event.pointerId);
  onMove(event.clientX);
});
track.addEventListener("pointermove", function (event) { if (dragging) onMove(event.clientX); });
/** 松手：从**松手位置**弹性吸附到最近档位（预览页不接宿主，所以只有这一段视觉）。 */
function end() {
  if (!dragging) return;
  dragging = false;
  host.setAttribute("data-dragging", "0");
  if (LEVELS[current].length > 0) startSettle(shownPctNow, index);
}
track.addEventListener("pointerup", end);
track.addEventListener("pointercancel", end);

/* ── 键盘：←/→ 步进调档位（钳制不环绕）、↑/↓ 切 Flash/Pro、Home/End 跳两端 ── */
function stepEffort(delta) {
  var levels = LEVELS[current];
  var next = Math.max(0, Math.min(levels.length - 1, index + delta));
  if (next === index) return;
  index = next;                      // 与真插件一样：步进位置立刻前进（连按一档一档地走）
  startSettle(shownPctNow, next);
}
function jumpTo(target) {
  var levels = LEVELS[current];
  var next = Math.max(0, Math.min(levels.length - 1, target));
  if (next === index) return;
  index = next;
  startSettle(shownPctNow, next);
}
/** 切模型：用产物里的 toggleModelFor 算目标（只会在 flash/pro 之间），不动档位。 */
function switchModel() {
  var target = toggleModelFor(previewSnapshot());
  if (target === null) return;
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].id === target.model) {
      modelIndex = i;
      modelValueSpan.textContent = MODELS[i].name;
      seatLabelSpan.textContent = MODELS[i].name;
      return;
    }
  }
}
/* 按键挂在 document 上（与真插件一致：菜单开着就生效，不必先点滑条），
   作用范围 = 这个假菜单 + 收起态的席按钮；输入框/文本域不接管。 */
var menuEl = document.getElementById("effortRow").parentNode;
var seatEl = document.getElementById("seat");
document.addEventListener("keydown", function (event) {
  var target = event.target;
  var inScope = (menuEl.contains(target) === true) || (seatEl.contains(target) === true) || seatEl === target;
  if (!inScope) return;
  var tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  var handled = true;
  if (event.key === "ArrowLeft") stepEffort(-1);
  else if (event.key === "ArrowRight") stepEffort(1);
  else if (event.key === "ArrowUp" || event.key === "ArrowDown") switchModel();
  else if (event.key === "Home") jumpTo(0);
  else if (event.key === "End") jumpTo(LEVELS[current].length - 1);
  else handled = false;
  if (!handled) return;
  event.preventDefault();
  event.stopPropagation();
});

/* ── 滚轮：真插件用原生非 passive 监听 + 一组归一化常量，预览页照抄同一套 ──
   （React 的 onWheel 是 passive 的，preventDefault 无效 —— 所以这里也是 addEventListener。） */
var wheelAcc = 0;
host.addEventListener("wheel", function (event) {
  var notches = wheelNotchesFor(event);
  if (notches === 0) return;
  var acc = wheelAcc + notches;
  var steps = acc >= 1 ? 1 : (acc <= -1 ? -1 : 0);
  acc = Math.max(-WHEEL_ACC_LIMIT, Math.min(WHEEL_ACC_LIMIT, acc - steps));
  wheelAcc = acc;
  if (steps !== 0) stepEffort(-steps); // 向下滚 = 降档
  event.preventDefault();              // 滑条上的滚轮不滚页面
  event.stopPropagation();
}, { passive: false });

function setLevels(key) {
  cancelSettle();
  current = key;
  index = Math.min(index, LEVELS[key].length - 1);
  render();
}

/* 支持 ?level=off|low|high|max（无头截图和自查都用它定位到具体档位） */
(function applyQuery() {
  var wanted = (new URLSearchParams(location.search).get("level") || "").toLowerCase();
  if (wanted === "") return;
  var levels = LEVELS[current];
  for (var i = 0; i < levels.length; i += 1) {
    if (levels[i].id === wanted) { index = i; return; }
  }
})();

document.getElementById("theme").addEventListener("click", function () {
  if (document.body.hasAttribute("data-ds-dark-theme")) document.body.removeAttribute("data-ds-dark-theme");
  else document.body.setAttribute("data-ds-dark-theme", "");
});
document.getElementById("levels4").addEventListener("click", function () { setLevels("4"); });
document.getElementById("levels2").addEventListener("click", function () { setLevels("2"); });
document.getElementById("levels6").addEventListener("click", function () { setLevels("6"); });
/* 演示按钮：把"松手在 16.9%"那一幕重放一遍（4 档时最近档位 = Low，回弹最明显）。 */
document.getElementById("replay").addEventListener("click", function () {
  cancelSettle();
  var fromPct = 0.1691;
  var target = indexFromPct(fromPct, LEVELS[current].length);
  index = target;
  render(fromPct);
  startSettle(fromPct, target);
});
/* 演示按钮：切模型（与 ↑/↓ 同一条路径：产物里的 toggleModelFor，只会在 flash/pro 间切）。 */
document.getElementById("model").addEventListener("click", function () { switchModel(); });
/* 演示开关：呼吸（活泼档）——真插件里由 KNOB_BREATH_ENABLED 这个常量门控，默认关。 */
document.getElementById("breath").addEventListener("click", function () {
  var on = host.getAttribute("data-breath") === "1" ? "0" : "1";
  host.setAttribute("data-breath", on);
  this.textContent = "玻璃呼吸（活泼档）：" + (on === "1" ? "开" : "关");
});
/* 演示开关：不用改系统设置也能看"更短、且不回弹"的落档（真插件读的是 matchMedia）。 */
document.getElementById("motion").addEventListener("click", function () {
  reduced = !reduced;
  host.setAttribute("data-motion", reduced ? "reduced" : "full");
  this.textContent = "模拟「减少动态效果」：" + (reduced ? "开" : "关");
  track.title = "推理等级" + (reduced ? "（系统「减少动态效果」已开启：粒子已放缓）" : "");
});

render();
</script>
</body>
</html>
`;

mkdirSync(PREVIEW_DIR, { recursive: true });
writeFileSync(OUT, html, "utf8");
console.log(`预览页已生成：${OUT}`);
console.log(`（CSS ${css.length} 字符 + ${fns.split("function ").length - 1} 个抽自产物的函数 + ROW_PADDING_BLOCK=${constants.ROW_PADDING_BLOCK}）`);
