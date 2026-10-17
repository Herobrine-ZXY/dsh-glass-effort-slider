/**
 * dsh-glass-effort-slider — 客户端半边
 *
 * 把 DSH 官方模型菜单里的**「推理等级」那一行**改造成 Codex 风格滑条：
 *   · 那一行加高上下内距、允许折行，滑条作为第二行铺满整行宽度
 *   · 拖到最高档时，轨道亮起紫色能量层（流向渐变 + 扫光 + 22 颗星尘粒子），整行描一圈紫边
 *   · 输入框工具行**不加任何东西**（原来的胶囊已撤掉）
 *
 * ── 官方那一行的确切形状（来自 app.asar 源码，本插件用到的锚点）──────────
 *
 *   席（官方 ModelSelect 的 trigger）：
 *     <button aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}>
 *   菜单（portal 到 body 的 MenuSurface）：
 *     <… role="menu" id={`${id}-menu`}>                       ← 用 aria-controls + id 定位，比 class 稳
 *       <button role="menuitem"> 模型 … </button>              ← 根面板**只有**两个 menuitem
 *       <button role="menuitem"> 推理等级 <span>High</span> <svg/> </button>   ← 目标行
 *   子面板（模型列表 / 等级列表）用的是 `menuitemradio`，所以
 *   `button[role="menuitem"]` 恰好唯一标识根面板那两行 —— 这是本插件的主锚点。
 *
 * ── 三条纪律 ────────────────────────────────────────────────────────────
 *  1. **只动那一行**：只写 4 个内联样式（height/flex-wrap/padding-block）+ 往行里 append 一个容器；
 *     关菜单或卸载时逐个还原，不碰官方其它 DOM、不碰官方 class。
 *  2. **fail-open**：任何一步找不到（没有 aria-controls、菜单没有两个 menuitem、会话作用域没就绪…）
 *     就什么都不做 —— 官方菜单保持原样，绝不因为本插件而点不开。
 *  3. **绝不注入消息**：不监听 agent/pre-step、不 append 会话事件、不构造消息
 *     （同类插件在这里踩过 V4 会话准入的坑，本插件结构上不存在这条路）。
 */
window.__ModuleLoader__.load({
  id: "dsh-glass-effort-slider",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var ReactDOM = require("react-dom");

    var PACKAGE_ID = "dsh-glass-effort-slider";
    /**
     * 产物自己的版本号，只出现在滑条的 `title` 提示里。
     * 为什么值得写死一份：这东西最常见的困惑是"我明明重开了怎么没变化" ——
     * 鼠标停在滑条上看一眼提示里的 `v…` 就知道跑的是哪一版（测试会断言它与 package.json 一致，
     * 所以不会忘同步）。跨过它的改动：2.0 删掉 backdrop-filter、…、1.6 水感。
     */
    var SLIDER_VERSION = "1.9.0";
    /** 仍然注册一个（不可见的）插槽条目：它是**每会话**拿到 sessionId 与 ctx 的立足点。 */
    var SLOT_NAME = "conversation.input.right";
    var ENTRY_ID = "glass-effort-slider";
    var ENTRY_ORDER = 40;
    /** 「加高那一栏的上下距离」。 */
    var ROW_PADDING_BLOCK = "10px";
    /** 官方那一行的中文/英文文案（形状锚点之一；认不出就按官方固定顺序取第 2 个 menuitem）。 */
    var EFFORT_ROW_LABELS = ["推理等级", "Effort"];
    /** 拖动期间的写回降频窗口（毫秒）。松手一律立即落地。 */
    var COMMIT_THROTTLE_MS = 120;
    /** 提交后等宿主真实回报的上限；超时回滚并提示，不继续假装已生效。 */
    var COMMIT_DEADLINE_MS = 10000;
    /** 目录解析失败时的退避重试序列（毫秒，累计约 9 秒）。 */
    var RETRY_DELAYS = [60, 240, 540, 960, 1500, 3000, 3000];
    var STYLE_MARKER = PACKAGE_ID;

    /* ── 尺寸与速率常量：**必须声明在 CSS 数组之前**，因为样式表要插值它们 ──
       （踩过一次：CSS 数组先于常量求值，样式里写进去的是 `height:undefinedpx`，
       真机上轨道会塌成 0 高。测试里对轨道高/旋钮直径的断言就是为这个加的。） */
    /** 轨道高度（px）。旋钮直径与它相同 —— 一个"管子里的球"，圆永远是完整的圆。 */
    var TRACK_HEIGHT = 28;
    var KNOB_SIZE = TRACK_HEIGHT;
    /** 旋钮半径。圆心在两端各留出这个半径，圆圈才不会顶出轨道被菜单裁掉。 */
    var KNOB_RADIUS = KNOB_SIZE / 2;
    /** 全局速率倍数（用户要求：所有速度 ×4）。粒子时长 = 基准时长 ÷ (本值 × speedFor)。 */
    var BASE_SPEEDUP = 4;
    /**
     * 星空的**基准横穿时长**（秒，越大越慢）与各星时长浮动（± 这个比例）。
     * 基准对应"位置速率最快的那一档"（speedFor 的上限 `MAX_SPEED_FACTOR = 2`）：MAX 档 1.5s，
     * high 档（1×）3s，左端（0.35×）约 8.6s —— 速度随位置变化这条一直保留。
     * 浮动压到 ±8%（速度差 1.16×）：原来用 0.95~2.05s（速度差 2.16×）时快星会追上慢星成团。
     */
    var STARFIELD_DURATION_MEAN = 1.5;
    var STARFIELD_DURATION_SPREAD = 0.08;
    /** MAX 档星空的亮度/大小下限（1 = 现在的大小与亮度，即上限）。 */
    var STARFIELD_MIN = 0.5;
    /** 黄金比：把 22 颗星的高度与相位按低差异序列铺开（见 buildParticles / starDelayFor）。 */
    var GOLDEN_RATIO = 0.6180339887498949;
    /** 位置速率的上限（= speedFor 的封顶值），用来把"最快那一档"和基准时长对齐。 */
    var MAX_SPEED_FACTOR = 2;
    /** 系统开启「减少动态效果」时，星星时长乘这个倍数（放缓而不是冻住）。 */
    var REDUCED_MOTION_SLOWDOWN = 2.6;
    /** 相位相邻的两颗星，高度至少差这么多"槽"（1 槽 = 4% 轨道高）——防止并成一坨。 */
    var MIN_HEIGHT_SLOTS = 3;
    /** 能量段起点：第二档的刻度位置（4 档模型 → 1/3）。这一段以前是纯蓝，之后才渐入紫色。 */
    var ENERGY_START = 1 / 3;
    /** 颜色锚点：紫出现在这里（4 档模型 → high 档）。 */
    var ENERGY_END = 2 / 3;

    /* ── 落档（松手吸附 + 弹性回弹）────────────────────────────────────────
       松手时**先把档位写回**（时机与旧版一字不差），视觉上再从松手位置弹性
       吸附到目标刻度。缓动是纯函数（可离线断言），按帧推出去的是 createSnapAnimator。 */
    /** 落档动画时长（毫秒）：420ms ≈ 16ms 一帧约 26 帧，够看清"弹一下"又不拖沓。 */
    var SNAP_DURATION_MS = 420;
    /** 系统开了「减少动态效果」时的落档时长：更短，且**不回弹**（见 snapEaseFor）。 */
    var SNAP_DURATION_REDUCED_MS = 180;
    /** 回弹幅度（相对"松手点到目标刻度"的行程）：0.1 = 冲过目标约 10% 再弹回来。 */
    var SNAP_OVERSHOOT = 0.1;
    /** 拿不到 requestAnimationFrame 时的帧间隔回退（毫秒）。 */
    var SNAP_FRAME_MS = 16;

    /* ── 键盘 / 滚轮 ──────────────────────────────────────────────────────
       原则（用户要求，也是"Pro 的 Max 很贵"的直接防护）：**一次操作最多移动一档**、
       到端点就**钳住不环绕**、狂滚也不会一次跨过好几档。 */
    /** 滚轮一格 ≈ 多少像素（`deltaMode === 0` 时）；行模式按 3 行 = 1 格。 */
    var WHEEL_NOTCH_PX = 100;
    /** 滚轮累积器的上限（格）：一次手势最多攒 1 格，免得触控板连续小增量"机枪扫档"。 */
    var WHEEL_ACC_LIMIT = 1;
    /** 上下键切换的两个模型：按 id 里的关键词认（大小写不敏感）；认不出就什么都不做。 */
    var MODEL_TOGGLE_TOKENS = ["flash", "pro"];

    /* ── 珠子的"灵动"（材质之外的动感）────────────────────────────────────
       全部由**已有的每帧渲染路径**驱动：拖动时每一帧、落档动画时每一帧 —— 不新增动画器、
       不新增 rAF 循环。

       ⚠️ **速度的量级必须是"真实拖动"的量级**：速度单位是 **pct/秒**，而 1 pct = 整条轨道
       （可用宽 272px）—— 所以"正常拖一下"（约 400px/s）只有 **1.5 pct/秒**，快拖约 3.3、
       甩一下约 7。这里所有 `*_VELOCITY_SOFT` 都按这个量级标定（早先把 soft 写成 26/30，
       结果 400px/s 只换来 0.4px 的液面位移 —— 测试里用 ±40 pct/秒 是"超人甩动"，
       所以测试全绿而真机上完全看不出来）。测试里有一条**真实速度标定**断言守着这件事。 */
    /** 跟手拉伸的上限（相对半径）：速度拉满时横向 +12%、纵向 1/1.12（严格保体积）。 */
    var KNOB_STRETCH_MAX = 0.12;
    /** 速度 → 拉伸的软化尺度（pct/秒）：与水面同一标定（小心拖 0.6~1.2 就有明显拉伸）。 */
    var KNOB_VELOCITY_SOFT = 1.2;
    /** 落档"叮"的上限（相对半径）：过冲最大的那一刻珠子比平时大 6%。 */
    var KNOB_BOUNCE_MAX = 0.06;
    /** 镜面高光的**滞后**时间常数（毫秒）：高光跟着珠子走，但慢半拍 —— 光在液体里会晃。 */
    var KNOB_LAG_TAU_MS = 90;
    /** 速度归零的静默阈值（毫秒）：停手这么久就把拉伸收回去（一个 timer，不是循环）。 */
    var KNOB_MOTION_STALE_MS = 140;
    /** 「减少动态效果」下所有灵动幅度乘这个系数（放缓而不是冻住）。 */
    var KNOB_MOTION_REDUCED_SCALE = 0.5;
    /** 活动上限（pct/秒）：手再快也钳在这里，免得数值爆掉（7 pct/秒已是"甩一下"）。 */
    var KNOB_VELOCITY_LIMIT = 40;
    /** 活泼档开关（默认关）：静止时的呼吸微光。翻成 true 就是"活泼"（一行）。 */
    var KNOB_BREATH_ENABLED = false;

    /* ── 进度条的"水感"（液面贴着珠子的后缘走）──────────────────────────────
       液面偏移 `lead` 的单位 = **珠子半径**：`+FILL_LEAD_MAX` = 液面停在珠子的右缘
       （珠子整颗泡在水里 = "灌满"），`-FILL_LEAD_MAX` = 贴左缘，`0` = 圆心（静止时的现状）。
       取 1.0 = 液面正好贴到珠子的后缘（用户最初描述的"到了玻璃的最后侧"）；
       想更含蓄就把这个常量调到 0.6（"半腰"）。 */
    var FILL_LEAD_MAX = 1;
    /** 速度 → 液面偏移的软化尺度（pct/秒）——**按"小心瞄准档位"的真实速度标定**：
        1 pct = 整条轨道（272px），而人瞄准某一档时整条轨道要拖 800~1500ms，
        也就是 **0.6~1.2 pct/秒**（不是 400px/s 那种 1.5，更不是我之前误用的 26/30）。
        所以取 0.9：小心拖就已经到 60% 幅度，正常拖基本贴满。 */
    var FILL_VELOCITY_SOFT = 0.9;
    /** 液面追随速度的时间常数（毫秒）：让"先停在珠子后缘、再继续流过去"是连续发生的。
        取 70ms：慢拖时也能跟上（太大就等于把效果又乘一遍衰减 —— 上一版 110ms 就是这么丢掉的）。 */
    var FILL_LAG_TAU_MS = 70;
    /** 停手后"排水"的中位时长（毫秒）：实际每次不一样，见 sloshSpecFor。 */
    var FILL_DRAIN_MS = 320;
    /** 液面偏移小到这个量以下就当"回中"了（别为 1e-6 一直渲染）。 */
    var FILL_LEAD_EPSILON = 1e-3;

    /* ── 水的"水位基准"：静止时水面落在珠子**右缘** ─────────────────────────
       v1.0 起填充宽度是"到珠子圆心"，于是珠子右半颗永远坐在裸轨道上 ——
       用户原话："珠子右下角一直没水"。水位基准 = **1 个珠子半径**（右缘），
       珠子因此始终泡在水里；`lead`（±1 半径）在这个基准上前后摆动。 */
    var FILL_BASE_RADIUS = 1;

    /* ── 珠子的"活体半径"（x/y）：水层右端必须长成珠子**当下**的轮廓 ────────────
       按压（`--ces-press`）、落档回弹（`--ces-bounce`）、跟手拉伸（`--ces-stx/--ces-sty`）
       都写在 CSS 变量上（JS 每帧只写 x/y，按压是 CSS 按 `data-dragging` 给的）。
       珠子被压扁时（`scaleY = 按压 × 回弹 × sty < 1`）它的轮廓是**椭圆**，而水层右端原本是个
       28px 高的直角端面 —— 于是右上/右下两个角从珠子里露出来（用户截图："右上角和右下角水溢出来了"）。
       办法：把水层右端的圆角写成同一个椭圆（`border-radius: <rx> <ry>` 的椭圆语法），
       再把基准宽度也换成同一个 rx，水层的右尖端就与珠子右尖端重合。
       变量声明在 `.ces-inline` 根上，水层与珠子都能继承到。 */
    var KNOB_SCALE_X = "var(--ces-press,1) * var(--ces-bounce,1) * var(--ces-stx,1)";
    var KNOB_SCALE_Y = "var(--ces-press,1) * var(--ces-bounce,1) * var(--ces-sty,1)";
    var KNOB_RX = "calc(" + KNOB_RADIUS + "px * " + KNOB_SCALE_X + ")";
    var KNOB_RY = "calc(" + KNOB_RADIUS + "px * " + KNOB_SCALE_Y + ")";

    /* ── 水面倾斜（"高低落差"）+ 排水荡波 ────────────────────────────────────
       水面倾斜用**旋转**表达，不是用一个多边形去切水面 ——
       早先用 `clip-path: polygon()` 斜切，而多边形只能切直线，于是把填充**原本的圆头**切出两个尖角，
       看起来就是"水是畸形的"（用户原话），而且它只斜"右缘附近"，不是一条真正的水面线。
       现在：水层放进 `.ces-water`（水管形状的裁切层，`border-radius:999px` + `overflow:hidden`），
       里面再套一层**比轨道高**的 `.ces-water-inner`，对 inner 用 `rotate` 绕**左端**旋转 ——
       竖直的右缘于是被转成一条**横跨整条水位、且与管子成同一角度的斜线**（真正的水面），
       圆角由管子这一层提供，所以**不会有尖角**；水层比管子高，转 3.4° 也不会露出上下空隙。
       （注意：`skewY` 做不到这件事 —— 它把竖直线映射成竖直线，右缘还是垂直的。） */
    /** 水面的最大倾角（度）：轨道可用宽 272px 上约 16px 的高差 → atan(16/272) ≈ 3.4°。 */
    var SKEW_MAX_DEG = 3.4;
    /** 速度 → 倾斜的软化尺度（pct/秒）：与液面同一个量级（小心拖 0.6~1.2）。 */
    var SKEW_VELOCITY_SOFT = 0.9;
    /** 倾斜追随速度的时间常数（毫秒）：比液面稍慢一点，水面才有"甩"的感觉。 */
    var SKEW_LAG_TAU_MS = 90;
    /** 水层相对轨道上下各多出的高度（px）：要 ≥ 最大倾斜在右端抬起的量（≈16px）。 */
    var WATER_PAD_PX = 20;
    /** 排水荡波的参数区间：时长 / 波数 / 阻尼 / 水量（偏离静止位的倍数）。 */
    var SLOSH_DURATION_MIN = 300;
    var SLOSH_DURATION_MAX = 520;
    var SLOSH_WAVES_MIN = 1.1;
    var SLOSH_WAVES_MAX = 2.1;
    var SLOSH_DAMPING_MIN = 2.2;
    var SLOSH_DAMPING_MAX = 3.6;
    var SLOSH_AMPLITUDE_MIN = 1;
    var SLOSH_AMPLITUDE_MAX = 1.4;

    /** 蓝 → 紫 → 深紫（"第一档到第二档为蓝色，再往右逐渐变紫变深"）。 */
    var COLOR_BLUE = [77, 147, 248];
    var COLOR_VIOLET = [147, 51, 234];
    var COLOR_DEEP = [76, 29, 149];
    /**
     * 数值文字（"Max"）用的亮紫终点。
     * 文字不能像填充那样收到深紫（`COLOR_DEEP` 在深色底上几乎看不见），所以另给一个亮端；
     * 但也不能太亮 —— 实测 `#c084fc` 在**浅色主题**下对比度只有 2.6:1（发虚），
     * 所以取中档紫罗兰 `#8b5cf6`：对白底 ≈4.2:1、对深色底（#1b1c20）≈4.0:1，两种主题都读得清。
     */
    var COLOR_TEXT_VIOLET = [139, 92, 246];

    /* ════════════════════════════ 样式 ════════════════════════════ */

    /*
     * 颜色一律走 DSH 自己的设计令牌（`--dsw-*`），浅色/深色自动跟随。
     * 蓝色强调色用 `--dsw-alias-state-business-primary`（深色下 = deepseek-400 #7aaaff），
     * 回退到 blue-450 #4d93f8 —— 也就是参考图里那条轨道的蓝。
     */
    var CSS = [
      /* 注入进官方那一行的容器：折行到第二行并铺满整行 */
      ".ces-inline{--ces-accent:var(--dsw-alias-state-business-primary,var(--dsw-static-blue-450,#4d93f8));box-sizing:border-box;flex-basis:100%;width:100%;min-width:0}",
      ".ces-track{position:relative;box-sizing:border-box;height:" + TRACK_HEIGHT + "px;margin-top:2px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(15,17,21,.08));cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}",
      ".ces-track:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--ces-accent));outline-offset:2px}",
      /* 水层本身：端面是**平的**（水的端面本来就该是平的/微凹的，圆头是"进度条"的语汇）。
         圆角由下面的 `.ces-water` 这一层提供。 */
      ".ces-fill{position:absolute;inset:0;pointer-events:none}",
      /* ── 水面倾斜（"高低落差"）+ 水面形状：水层放进"水管形状"的裁切层里，然后整体**绕左端旋转** ──
         `.ces-water` 这一层**就是水本身**：它的宽度 = 水的宽度（右缘即水面），所以它同时负责两件事 ——
         ① 左端圆角 = 管口（`KNOB_RADIUS`，与轨道的圆角一致，水不会从管口方角里冒出去）；
         ② 右端圆角 = **珠子当下的椭圆**（`KNOB_RX`/`KNOB_RY`：按压 × 回弹 × 跟手拉伸）——
            珠子压扁时水也跟着变扁，右上/右下角不会再露出来。它**不旋转**，所以这个椭圆始终与珠子同向。
         `.ces-water-inner` 比轨道上下各高 `WATER_PAD_PX`，绕**左端**转 `--ces-skew`（度）——
         竖直的右缘于是变成一条**横跨整条水位、与管子同一角度的斜线**（真正的水面），
         而它比轨道高，所以转到最大角也不会露出上下空隙；水面的斜线再被 `.ces-water` 的椭圆端面收口。
         珠子是 `.ces-water` 的**兄弟节点**，所以材质与投影完全不受裁切影响。
         注：`skewY` 做不到这件事（竖直线还是竖直线），必须用 `rotate`。 */
      ".ces-water{position:absolute;left:0;top:0;bottom:0;border-top-left-radius:" +
        KNOB_RADIUS +
        "px;border-bottom-left-radius:" +
        KNOB_RADIUS +
        "px;border-top-right-radius:" +
        KNOB_RX +
        " " +
        KNOB_RY +
        ";border-bottom-right-radius:" +
        KNOB_RX +
        " " +
        KNOB_RY +
        ";overflow:hidden;pointer-events:none}",
      ".ces-water-inner{position:absolute;left:0;right:0;top:" + (-WATER_PAD_PX) + "px;bottom:" + (-WATER_PAD_PX) + "px;transform:rotate(var(--ces-skew,0deg));transform-origin:0 50%}",
      /* 星尘层固定在轨道的垂直范围内（它是按 top:% 排布的，层高了会被裁掉一大半）。
         它跟着水一起转 —— 星尘本来就是水里的东西。 */
      ".ces-water-inner > .ces-stars{top:" + WATER_PAD_PX + "px;height:" + TRACK_HEIGHT + "px}",
      /* 水面高光：一条贴着水层**旋转后**右缘的亮边（水层转了，它自己也就是斜的）——
         它是"这里是一层水面"最直接的视觉提示，且不需要任何额外元素。 */
      ".ces-fill{box-shadow:inset -1.5px 0 0 rgba(255,255,255,.4)}",
      "body[data-ds-dark-theme] .ces-fill{box-shadow:inset -1.5px 0 0 rgba(255,255,255,.3)}",
      ".ces-tick{position:absolute;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 26%,transparent);pointer-events:none}",
      ".ces-tick[data-on='1']{background:rgba(255,255,255,.5)}",
      /* 旋钮直径 = 轨道高度（"与滑条同宽"）：圆完整地填满管口，不会出现被裁出的平边。
         ── 质感：**液态玻璃（iOS 26 式 Liquid Glass）**，不是毛玻璃 ──────────────
         区别在"糊"与"亮"：毛玻璃靠 `backdrop-filter` 把背后糊掉；液态玻璃**不糊背景** ——
         透过去看后面的填充/星尘/轨道是**清晰**的，玻璃感全部来自"光在曲面上"：

           · 珠体：**近透明**（白只 .03~.16），只给一点点"玻璃的体"，背景原样透出；
           · `::after` 高光层：一片大柔光（曲面反光的主形）+ 一枚**小亮斑**（那一滴镜面光），
             位置走 `--ces-hl`（随档位反向滑 = 滚珠感）；
           · `::before` 内反射层：底部那道**透射光弧**，强度随 `--ces-energy` 走；
           · 边缘（浅色轨道上形状全靠它）：内侧 1px 亮边（≈.8，模拟弧面边缘的折射亮边）
             + 外侧 .5px 极细暗发丝 + 顶部内高光 + 底部内暗影（给"厚度"）；
           · 投影两层（软），高档位再加一道紫辉；
           · **没有** backdrop-filter / saturate —— 既不糊背景，也省掉每帧重采样背景的开销。
         注意：`width/height/margin/border-radius` 的形状不能动 —— 断言按这个形状钉死。 */
      ".ces-knob{position:absolute;top:50%;width:" + KNOB_SIZE + "px;height:" + KNOB_SIZE + "px;margin:" + (-KNOB_RADIUS) + "px 0 0 " + (-KNOB_RADIUS) + "px;border-radius:50%;overflow:hidden;background:linear-gradient(158deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.06) 38%,rgba(236,241,252,.03) 66%,rgba(255,255,255,.1) 100%);box-shadow:0 1px 6px rgba(0,0,0,.28),0 2px 12px -2px rgba(0,0,0,.18),0 0 0 .5px rgba(15,23,42,.28),inset 0 1px 1px rgba(255,255,255,.95),inset 0 -1.5px 2px rgba(15,23,42,.12),inset 0 -2.5px 3px -1px rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.8),0 0 calc(var(--ces-energy,0) * 12px) rgba(168,85,247,.4);pointer-events:none}",
      /* 高光层（液态玻璃的灵魂）：一片**大柔光**铺在左上（曲面反光的主形）+ 一枚**很小的亮斑**
         （真正的镜面反射点，"那一滴光"）。两层都在同一个 background 里叠着，位置共用 `--ces-hl`。 */
      ".ces-knob::after{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(13% 10% at var(--ces-hl,30%) 19%,rgba(255,255,255,.98) 0%,rgba(255,255,255,0) 100%),radial-gradient(72% 60% at calc(var(--ces-hl,30%) + 4%) 26%,rgba(255,255,255,.72) 0%,rgba(255,255,255,.34) 46%,rgba(255,255,255,0) 80%);pointer-events:none}",
      /* 第二道光：底部那道**透射光弧**（光穿过玻璃在下方汇聚），强度随能量走 ——
         高档位（紫）时它会亮一点，珠子因此"有厚度"而不是一片空。 */
      ".ces-knob::before{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(82% 48% at 50% 118%,rgba(255,255,255,calc(.22 + var(--ces-energy,0) * .4)) 0%,rgba(255,255,255,0) 64%);pointer-events:none}",
      /* 深色主题：背景是暗的，玻璃靠"亮边"存在而不是靠白体 ——
         珠体再透一点、内侧亮边收一点、并给边缘一圈极淡的冷紫辉（暗底上的玻璃边）。 */
      "body[data-ds-dark-theme] .ces-knob{background:linear-gradient(158deg,rgba(255,255,255,.1) 0%,rgba(255,255,255,.04) 40%,rgba(226,232,246,.02) 68%,rgba(255,255,255,.07) 100%);box-shadow:0 1px 6px rgba(0,0,0,.42),0 2px 12px -2px rgba(0,0,0,.3),0 0 0 .5px rgba(255,255,255,.14),inset 0 1px 1px rgba(255,255,255,.8),inset 0 -1.5px 2px rgba(0,0,0,.28),inset 0 -2.5px 3px -1px rgba(255,255,255,.4),inset 0 0 0 1px rgba(255,255,255,.55),0 0 7px rgba(216,180,254,.22),0 0 calc(var(--ces-energy,0) * 12px) rgba(168,85,247,.45)}",
      /* ── 珠子的"灵动"：把当帧的几个数拼成一个 transform ──────────────────────
         press（按压，CSS 按 data-dragging 给）× bounce（落档"叮"，JS 给）×
         stx/sty（跟手拉伸，JS 给，横向拉长纵向压扁，近似保体积）。
         全部只动 transform ⇒ 合成器友好；静止时这几个变量都是 1，珠子就是完美的圆。 */
      ".ces-knob{transform:scale(calc(var(--ces-press,1) * var(--ces-bounce,1))) scaleX(var(--ces-stx,1)) scaleY(var(--ces-sty,1));transform-origin:50% 50%}",
      ".ces-inline[data-dragging='1']{--ces-press:.95}",
      ".ces-inline[data-motion='reduced'][data-dragging='1']{--ces-press:.975}",
      /* 活泼档（`data-breath='1'` 时才开）：静止时高光极慢地"呼吸"一下（4.2s、±1.2%）。
         默认关（KNOB_BREATH_ENABLED=false）—— 菜单里有个东西一直在动会分心；
         「减少动态效果」下无论开关都停。 */
      "@keyframes ces-knob-breathe{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(1.2%,-0.8%,0) scale(1.03)}}",
      ".ces-inline[data-breath='1'] .ces-knob::after{animation:ces-knob-breathe 4.2s ease-in-out infinite}",
      ".ces-inline[data-motion='reduced'] .ces-knob::after{animation:none}",
      ".ces-error{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#e5484d)}",
      /* ── 最高档能量层（纯视觉：紫色星云 + 星尘粒子 + 扫光）─────────────────
         强度由 `--ces-energy`(0..1) 一个变量驱动：外层只做 opacity/box-shadow，
         所以"渐入"是浏览器合成的颜色插值，不需要 JS 逐帧改样式。
         关掉时把粒子动画 `animation-play-state: paused`，不让 22 个隐形元素白烧 GPU。 */
      ".ces-inline[data-energy='1'] .ces-track{box-shadow:0 0 calc(var(--ces-energy,0) * 16px) rgba(168,85,247,.5)}",
      ".ces-inline[data-energy='0'] .ces-star,.ces-inline[data-energy='0'] .ces-energy__sweep{animation-play-state:paused}",
      /* 能量层只覆盖**已填充那一段**（宽度与填充相同）：档位右边没到的部分不显示能量条。
         左端从 0 起、宽度由内联样式给（= 到旋钮圆心），所以它跟着旋钮一起长。 */
      ".ces-energy{position:absolute;top:0;bottom:0;left:0;right:0;overflow:hidden;pointer-events:none;opacity:var(--ces-energy,0);transition:opacity .2s ease;background:linear-gradient(90deg,#3b1178 0%,#6d28d9 30%,#9333ea 62%,#c084fc 100%)}",
      /* 星星单独一层：**不跟着星云淡入**（否则 high 档会被星云的 0.5 透明度压得看不见）。
         几何与星云层相同（贴着已填充段、圆角裁切），透明度由内联样式给。 */
      ".ces-stars{position:absolute;top:0;bottom:0;left:0;right:0;overflow:hidden;pointer-events:none;transition:opacity .2s ease}",
      /* 拖动中把能量/星星的 0.2s opacity 过渡关掉：跟手要"脆"，不能拖一条尾巴。
         松手落档时保留过渡 —— 能量渐入更顺，也盖住回弹那一小段。 */
      ".ces-inline[data-dragging='1'] .ces-energy,.ces-inline[data-dragging='1'] .ces-stars{transition:none}",
      /* 星空（**所有出现粒子的档位都用这一套**）：外层是**整轨宽度**的轨道
         （它自己在做 -100% 的连续横穿），内层圆点的亮度/大小由 --ces-b 决定（越亮越大）。
         残影只在两端淡出，而那两端在可视区外，所以看起来粒子"从不消失"。

         ⚠️ 时长与相位**直接内联**写在元素上（见组件的 animationDuration / animationDelay），
         不走 CSS 变量：实测把 `animation-delay:var(--ces-delay)` 写在样式表里时，
         真宿主里负相位不生效 —— 结果是"一打开所有星星挤在起点，十几秒后才靠速度差散开"。
         `--ces-b`（亮度/大小）只是不参与动画计时的普通变量，留着没问题。 */
      ".ces-star{position:absolute;left:0;right:0;height:3px;margin-top:-1.5px;pointer-events:none;animation-name:ces-star-sweep;animation-timing-function:linear;animation-iteration-count:infinite}",
      ".ces-star__dot{position:absolute;left:100%;top:0;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,.85);opacity:var(--ces-b,1);transform:scale(var(--ces-b,1))}",
      "@keyframes ces-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}",
      ".ces-energy__sweep{position:absolute;inset:0;background:linear-gradient(100deg,transparent 18%,rgba(255,255,255,.30) 50%,transparent 82%);transform:translateX(100%);animation:ces-sweep 2.4s linear infinite}",
      "@keyframes ces-sweep{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}",
      "body[data-ds-dark-theme] .ces-star__dot{background:#f5f3ff;box-shadow:0 0 5px rgba(216,180,254,.95)}",
      /* 系统要求「减少动态效果」时**放缓**而不是冻住：收起扫光。
         星星的放缓在 JS 里算（时长 × REDUCED_MOTION_SLOWDOWN）—— 不走 CSS 媒体查询，
         因为时长现在是内联的，也免得再引入"变量参与动画计时"这类坑。 */
      "@media (prefers-reduced-motion: reduce){.ces-energy{transition:none}.ces-energy__sweep{display:none}}",
    ].join("\n");

    /** 把样式挂进文档。加载器会把它认领为「本插件产出的 style」（HMR 卸载时一并清理）。 */
    function installStyles() {
      try {
        if (typeof document === "undefined" || !document.head) return null;
        var existing = document.querySelector('style[data-plugin-css="' + STYLE_MARKER + '"]');
        if (existing) return existing;
        var style = document.createElement("style");
        style.setAttribute("data-plugin-css", STYLE_MARKER);
        style.textContent = CSS;
        document.head.appendChild(style);
        return style;
      } catch (error) {
        /* 样式失败只影响观感，绝不影响功能 */
        return null;
      }
    }

    /* ════════════════════════ 纯函数（可离线单测）════════════════════════ */

    var EMPTY_SNAPSHOT = Object.freeze({
      current: null,
      groups: [],
      failures: [],
      status: "idle",
      pending: null,
      error: null,
      retainedEffort: undefined,
    });

    /** 在目录快照里找到当前模型条目（groups[].models[]）。 */
    function modelOf(state) {
      var current = state && state.current;
      if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
      var groups = state && Array.isArray(state.groups) ? state.groups : [];
      for (var i = 0; i < groups.length; i += 1) {
        var group = groups[i];
        if (!group || group.id !== current.provider) continue;
        var models = Array.isArray(group.models) ? group.models : [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j] && models[j].id === current.model) return models[j];
        }
      }
      return null;
    }

    /** 当前模型真实可用的档位列表（官方 id + 官方显示名，按目录顺序）。 */
    function levelsOf(state) {
      var model = modelOf(state);
      var efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
      var out = [];
      for (var i = 0; i < efforts.length; i += 1) {
        var effort = efforts[i];
        if (!effort || typeof effort.id !== "string" || effort.id.length === 0) continue;
        out.push({
          id: effort.id,
          name: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id,
        });
      }
      return out;
    }

    /**
     * 当前**生效**的档位 id：显式设置优先；没设置过就是模型的默认档
     * （与官方 `syncInputs()` 的 `effort = intended.reasoningEffort ?? reasoning.defaultEffort` 同款）。
     */
    function effectiveEffortId(state) {
      var current = state && state.current;
      if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) {
        return current.reasoningEffort;
      }
      var model = modelOf(state);
      var fallback = model && model.reasoning && model.reasoning.defaultEffort;
      return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
    }

    function indexOfLevel(levels, id) {
      if (typeof id !== "string") return -1;
      for (var i = 0; i < levels.length; i += 1) if (levels[i].id === id) return i;
      return -1;
    }

    /**
     * `↑` / `↓` 要切换到的模型：只在 id 含 "flash" / "pro" 的那两个模型之间来回。
     *
     * 返回 `{ provider, model }` —— 与**官方模型行**同一个 select 契约（`choose()` → `submit()`），
     * 所以调用方**不带** `reasoningEffort`，档位原样保留（官方语义）。
     * 认不出（目录里没有这类模型 / 当前模型不在其中且一个都没找到）就返回 null：**什么都不做**。
     */
    function toggleModelFor(state) {
      var current = state && state.current;
      if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
      var groups = state && Array.isArray(state.groups) ? state.groups : [];
      var models = null;
      for (var i = 0; i < groups.length; i += 1) {
        if (groups[i] && groups[i].id === current.provider) {
          models = Array.isArray(groups[i].models) ? groups[i].models : [];
          break;
        }
      }
      if (models === null) return null;

      var found = {};
      for (var j = 0; j < models.length; j += 1) {
        var candidate = models[j];
        if (!candidate || typeof candidate.id !== "string") continue;
        var flat = candidate.id.toLowerCase();
        for (var k = 0; k < MODEL_TOGGLE_TOKENS.length; k += 1) {
          var token = MODEL_TOGGLE_TOKENS[k];
          if (flat.indexOf(token) >= 0 && found[token] === undefined) found[token] = candidate.id;
        }
      }
      var flash = found.flash;
      var pro = found.pro;
      if (flash === undefined && pro === undefined) return null;

      var here = current.model.toLowerCase();
      var target;
      if (here.indexOf("flash") >= 0) target = pro;
      else if (here.indexOf("pro") >= 0) target = flash;
      // 当前是别的模型（既不是 flash 也不是 pro）→ 优先落到 Flash，没有就落到 Pro
      else target = flash !== undefined ? flash : pro;

      if (target === undefined || target === null || target === current.model) return null;
      return { provider: current.provider, model: target };
    }

    /**
     * 滚轮事件 → **格数**（正 = 向下 = 降档，负 = 向上 = 升档）。
     *
     * 三种 `deltaMode` 都要归一化，否则触控板与鼠标的"一格"差别巨大：
     *   · `0`（像素，Windows 鼠标一格 ≈ 100px）→ `deltaY / WHEEL_NOTCH_PX`
     *   · `1`（行，一格 = 3 行）→ `deltaY / 3`
     *   · `2`（页，极罕见）→ 一个事件算一格
     * 返回小数由调用方累积（`WHEEL_ACC_LIMIT` 钳住），**每次事件最多走一步**。
     */
    function wheelNotchesFor(event) {
      if (!event || typeof event.deltaY !== "number" || event.deltaY === 0) return 0;
      var mode = typeof event.deltaMode === "number" ? event.deltaMode : 0;
      if (mode === 2) return event.deltaY > 0 ? 1 : -1;
      var unit = mode === 1 ? 3 : WHEEL_NOTCH_PX;
      return event.deltaY / unit;
    }

    function clamp01(value) {
      if (!(value > 0)) return 0; // 同时挡住 NaN
      return value > 1 ? 1 : value;
    }

    /** 百分比 → 最近档位下标（滑条连续，档位离散，所以必须吸附）。 */
    function indexFromPct(pct, count) {
      if (count <= 1) return 0;
      return Math.max(0, Math.min(count - 1, Math.round(clamp01(pct) * (count - 1))));
    }

    /** 档位下标 → 该档位在轨道上的百分比（刻度点与旋钮永远对齐）。 */
    function pctFromIndex(index, count) {
      if (count <= 1) return 0;
      var safe = Math.max(0, Math.min(count - 1, index));
      return safe / (count - 1);
    }

    function errorText(error) {
      if (error === null || error === undefined) return "档位切换失败";
      if (typeof error === "string") return error;
      if (typeof error.message === "string" && error.message.length > 0) return error.message;
      if (typeof error.code === "string" && error.code.length > 0) return error.code;
      return String(error);
    }

    /* ─────────────────── 最高档能量层：参数与强度曲线 ─────────────────── */

    /**
     * 星尘粒子（星星）：**全部由下标算出，不用随机数** —— 每次渲染完全一致、可离线断言。
     *
     * 形态 = 3px 圆点；运动 = 横穿整条轨道（右 → 左），**不消失**、没有上下飘动。
     *
     * 高度与相位**必须用两条互不相关的分配**：
     *   · 相位 = 黄金比低差异序列（任意前缀都铺得开，拖动时逐渐加星也不会挤）；
     *   · 高度 = **随机排列**的等距槽位（哈希排序，确定性），并与相位排名解耦。
     * 早期版本这两者取自同一个数 `frac((i+1)×φ)`，结果"越靠右的星越高"，22 颗排成
     * 一条斜线（用户实测反馈"太规整，再随机一点"；相关系数实测 0.999）。
     * 再挑一个满足最小间隔的盐值：**相位相邻**（会在轨道上一直并排走）的两颗
     * 高度至少差 `MIN_HEIGHT_SLOTS` 槽，避免并成一坨。
     */
    var PARTICLES = (function buildParticles() {
      var count = 22;
      var out = [];
      var i;
      for (i = 0; i < count; i += 1) {
        out.push({ y: 0, phase: (i + 1) * GOLDEN_RATIO % 1 });
      }
      // 相位排名：黄金比序列里排名相邻 = 在轨道上位置相邻
      var byPhase = [];
      for (i = 0; i < count; i += 1) byPhase.push(i);
      byPhase.sort(function (a, b) {
        return out[a].phase - out[b].phase;
      });
      // 高度槽：找一个满足"相位相邻至少差 MIN_HEIGHT_SLOTS 槽"的确定性随机排列
      var slots = null;
      for (var salt = 71; salt < 4000 && slots === null; salt += 1) {
        var candidate = [];
        for (i = 0; i < count; i += 1) candidate.push(i);
        candidate.sort(function (a, b) {
          var ha = starHash01(a, salt);
          var hb = starHash01(b, salt);
          return ha === hb ? a - b : ha - hb;
        });
        var ok = true;
        for (var k = 1; k < count && ok; k += 1) {
          if (Math.abs(candidate[k] - candidate[k - 1]) < MIN_HEIGHT_SLOTS) ok = false;
        }
        if (ok) slots = candidate;
      }
      if (slots === null) {
        // 兜底：步长 5 与 22 互质 → 一定是排列，且相邻槽恒差 5（≥ MIN_HEIGHT_SLOTS）
        slots = [];
        for (i = 0; i < count; i += 1) slots.push(i * 5 % count);
      }
      for (var rank = 0; rank < count; rank += 1) {
        out[byPhase[rank]].y = 8 + (slots[rank] / (count - 1)) * 84;
      }
      return out;
    })();

    /* 颜色常量与 ENERGY_* 都声明在文件上部的「尺寸与速率常量」块里（供 CSS 插值用），
       这里只放纯函数 —— 不要再重复声明，否则会出现"改一处漏一处"的双份真相。 */

    function mixColor(from, to, t) {
      var k = clamp01(t);
      return [
        Math.round(from[0] + (to[0] - from[0]) * k),
        Math.round(from[1] + (to[1] - from[1]) * k),
        Math.round(from[2] + (to[2] - from[2]) * k),
      ];
    }

    function rgbOf(color) {
      return "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
    }

    /** 位置 → 填充色（当前点的颜色，也就是渐变右端的颜色）。 */
    function fillColorFor(pct) {
      var t = clamp01(pct);
      if (t <= ENERGY_START) return rgbOf(COLOR_BLUE);
      if (t <= ENERGY_END) return rgbOf(mixColor(COLOR_BLUE, COLOR_VIOLET, (t - ENERGY_START) / (ENERGY_END - ENERGY_START)));
      return rgbOf(mixColor(COLOR_VIOLET, COLOR_DEEP, (t - ENERGY_END) / (1 - ENERGY_END)));
    }

    /**
     * 位置 → 填充层的背景：**左端恒为蓝，右端（旋钮处）是当前位置的颜色**。
     * 于是 high 档自然呈现"左蓝右紫"的渐变，越往右右端越深。
     */
    function fillBackgroundFor(pct) {
      return "linear-gradient(90deg, " + rgbOf(COLOR_BLUE) + ", " + fillColorFor(pct) + ")";
    }

    /**
     * 位置 → **官方那一行数值文字**（"Max"）的颜色。
     *
     * 与能量同源：蓝 → 紫罗兰，越往右越紫（用户要求"Max 的字体颜色能不能改变"）。
     * 刻意**不跟填充末尾的深紫走** —— `COLOR_DEEP` 当文字在深色底上几乎看不见；
     * 文字需要一个亮端，所以终点用 `COLOR_TEXT_VIOLET`。
     *
     * **Off 档返回空串**：不写内联色 = 官方原本的灰（用户要求"off 档两个界面都是灰的"）。
     * 调用方直接 `style.color = valueColorFor(...)`，空串在浏览器里就是"清掉内联色"。
     */
    function valueColorFor(pct, level) {
      if (isOffLevel(level)) return "";
      return rgbOf(mixColor(COLOR_BLUE, COLOR_TEXT_VIOLET, energyFor(pct)));
    }

    /**
     * 是不是"关闭推理"那一档。
     *
     * DeepSeek 的档位表是 id `off` / name `Off`（见 `dsh-llm-deepseek/lib/index.js` 的
     * `REASONING_EFFORTS`），但 id 是 provider 自己的字符串，所以 id 和 name 都认一遍，
     * 并额外接受几个同义写法。认不出就是普通档位（照常着色）。
     */
    function isOffLevel(level) {
      if (!level) return false;
      var candidates = [level.id, level.name];
      for (var i = 0; i < candidates.length; i += 1) {
        if (typeof candidates[i] !== "string") continue;
        var flat = candidates[i].replace(/\s+/g, "").toLowerCase();
        if (flat === "off" || flat === "none" || flat === "关闭" || flat === "无") return true;
      }
      return false;
    }

    /**
     * 位置 → 能量强度 0..1（紫色星云 + 粒子的总强度）。
     * **纯位置驱动，与档位数无关**：第二档以前为 0（保持干净的蓝），之后线性渐入到最高档的 1。
     * 锚点：pct=1/3 → 0；pct=2/3（4 档模型的 high）→ 0.5；pct=1（max）→ 1。
     */
    function energyFor(pct) {
      return clamp01((clamp01(pct) - ENERGY_START) / (1 - ENERGY_START));
    }

    /**
     * 位置 → 粒子速率倍数。
     * 锚点来自实测反馈：**high 档（4 档模型的 2/3 处）= 1×（也就是现在这个速度刚刚好）**，
     * 最高档 = 2×。再往左按同一斜率降速，但设 0.35× 下限，免得左端变成静止。
     */
    function speedFor(pct) {
      return Math.min(2, Math.max(0.35, 3 * clamp01(pct) - 1));
    }

    /** 位置 → 可见粒子数（"粒子效果逐渐出现、变密集"）。 */
    function particleCountFor(pct) {
      return Math.round(energyFor(pct) * PARTICLES.length);
    }

    /* ── 星空：所有出现粒子的档位都用这一套（统一的动画）────────────────────

       运动模型：外层是一条**整轨宽度**的轨道，自己在做 `translate3d(-100%)` 的连续横穿；
       圆点在最右端出生、向左穿出，残影只在两端淡出（而那两端在可视区外）→ **从不消失**。
       每颗的亮度/大小由确定性伪随机给出（越亮越大，0.5~1），速率随**位置**变化（速度变化保留）。 */

    /** 确定性伪随机 [0,1)：不用 Math.random（可离线断言、重渲染不跳变），但看起来是随机的。 */
    function starHash01(index, salt) {
      var value = (index + 1) * salt * 2654435761 % 4294967296;
      return ((value >>> 8) % 1000) / 1000;
    }

    /** 第 index 颗粒子的亮度/大小系数，落在 [STARFIELD_MIN, 1]（越亮越大）。 */
    function starBrightnessFor(index) {
      return STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(index, 61);
    }

    /**
     * 第 index 颗粒子横穿整条轨道的时长（s）。
     * **保留速度随位置变化**：以 speedFor 上限（MAX 档）对齐基准时长 ——
     * MAX 档 1.5s、high 档（1×）3s、左端（0.35×）约 8.6s；各星之间只差 ±8%（防追尾成团）。
     */
    function starDurationFor(index, speedFactor) {
      var speed = Math.min(MAX_SPEED_FACTOR, Math.max(0.35, typeof speedFactor === "number" ? speedFactor : MAX_SPEED_FACTOR));
      var spread = 1 - STARFIELD_DURATION_SPREAD + 2 * STARFIELD_DURATION_SPREAD * starHash01(index, 29);
      return STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR / speed * spread;
    }

    /**
     * 第 index 颗粒子的相位（负延迟，单位 s）。
     *
     * 相位用**黄金比低差异序列**铺开，而且**只跟 index 有关、跟当前显示几颗无关** ——
     * 这一点很关键：如果按 `i / 当前数量` 算，拖动过程中粒子数变化会让每颗已挂载动画的
     * `animation-delay` 被改写，按规范当前进度会按新起始时间重算，整片星空就会抖一下/重排一次。
     * 低差异序列还有个好处：**任意前缀**（前 N 颗）本身就是均匀铺开的。
     */
    function starDelayFor(index, duration) {
      var particle = PARTICLES[index];
      var phase = particle && typeof particle.phase === "number" ? particle.phase : 0;
      var jitter = starHash01(index, 53) * 0.03; // 一点点抖动，避免看起来像整齐的队列
      return -((phase + jitter) % 1) * duration;
    }

    /** 位置 → 可见星星数（"逐渐出现、变密集"）。 */
    function starCountFor(pct) {
      return particleCountFor(pct);
    }

    /**
     * 位置 → **星星层**的不透明度。
     *
     * 星星不能跟着星云一起淡入：星云层的透明度 = 能量强度，high 档只有 0.5，
     * 那么每颗星的实际不透明度会被压到 0.25~0.5，在紫色底上几乎看不见
     * （用户实测反馈："high 档一打开几乎没粒子"）。所以星星层单独给一个下限，
     * 只随能量轻微变化：high 档 0.8、MAX 档 1.0 —— "逐渐出现"交给**粒子数**去表达。
     */
    function starLayerOpacityFor(pct) {
      return 0.6 + 0.4 * energyFor(pct);
    }

    /**
     * 旋钮中心 / 填充终点 / 刻度的水平位置：`半径 + pct × (100% − 直径)`。
     * 这样 pct=0 时圆心正好落在左端圆角内、pct=1 时落在右端圆角内 —— 圆圈永远是完整的圆。
     */
    function knobOffsetOf(pct) {
      var t = Math.round(clamp01(pct) * 10000) / 10000;
      return "calc(" + KNOB_RADIUS + "px + " + t + " * (100% - " + KNOB_RADIUS * 2 + "px))";
    }

    /**
     * 旋钮镜面高光的水平位置（%）：随档位**反向**轻微滑动（0 档 36% → 最高档 24%）。
     * 珠子往右走、高光往左挪，看起来像一颗**在滚动**的玻璃珠 —— 这就是"液态"的那点动感。
     * 幅度刻意压到 ±6%：真实光源是固定的，动太多就假了。
     */
    function knobHighlightFor(pct) {
      return (30 - 12 * (clamp01(pct) - 0.5)).toFixed(1) + "%";
    }

    /* ────────────── 珠子的灵动：速度 / 拉伸 / 落档"叮" / 高光滞后 ──────────────
       四个纯函数，全部只吃数字、只吐数字（或一个 {x,y}），所以能离线逐条断言；
       组件每帧把它们的结果写进 `--ces-*`，CSS 只负责把变量拼成一个 transform。 */

    /**
     * 瞬时速度（**pct/秒**，正 = 往高档走）。`dtMs <= 0`、非有限数一律返回 0
     * （第一帧、时间戳相同、定时器抖动都走这条路），并钳在 ±`KNOB_VELOCITY_LIMIT`。
     */
    function velocityFor(prevPct, pct, dtMs) {
      if (!isFinite(prevPct) || !isFinite(pct) || !isFinite(dtMs) || !(dtMs > 0)) return 0;
      var v = (pct - prevPct) / (dtMs / 1000);
      if (!isFinite(v)) return 0;
      return Math.max(-KNOB_VELOCITY_LIMIT, Math.min(KNOB_VELOCITY_LIMIT, v));
    }

    /**
     * 速度 → 跟手拉伸：`e = MAX × (1 − e^(−|v|/SOFT))`（饱和函数，永远不会超过上限），
     * 横向 `1 + e`、纵向 `1 − 0.55e`（近似保体积，像一滴被拉动的液体）。
     * `reduced` 时整体乘 `KNOB_MOTION_REDUCED_SCALE`（放缓而不是冻住）。
     */
    function knobStretchFor(velocity, reduced) {
      var v = isFinite(velocity) ? Math.abs(velocity) : 0;
      var e = KNOB_STRETCH_MAX * (1 - Math.exp(-v / KNOB_VELOCITY_SOFT));
      if (reduced === true) e *= KNOB_MOTION_REDUCED_SCALE;
      // 纵向取 1/(1+e)：横×纵恒等于 1 —— 真的"保体积"（拉长多少就压扁多少），断言也好写
      return { x: 1 + e, y: 1 / (1 + e) };
    }

    /**
     * 落档"叮"：`shownPct` 冲过目标刻度多少，珠子就放大多少（峰值 = 1 + `KNOB_BOUNCE_MAX`）。
     * 因为吃的是**落档动画本身的过冲**，所以"叮"和弹性回弹天然同步 —— 不需要第二个计时器。
     * 没冲过（含静止、`travel` 为 0）就是 1。
     */
    function knobBounceFor(shownPct, targetPct, travel, reduced) {
      if (!isFinite(shownPct) || !isFinite(targetPct) || !(travel > 0)) return 1;
      var over = (shownPct - targetPct) / travel; // 过冲比例（0 .. ~SNAP_OVERSHOOT）
      if (!(over > 0)) return 1;
      var k = Math.min(1, over / SNAP_OVERSHOOT);
      if (reduced === true) k *= KNOB_MOTION_REDUCED_SCALE;
      return 1 + KNOB_BOUNCE_MAX * k;
    }

    /**
     * 通用**指数逼近**：把 `prev` 朝 `target` 推进 `dtMs` 毫秒（时间常数 `tauMs`）。
     * `prev` 为 null/undefined/非有限时**直接跟上** target（注意 `isFinite(null) === true` 这个坑）；
     * 足够近就当成到了，免得永远差一点点（静止时不该还在微动）。
     */
    function approachFor(prev, target, dtMs, tauMs) {
      if (!isFinite(target)) return isFinite(prev) ? prev : 0;
      if (prev === null || prev === undefined || !isFinite(prev)) return target;
      if (!isFinite(dtMs) || !(dtMs > 0) || !(tauMs > 0)) return prev;
      var k = 1 - Math.exp(-dtMs / tauMs);
      var next = prev + (target - prev) * clamp01(k);
      return Math.abs(target - next) < 1e-4 ? target : next;
    }

    /**
     * 镜面高光用的**滞后位置**：指数逼近（时间常数 `KNOB_LAG_TAU_MS`）。
     * 高光跟着珠子走但慢半拍 → 光在水里晃的感觉；静止时收敛到珠子本身，所以不会漂。
     */
    function knobLagPctFor(prevLag, target, dtMs) {
      return approachFor(prevLag, target, dtMs, KNOB_LAG_TAU_MS);
    }

    /**
     * 速度 → **液面偏移目标**（单位 = 珠子半径，范围 ±`FILL_LEAD_MAX`）。
     *
     * 方向是**反向**的，这正是"水留在珠子后面"的来源：
     *   · 向右拖（v > 0）→ 目标是负的：液面贴在珠子的**左缘**偏内 —— 珠子领着水走，水在后面追；
     *   · 向左拖（v < 0）→ 目标是正的：液面停在珠子的**右缘**偏内 —— 珠子半泡在水里（"灌满"），
     *     随后液面才继续向左流过去；
     *   · 静止（v = 0）→ 0：液面回到圆心，与旧版完全一致。
     * 用 `tanh` 而不是线性：天然饱和、处处连续，方向反转时液面平滑地绕过珠子（不用状态机）。
     */
    function fillLeadTargetFor(velocity, reduced) {
      var v = isFinite(velocity) ? velocity : 0;
      var lead = -FILL_LEAD_MAX * Math.tanh(v / FILL_VELOCITY_SOFT);
      if (reduced === true) lead *= KNOB_MOTION_REDUCED_SCALE;
      // `-0.6 * tanh(0)` 是 **-0**：归一成 0（否则断言里 Object.is(-0, 0) 为 false，
      // 也会让"静止"这个语义在数值上带个负号）
      return lead === 0 ? 0 : lead;
    }

    /**
     * 速度 → **水面倾角目标**（度，有正负）：这就是"高低落差"。
     * 水层围着**左端**旋转，所以：
     *   · 向左拖（v < 0）→ 负角 → CSS 里是**逆时针**，右端**抬起来** = 水在珠子后侧堆起来（灌满感）；
     *   · 向右拖（v > 0）→ 正角 → 右端压下去 = 水面被推着往前追。
     * 与液面同款 `tanh` 饱和；静止 = 0（水面是水平的，与旧版一致）。
     * （符号与早先的"px 高差"版相反 —— 那时正值表示"顶端往左退"，语义不同。）
     */
    function fillSkewTargetFor(velocity, reduced) {
      var v = isFinite(velocity) ? velocity : 0;
      var deg = SKEW_MAX_DEG * Math.tanh(v / SKEW_VELOCITY_SOFT);
      if (reduced === true) deg *= KNOB_MOTION_REDUCED_SCALE;
      return deg === 0 ? 0 : deg;
    }

    /** 确定性哈希 → [0,1)：同一个种子永远给同一个数（所以能断言），换种子就换一个数。 */
    function sloshHash(seed, salt) {
      var base = Math.floor(Math.abs(isFinite(seed) ? seed : 0) * 1000) + salt * 7919;
      var mixed = (base * 2654435761) % 4294967296;
      return ((mixed >>> 8) % 1000) / 1000;
    }

    /**
     * 由种子给出这一"荡"的参数：**时长 / 波数 / 阻尼 / 水量**每次都不一样（用户要的"随机"），
     * 但同一个种子结果可复现。种子由调用方按"第几次排水 + 当时的液面/倾斜"混出来。
     */
    function sloshSpecFor(seed) {
      var pick = function (salt, lo, hi) { return lo + (hi - lo) * sloshHash(seed, salt); };
      return {
        durationMs: Math.round(pick(11, SLOSH_DURATION_MIN, SLOSH_DURATION_MAX)),
        waves: pick(23, SLOSH_WAVES_MIN, SLOSH_WAVES_MAX),
        damping: pick(37, SLOSH_DAMPING_MIN, SLOSH_DAMPING_MAX),
        amplitude: pick(53, SLOSH_AMPLITUDE_MIN, SLOSH_AMPLITUDE_MAX),
      };
    }

    /**
     * 排水荡波缓动：0 → 1，**先慢慢停下来、再荡过静止位、再收回**，两端精确 0 / 1。
     *
     * ⚠️ 用的是**零初速**的阻尼振荡解：`dev(u) = e^{−λu}·(cos ωu + (λ/ω)·sin ωu)`
     * —— `dev(0) = 1` 且 `dev'(0) = 0`，所以 `g` 在起点是**平的**：水面是"减速停住 → 荡过去 → 收回"。
     * 早先用的是 `1 − e^{−λu}cos(ωu)`，它 `dev'(0) = −λ ≠ 0` —— 一上来就有速度，
     * 真机表现就是"松手后水面**啪地弹回**（80%+ 在前 15% 时长内走完），然后再晃"，
     * 用户直接指出"是荡水的问题"。物理上：真实的液面是从静止被释放的，不是被瞬间踢一脚。
     *
     * `amplitude`（"水量"）用**幂次**放大"偏离静止位"的部分（`1/amplitude < 1` → 波峰更高、波谷更深），
     * 而 `|d| = 1`（起点）与 `d = 0`（终点）都被原样保留 —— 端点精确 0 / 1 是硬要求。
     * 注意不能写成 `1 + d * amplitude` 再归一化：那是仿射变换，归一回 [0,1] 后等于什么都没做。
     * `reduced` 时退化成干净的 ease-out —— 没有波（放缓而不是冻住）。
     */
    function sloshEaseFor(u, spec, reduced) {
      var t = clamp01(u);
      if (reduced === true) return snapEaseFor(t, true);
      var waves = spec && isFinite(spec.waves) ? spec.waves : 1.5;
      var damping = spec && isFinite(spec.damping) ? spec.damping : 3;
      var amplitude = spec && isFinite(spec.amplitude) && spec.amplitude > 0 ? spec.amplitude : 1.2;
      var omega = 2 * Math.PI * waves;
      var decay = function (x) {
        return Math.exp(-damping * x) * (Math.cos(omega * x) + (damping / omega) * Math.sin(omega * x));
      };
      var denominator = 1 - decay(1);
      var value = Math.abs(denominator) < 1e-9 ? 1 - decay(t) : (1 - decay(t)) / denominator;
      var deviation = value - 1;
      // |d| 极小的浮点毛刺直接当"停在静止位"，免得 `Math.pow(0, x)` 之类的边界抖动
      if (Math.abs(deviation) < 1e-12) return 1;
      return 1 + (deviation > 0 ? 1 : -1) * Math.pow(Math.abs(deviation), 1 / amplitude);
    }

    /* ────────────── 落档：弹性吸附（纯函数，可离线断言）────────────── */

    /**
     * easeOutBack 的回弹幅度：`f(u) = 1 + (c+1)(u-1)³ + c(u-1)²` 在 (0,1) 内冲过 1 的最大量。
     * 推导：极值点 `x = -2c/(3(c+1))`（`x = u-1`），代回得 `4c³/(27(c+1)²)`；它对 c 单调递增，
     * 所以能用二分把 c 反解成「我们想要的回弹幅度」——**单一真相**：调 SNAP_OVERSHOOT 一个数就够。
     */
    function snapBackOvershootFor(c) {
      var k = c + 1;
      return (4 * c * c * c) / (27 * k * k);
    }

    /** 由目标回弹幅度反解 easeOutBack 的 c（二分；确定性，模块加载时算一次）。 */
    var SNAP_BACK_C1 = (function solveSnapBackC1() {
      var target = clamp01(SNAP_OVERSHOOT);
      var lo = 0;
      var hi = 8;
      for (var i = 0; i < 60; i += 1) {
        var mid = (lo + hi) / 2;
        if (snapBackOvershootFor(mid) < target) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    })();

    /**
     * 落档缓动：把 0..1 的进度映射成 0..1 的行程比例（两端严格是 0 和 1）。
     *   · 正常：easeOutBack —— 末段**冲过目标再弹回来**，回弹幅度 = SNAP_OVERSHOOT
     *   · `reduced`：干净的 ease-out，**一点回弹都没有**（系统要求减少动态效果时不能弹）
     */
    function snapEaseFor(u, reduced) {
      var t = clamp01(u);
      if (reduced === true) {
        var inverse = 1 - t;
        return 1 - inverse * inverse * inverse;
      }
      var p = t - 1;
      return 1 + (SNAP_BACK_C1 + 1) * p * p * p + SNAP_BACK_C1 * p * p;
    }

    /** 落档动画时长（毫秒）：「减少动态效果」时更短。 */
    function snapDurationFor(reduced) {
      return reduced === true ? SNAP_DURATION_REDUCED_MS : SNAP_DURATION_MS;
    }

    /**
     * 落档位置：从 `from` 弹性吸附到 `to`（都是轨道百分比）。
     * 最后用 `clamp01` 收口 —— 回弹再大也不会把旋钮顶出轨道两端（两端档位最需要这条）。
     */
    function settlePctFor(from, to, elapsedMs, reduced) {
      var duration = snapDurationFor(reduced);
      var u = duration > 0 ? elapsedMs / duration : 1;
      var eased = snapEaseFor(u, reduced);
      return clamp01(from + (to - from) * eased);
    }

    /* ── 落档动画器：把上面这条纯曲线按帧推出去（rAF 优先，能降级）────────── */

    /**
     * 每帧只做一件事：算出当前位置交给 `onFrame`；到时长就把**精确刻度**交出去并收工。
     *
     * 四条纪律：
     *   · 时钟优先取 `win.performance.now()`（浏览器里是单调时钟），否则 `Date.now`；
     *     测试台可以用假 `performance` 把时间钉死，从而断言**逐帧序列**（回弹有没有发生）；
     *   · `cancel()` **不回调** onDone —— 被打断不是"落档完成"；
     *   · `retarget()` 从**当前位置**接着弹（写回失败回滚时不能从头再来，那会闪一下）；
     *   · 没有 rAF 用 setTimeout 顶；两个都没有就直接落到目标（fail-open，退化成旧行为）。
     */
    function createSnapAnimator(options) {
      var opts = options || {};
      var onFrame = typeof opts.onFrame === "function" ? opts.onFrame : function () {};
      var onDone = typeof opts.onDone === "function" ? opts.onDone : function () {};
      var win = opts.win || null;
      var raf = win && typeof win.requestAnimationFrame === "function"
        ? function (fn) { return win.requestAnimationFrame(fn); }
        : null;
      var caf = win && typeof win.cancelAnimationFrame === "function"
        ? function (handle) { return win.cancelAnimationFrame(handle); }
        : null;
      var setTimer = typeof opts.setTimeout === "function" ? opts.setTimeout : null;
      var clearTimer = typeof opts.clearTimeout === "function" ? opts.clearTimeout : null;
      var now = typeof opts.now === "function"
        ? opts.now
        : (win && win.performance && typeof win.performance.now === "function"
          ? function () { return win.performance.now(); }
          : function () { return Date.now(); });

      var running = false;
      var rafHandle = null;
      var timerHandle = null;
      var from = 0;
      var to = 0;
      var index = -1;
      var reduced = false;
      var startAt = 0;
      var current = 0;
      /** 这一段动画自己的时长（毫秒）：默认按落档时长，水面排水这类可以给一个更短的。 */
      var duration = SNAP_DURATION_MS;
      /** `raw === true` 时**不做 [0,1] 收口**：水面偏移是有正负的（-1..+1），不能被夹平。 */
      var raw = false;
      /** 缓动曲线：`"snap"` = 落档回弹；`"slosh"` = 排水荡波（需要 `sloshSpec`）。 */
      var curve = "snap";
      var sloshSpec = null;

      function stopPending() {
        if (rafHandle !== null && caf !== null) {
          try { caf(rafHandle); } catch (error) { /* 取消失败不影响我们自己停 */ }
        }
        rafHandle = null;
        if (timerHandle !== null && clearTimer !== null) {
          try { clearTimer(timerHandle); } catch (error) { /* 同上 */ }
        }
        timerHandle = null;
      }

      function finish() {
        running = false;
        stopPending();
        current = to;
        onFrame(to, index, from, to); // 末帧一定是**精确刻度**，不留浮点近似
        onDone(index);
      }

      function schedule() {
        if (!running) return;
        if (raf !== null) { rafHandle = raf(step); return; }
        if (setTimer !== null) { timerHandle = setTimer(step, SNAP_FRAME_MS); return; }
        finish(); // 没有任何计时能力 → 瞬时落档（功能不受影响，只是没有动画）
      }

      /** 当前值：默认走落档曲线（[0,1] 收口），`raw` 时走不夹的那套缓动（回弹或荡波）。 */
      function valueAt(elapsed) {
        var u = duration > 0 ? elapsed / duration : 1;
        if (raw) {
          var eased = curve === "slosh" ? sloshEaseFor(u, sloshSpec, reduced) : snapEaseFor(u, reduced);
          return from + (to - from) * eased;
        }
        return settlePctFor(from, to, elapsed, reduced);
      }

      function step() {
        rafHandle = null;
        timerHandle = null;
        if (!running) return;
        var elapsed = now() - startAt;
        if (elapsed >= duration) { finish(); return; }
        current = valueAt(elapsed);
        onFrame(current, index, from, to);
        schedule();
      }

      function begin(spec) {
        reduced = spec.reduced === true;
        raw = spec.raw === true;
        curve = spec.curve === "slosh" ? "slosh" : "snap";
        sloshSpec = spec.slosh || null;
        duration = typeof spec.durationMs === "number" && spec.durationMs > 0 ? spec.durationMs : snapDurationFor(reduced);
        var keep = function (value) { return typeof value === "number" ? (raw ? value : clamp01(value)) : 0; };
        from = keep(spec.from);
        to = keep(spec.to);
        index = typeof spec.index === "number" ? spec.index : -1;
        startAt = now();
        current = from;
        running = true;
        onFrame(from, index, from, to); // 首帧 = 松手位置，显示不跳
        schedule();
      }

      var api = {
        start: function (spec) {
          stopPending();
          begin(spec || {});
        },
        /** 目标变了（回滚/超时/档位表变化）：从**当前位置**再弹一次，而不是从头再来。 */
        retarget: function (spec) {
          if (!running) { api.start(spec || {}); return; }
          var nextTo = typeof spec.to === "number" ? (raw ? spec.to : clamp01(spec.to)) : current;
          var nextIndex = typeof spec.index === "number" ? spec.index : index;
          // **幂等**：目标没变就一个字都不动 —— 否则 React 的重复渲染会把挂着的那一帧
          // 反复 cancel/重排，动画可能被饿死（永远走不到时长）。
          if (nextIndex === index && Math.abs(nextTo - to) < 1e-9) return;
          stopPending();
          from = current;
          to = nextTo;
          index = nextIndex;
          reduced = spec.reduced === true;
          if (spec.curve !== undefined) curve = spec.curve === "slosh" ? "slosh" : "snap";
          if (spec.slosh !== undefined) sloshSpec = spec.slosh;
          if (typeof spec.durationMs === "number" && spec.durationMs > 0) duration = spec.durationMs;
          else duration = snapDurationFor(reduced);
          startAt = now();
          schedule();
        },
        cancel: function () {
          running = false;
          stopPending();
        },
        isRunning: function () { return running; },
        current: function () { return current; },
      };
      return api;
    }

    /* ═════════════════ 官方目录访问（每会话一个，永不抛错）═════════════════ */

    /**
     * 每个会话一个访问器。它解决两件真实存在的事：
     *  1. `directoryFor(sessionId)` 在会话作用域/绑定尚未就绪时**按设计抛错**；
     *  2. 目录实例可能被重建（换模型代、连接重置），"抓一次揣着用"会变成永久坏的控件。
     * 所以每次读写都重新解析，解析失败就退避重试；订阅在一次成功解析后建立。
     */
    function createDirectoryAccess(ctx, sessionId, timers) {
      var listeners = new Set();
      var directory = null;
      var unsubscribe = null;
      var last = EMPTY_SNAPSHOT;
      var retryIndex = 0;
      var retryTimer = null;
      var closed = false;
      var lastLoadAt = 0;

      function notify() {
        var current = [];
        listeners.forEach(function (listener) { current.push(listener); });
        for (var i = 0; i < current.length; i += 1) {
          try { current[i](); } catch (error) { /* 单个订阅者抛错不影响其它订阅者 */ }
        }
      }

      function scheduleRetry() {
        if (closed || retryTimer !== null || retryIndex >= RETRY_DELAYS.length) return;
        var delay = RETRY_DELAYS[retryIndex];
        retryIndex += 1;
        retryTimer = timers.set(function () {
          retryTimer = null;
          // 解析成功后要主动通知一次：调用方（uSES）正等着 store 出现。
          if (resolve() !== null) {
            notify();
            return;
          }
          // 还没就绪就继续退避 —— 少了这一句，第一次重试失败后自愈链就永久断掉，
          // 控件会静默失效（这正是要防的那种"一次启动期抖动变成永久坏控件"）。
          scheduleRetry();
        }, delay);
      }

      /** 重新解析一次目录；实例变化时重挂订阅。返回当前目录（可能为 null）。 */
      function resolve() {
        if (closed) return null;
        var fresh = null;
        try {
          fresh = ctx.modelDirectories.directoryFor(sessionId);
        } catch (error) {
          fresh = null;
        }
        if (!fresh || !fresh.store || typeof fresh.store.getSnapshot !== "function") fresh = null;
        if (fresh === directory) return directory;
        if (unsubscribe !== null) {
          try { unsubscribe(); } catch (error) { /* 退订失败不影响新订阅 */ }
          unsubscribe = null;
        }
        directory = fresh;
        if (directory !== null) {
          retryIndex = 0;
          try {
            unsubscribe = typeof directory.store.subscribe === "function" ? directory.store.subscribe(notify) : null;
          } catch (error) {
            unsubscribe = null;
          }
          kickLoad();
        }
        return directory;
      }

      /** 主动拉一次目录（不 load 的话 store 停在 idle，档位列表是空的）。 */
      function kickLoad() {
        if (closed || directory === null || typeof directory.load !== "function") return;
        var now = Date.now();
        if (now - lastLoadAt < 400) return;
        lastLoadAt = now;
        var target = directory;
        try {
          Promise.resolve(target.load()).catch(function () { /* 失败原因由 store 的 error 字段呈现 */ });
        } catch (error) {
          /* load 同步抛：同样交给 store 状态 */
        }
      }

      return {
        getSnapshot: function () {
          if (closed) return EMPTY_SNAPSHOT;
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          if (directory !== null) {
            try {
              var value = directory.store.getSnapshot();
              if (value && typeof value === "object") last = value;
            } catch (error) {
              /* 保留上一次快照，绝不把渲染打崩 */
            }
          }
          return last;
        },
        subscribe: function (listener) {
          if (closed) return function () {};
          listeners.add(listener);
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          // StrictMode 会订阅/退订各跑一次；退订只清订阅，不永久关闭访问器。
          return function () {
            listeners.delete(listener);
          };
        },
        /** 取当前真正可写的目录（load/select 在调用时重新解析，避免用失效实例）。 */
        directory: function () {
          var fresh = resolve();
          return fresh !== null ? fresh : directory;
        },
        load: kickLoad,
        dispose: function () {
          closed = true;
          listeners.clear();
          if (retryTimer !== null) {
            try { timers.clear(retryTimer); } catch (error) { /* 忽略 */ }
            retryTimer = null;
          }
          if (unsubscribe !== null) {
            try { unsubscribe(); } catch (error) { /* 忽略 */ }
            unsubscribe = null;
          }
          directory = null;
        },
      };
    }

    /* ══════════ 官方菜单那一行的 DOM 桥（只动那一行，fail-open）══════════ */

    function firstSpanText(row) {
      try {
        var spans = row.querySelectorAll("span");
        for (var i = 0; i < spans.length; i += 1) {
          var text = spans[i].textContent;
          if (typeof text === "string" && text.length > 0) return text;
        }
      } catch (error) {
        /* 认不出就算了，调用方会退到结构判定 */
      }
      return "";
    }

    /**
     * 官方那一行右侧的**数值文字**（"Max" / "High"）—— 就是 `.cellValue` 那个 span。
     * 找不到 class 时退到结构：行内最后一个非空文字的 span（数值在标签之后、箭头之前）。
     * 只改它的颜色，文字内容一律不碰。
     */
    function findValueElement(row) {
      if (!row || typeof row.querySelectorAll !== "function") return null;
      try {
        var byClass = row.querySelectorAll("span[class*='cellValue']");
        if (byClass.length > 0) return byClass[byClass.length - 1];
        var spans = row.querySelectorAll("span");
        var found = null;
        for (var i = 0; i < spans.length; i += 1) {
          var text = spans[i].textContent;
          if (typeof text === "string" && text.replace(/\s+/g, "").length > 0) found = spans[i];
        }
        return found;
      } catch (error) {
        return null;
      }
    }

    /**
     * **收起的模型席按钮**（"DeepSeek-V41-Flash  High  ⌄"）里只显示档位名的那一小段文字。
     *
     * 官方渲染它用的是哈希 class（`wq12jW_triggerEffort`，前缀随构建变），靠 class 认迟早会失效，
     * 所以按**文字**认：官方 trigger 里的档位文字就是档位的 `name`，和我们从目录读到的是同一份数据。
     *
     * 传**全部档位名**（而不是只要当前那个）：档位刚切换、官方还没重渲染席按钮时，
     * 文字还是旧档位名 —— 只认当前名字会在那一瞬间"放手"，颜色闪一下。
     * 认不出任何已知档位名就返回 null（fail-open，绝不动别的文字）。
     */
    function findSeatEffort(doc, composer, expectedLabels) {
      if (!doc || !composer || typeof doc.querySelectorAll !== "function") return null;
      var list = typeof expectedLabels === "string" ? [expectedLabels] : expectedLabels;
      if (Object.prototype.toString.call(list) !== "[object Array]") return null;
      var wanted = [];
      for (var n = 0; n < list.length; n += 1) {
        var name = typeof list[n] === "string" ? list[n].replace(/\s+/g, "") : "";
        if (name.length > 0 && wanted.indexOf(name) < 0) wanted.push(name);
      }
      if (wanted.length === 0) return null;
      try {
        var seats = doc.querySelectorAll('button[aria-haspopup="menu"]');
        for (var i = 0; i < seats.length; i += 1) {
          if (!composer.contains(seats[i])) continue;
          var spans = seats[i].querySelectorAll("span");
          for (var j = 0; j < spans.length; j += 1) {
            var text = spans[j].textContent;
            if (typeof text === "string" && wanted.indexOf(text.replace(/\s+/g, "")) >= 0) return spans[j];
          }
        }
      } catch (error) {
        return null;
      }
      return null;
    }

    /**
     * 在自己所属的 composer 里找到"打开的那颗官方席"和它控制的**菜单**。
     * 全部用官方**语义属性**（aria-haspopup / aria-expanded / aria-controls / role）定位，
     * 不依赖哈希 class —— 官方改样式不会影响这里，改语义才会（那种改动会先在我的测试里炸掉）。
     *
     * 返回 `{ seat, menu, items }`（items = 菜单里的 `button[role=menuitem]` 列表）；
     * 找不到就 null。**注意**：这里不判"是不是根面板"（items 数量），那是调用方的事 ——
     * 键盘监听需要菜单本身，而"要不要挂滑条"才需要 items 恰好 2 个。
     */
    function findMenuFor(doc, composer) {
      if (!doc || !composer || typeof doc.querySelectorAll !== "function") return null;
      var seats = doc.querySelectorAll('button[aria-haspopup="menu"][aria-expanded="true"]');
      var seat = null;
      for (var i = 0; i < seats.length; i += 1) {
        if (composer.contains(seats[i])) { seat = seats[i]; break; }
      }
      if (seat === null) return null;

      var menuId = typeof seat.getAttribute === "function" ? seat.getAttribute("aria-controls") : null;
      var menu = menuId && typeof doc.getElementById === "function" ? doc.getElementById(menuId) : null;
      if (!menu) return null;

      var items = typeof menu.querySelectorAll === "function" ? menu.querySelectorAll('button[role="menuitem"]') : [];
      return { seat: seat, menu: menu, items: items };
    }

    /** 根面板里的「推理等级」那一行：按文案认，认不出按官方固定顺序取第 2 个。 */
    function effortRowOf(found) {
      var items = found && found.items ? found.items : [];
      for (var j = 0; j < items.length; j += 1) {
        var label = firstSpanText(items[j]);
        for (var k = 0; k < EFFORT_ROW_LABELS.length; k += 1) {
          if (label === EFFORT_ROW_LABELS[k]) return items[j];
        }
      }
      return items.length > 1 ? items[1] : null;
    }

    /** 目标行 = 根面板恰好两行时的「推理等级」那一行（否则 null：子面板不挂）。 */
    function findEffortRow(doc, composer) {
      var found = findMenuFor(doc, composer);
      if (found === null) return null;
      if (found.items.length !== 2) return null; // 根面板恰好两行；子面板用的是 menuitemradio
      return effortRowOf(found);
    }

    /**
     * 监听文档，把滑条容器挂进官方那一行。
     *
     * @param options.doc      宿主 document
     * @param options.win       宿主 window（派发 resize 让官方重测菜单位置）
     * @param options.anchor    () => 本会话在 composer 里的锚点元素（用来判定"哪颗席是我的"）
     * @param options.active    () => boolean，当前是否值得注入（没有档位就不注入，免得白加高）
     * @param options.onChange  (host | null) => void
     */
    function createMenuBridge(options) {
      var doc = options.doc;
      var win = options.win;
      var anchor = options.anchor;
      var active = options.active;
      var onChange = options.onChange;
      if (!doc || typeof doc.createElement !== "function") return null;

      var current = null;
      var menu = null; // 当前挂上的官方菜单（根面板）；键盘监听的作用范围
      var seatButton = null; // 打开的那颗席按钮（焦点停在它上面时也算"在菜单里"）
      var seat = null; // 收起态那一行里的档位文字（菜单没打开时也要着色）
      var seatColor = ""; // 组件给的当前颜色：重新抓到元素时立刻补上，不必等下一次渲染
      var observer = null;
      var timer = null;
      var disposed = false;
      var seatLabels = options.seatLabels; // () => string[]，全部已知档位名
      var onKey = typeof options.onKey === "function" ? options.onKey : null;

      /**
       * 键盘：**挂在 document 的捕获阶段**，而不是只等滑条自己拿到焦点。
       *
       * 为什么必须这样（用户实测反馈："键盘的上下左右键还是用不了"）：官方菜单自己管焦点，
       * 打开菜单后焦点在它的 menuitem 上，按键根本到不了滑条 —— 于是"必须先点一下滑条"才好使，
       * 而这既不好发现也不好用。捕获阶段先于 React 在根容器上的合成监听，
       * 所以只要事件在作用范围内，我们就能先处理掉，再 `stopPropagation` 拦住官方菜单。
       *
       * 作用范围（都要求**菜单确实开着**，也就是我们挂着的时候）：
       *   · 事件目标或当前焦点在**菜单里**；或
       *   · 在打开菜单的那颗**席按钮**上（刚点开菜单、焦点还没进菜单时）
       * 输入框/文本域一律不接管（子面板里有搜索框，何况那时滑条已经摘了）。
       */
      function onDocumentKeyDown(event) {
        if (onKey === null || menu === null || disposed) return;
        var target = event && event.target ? event.target : null;
        var active = doc.activeElement || null;
        var inside = function (node) {
          if (node === null || node === undefined) return false;
          try { return menu.contains(node) === true; } catch (error) { return false; }
        };
        var insideSeat = function (node) {
          if (node === null || node === undefined || seatButton === null) return false;
          try { return seatButton === node || seatButton.contains(node) === true; } catch (error) { return false; }
        };
        if (!inside(target) && !inside(active) && !insideSeat(target) && !insideSeat(active)) return;
        var tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        var handled = false;
        try { handled = onKey(event) === true; } catch (error) { handled = false; }
        if (!handled) return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      }

      /** 本会话的 composer 容器：从锚点往上找官方给 composer 卡片打的标记。 */
      function composerOf() {
        var node = anchor();
        if (!node) return null;
        var el = node;
        while (el && el.nodeType === 1) {
          if (typeof el.getAttribute === "function" && el.getAttribute("data-composer-card") !== null) return el;
          el = el.parentNode;
        }
        return null;
      }

      function detach() {
        if (current === null) return;
        var row = current.row;
        var container = current.container;
        try {
          if (container && container.parentNode) container.parentNode.removeChild(container);
        } catch (error) { /* 行可能已经被官方卸载 */ }
        try {
          var previous = current.previous;
          if (row && row.style) {
            row.style.height = previous.height;
            row.style.flexWrap = previous.flexWrap;
            row.style.paddingTop = previous.paddingTop;
            row.style.paddingBottom = previous.paddingBottom;
            row.style.boxShadow = previous.boxShadow;
          }
          // 数值文字（"Max"）的颜色也是我们改的，退出时一并还原
          if (current.value && current.value.style) current.value.style.color = previous.valueColor;
        } catch (error) { /* 还原失败不影响官方菜单自身 */ }
        current = null;
        menu = null;              // 键盘作用范围随之失效
        seatButton = null;
        onChange(null);
      }

      /** 收起的档位文字：还原本来的颜色并忘掉它。 */
      function releaseSeat() {
        if (seat === null) return;
        try {
          if (seat.el && seat.el.style) seat.el.style.color = seat.previousColor;
        } catch (error) { /* 元素可能已被官方卸载 */ }
        seat = null;
      }

      /**
       * 同步收起态的档位文字。
       * 只在**元素换了**（官方重渲染换了节点）或还没抓到时重新抓 —— 文字变了不换元素，
       * 所以档位切换不会造成"还原→再上色"的闪动。
       */
      function syncSeat() {
        var composer = composerOf();
        if (composer === null || active() !== true) { releaseSeat(); return; }
        if (seat !== null && seat.el && doc.documentElement && doc.documentElement.contains(seat.el)) {
          if (seatColor && seat.el.style) seat.el.style.color = seatColor; // 官方清过内联样式就补回来
          return;
        }
        releaseSeat();
        var wanted = typeof seatLabels === "function" ? seatLabels() : null;
        var el = findSeatEffort(doc, composer, wanted);
        if (el === null || !el.style) return;
        seat = { el: el, previousColor: el.style.color || "" };
        if (seatColor) el.style.color = seatColor;
      }

      function scan() {
        if (disposed) return;
        // 收起态的档位文字：跟菜单那一行互相独立，任一处失败都不该拖垮另一处
        try { syncSeat(); } catch (error) { /* 忽略 */ }
        try {
          var composer = composerOf();
          if (composer === null || active() !== true) { detach(); return; }
          // 已经挂好且那一行还在 → 什么都不做
          if (current !== null && current.row && doc.documentElement && doc.documentElement.contains(current.row)) return;

          var found = findMenuFor(doc, composer);
          if (found === null || found.items.length !== 2) { detach(); return; } // 只挂根面板（子面板是 menuitemradio）
          var row = effortRowOf(found);
          if (row === null) { detach(); return; }
          detach();
          menu = found.menu;          // 键盘监听的作用范围（加载成功后一直有效）
          seatButton = found.seat;

          var value = findValueElement(row);
          var previous = {
            // 真实 DOM 里未设置的内联属性读作 ""，这里统一成同样的语义，还原时才不会写回
            // 字面量 "undefined"（那在浏览器里是无效值，会把我们的加高留在原地）。
            height: row.style.height || "",
            flexWrap: row.style.flexWrap || "",
            paddingTop: row.style.paddingTop || "",
            paddingBottom: row.style.paddingBottom || "",
            boxShadow: row.style.boxShadow || "",
            // 数值文字原来的内联颜色（通常没设过，读作 ""）
            valueColor: value && value.style ? value.style.color || "" : "",
          };
          // 「加高那一栏的上下距离」+ 允许折行，让滑条落到第二行并铺满整行宽度。
          row.style.height = "auto";
          row.style.flexWrap = "wrap";
          row.style.paddingTop = ROW_PADDING_BLOCK;
          row.style.paddingBottom = ROW_PADDING_BLOCK;

          var container = doc.createElement("div");
          container.className = "ces-inline";
          container.setAttribute("data-ces-part", "host");
          row.appendChild(container);

          current = { row: row, container: container, value: value, previous: previous };
          onChange(current);

          // 官方菜单是"测量后固定定位"的，加高后让它重测一次（官方自己在 resize 里重测并夹取）。
          try {
            win.dispatchEvent(new win.Event("resize"));
          } catch (error) { /* 宿主没有 Event 构造器就算了，官方也会在状态变化时重测 */ }
        } catch (error) {
          try { detach(); } catch (inner) { /* 兜到底 */ }
        }
      }

      function start() {
        scan();
        // 键盘：挂 document 捕获阶段（见 onDocumentKeyDown 的注释），在 dispose 里摘掉。
        if (typeof doc.addEventListener === "function") {
          try { doc.addEventListener("keydown", onDocumentKeyDown, true); } catch (error) { /* 拿不到就算了 */ }
        }
        var MO = win && (win.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null));
        if (typeof MO === "function") {
          try {
            observer = new MO(function () { scan(); });
            observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            return;
          } catch (error) {
            observer = null;
          }
        }
        // 没有 MutationObserver 时退化成低频轮询；反正每轮都很便宜。
        if (win && typeof win.setInterval === "function") timer = win.setInterval(scan, 400);
      }

      return {
        scan: scan,
        start: start,
        /** 组件把当前该用的颜色给进来；桥负责在（重新）抓到元素时立刻应用。 */
        setSeatColor: function (color) {
          seatColor = typeof color === "string" ? color : "";
          if (seat !== null && seat.el && seat.el.style) {
            try { seat.el.style.color = seatColor; } catch (error) { /* 忽略 */ }
          }
        },
        dispose: function () {
          disposed = true;
          if (typeof doc.removeEventListener === "function") {
            try { doc.removeEventListener("keydown", onDocumentKeyDown, true); } catch (error) { /* 忽略 */ }
          }
          if (observer !== null) {
            try { observer.disconnect(); } catch (error) { /* 忽略 */ }
            observer = null;
          }
          if (timer !== null) {
            try { win.clearInterval(timer); } catch (error) { /* 忽略 */ }
            timer = null;
          }
          releaseSeat();
          detach();
        },
        host: function () { return current; },
      };
    }

    /* ════════════════════════════ 组件 ════════════════════════════ */

    /**
     * 单组件设计：锚点 + 桥 + 滑条（portal 进官方那一行）都在同一个函数里，
     * 所有 hook 都在同一个实例上，展开/收起不会改变 hook 顺序。
     */
    function GlassEffortSlider(props) {
      var sessionId = typeof props.sessionId === "string" && props.sessionId.length > 0 ? props.sessionId : null;
      var locked = props.locked === true;
      var ctx = props.__ctx;

      /** 系统的「减少动态效果」只影响**特效强度**，不影响功能（放缓而不是冻住）。 */
      var reducedMotion = false;
      try {
        reducedMotion = typeof window !== "undefined"
          && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
      } catch (error) {
        reducedMotion = false;
      }

      var access = React.useMemo(
        function () {
          if (sessionId === null || !ctx) return null;
          return createDirectoryAccess(ctx, sessionId, {
            set: function (fn, delay) { return setTimeout(fn, delay); },
            clear: function (handle) { clearTimeout(handle); },
          });
        },
        [ctx, sessionId],
      );

      React.useEffect(function () {
        return function () {
          if (access !== null) access.dispose();
        };
      }, [access]);

      var subscribe = React.useCallback(
        function (onChange) { return access === null ? function () {} : access.subscribe(onChange); },
        [access],
      );
      var getSnapshot = React.useCallback(
        function () { return access === null ? EMPTY_SNAPSHOT : access.getSnapshot(); },
        [access],
      );
      var state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

      var levels = levelsOf(state);
      var effectiveId = effectiveEffortId(state);
      var committedIndex = indexOfLevel(levels, effectiveId);
      var levelCount = levels.length;

      var draftState = React.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var optimisticState = React.useState(null);
      var optimistic = optimisticState[0];
      var setOptimistic = optimisticState[1];
      var errorState = React.useState(null);
      var errorText_ = errorState[0];
      var setError = errorState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var hostState = React.useState(null);
      var host = hostState[0];
      var setHost = hostState[1];
      /** 落档动画的当前状态：`{ pct, index }`，null = 没有落档在跑（显示权交回生效值）。 */
      var settleState = React.useState(null);
      var settle = settleState[0];
      var setSettle = settleState[1];

      var anchorRef = React.useRef(null);
      var trackRef = React.useRef(null);
      var optimisticIdRef = React.useRef(null);
      /** 拖动的"最新位置"放 ref：React 会把同一 tick 的多次 setState 合并，
       *  松手那一帧若从 state 读位置，可能读到上一次渲染的旧值，从而写错档位。 */
      var draftRef = React.useRef(null);
      var commitRef = React.useRef({ timer: null, inFlight: false, queued: null });
      /** 滚轮累积器（格）：把像素/行/页三种增量归一化后攒起来，攒够一格才走一步。 */
      var wheelAccRef = React.useRef(0);
      /** 滚轮处理函数放 ref：原生监听只挂一次，但要能读到最新一帧的状态。 */
      var wheelStepRef = React.useRef(null);
      /**
       * 按键处理函数放 ref：桥在 document 上挂的捕获监听只建一次（deps 是 ctx/session），
       * 直接传函数会把它钉在**挂载那一帧**的闭包上（那时 levelCount 还是 0）。
       */
      var keyHandlerRef = React.useRef(null);
      /**
       * 步进的**逻辑位置**（同步更新，不依赖 React 何时重渲染）。
       * 触控板/连按会在一次渲染之间塞进好几个事件，那时闭包里的 `settle` 还是旧的 ——
       * 少了这个 ref，6 格连滚会被算成"每次都从同一档出发"，只走一档。
       */
      var stepIndexRef = React.useRef(null);
      var draggingRef = React.useRef(false);
      var levelCountRef = React.useRef(0);
      var seatNamesRef = React.useRef([]); // 全部已知档位名（认官方席按钮上的那段文字用）
      var bridgeRef = React.useRef(null);
      /** 落档动画器（吸附 + 回弹）：只管视觉，绝不参与写回。 */
      var animatorRef = React.useRef(null);
      /** 当前这段落档的行程（from/to/travel）：珠子"叮"的大小按过冲占行程的比例算。 */
      var settleSpanRef = React.useRef({ from: 0, to: 0, travel: 0 });
      /* ── 珠子的灵动态（速度 / 拉伸 / 高光滞后）───────────────────────────
         位置每帧都在变，这几个量就跟着每帧重算；停手后由**一个 timer**把速度归零
         （不是动画循环），所以静止时珠子一定回到 1.000 的圆。 */
      var motionRef = React.useRef({ pct: null, at: 0, velocity: 0, lag: null, lagAt: 0, lead: 0, leadAt: 0, skew: 0, skewAt: 0 });
      var relaxRef = React.useRef(null);
      /** 只为了"速度归零后再渲染一次"（把拉伸收回 1.000），不参与任何计算。 */
      var setMotionSeq = React.useState(0)[1];
      /* ── 进度条的"水感"：液面偏移 + 水面倾斜（高低落差）──────────────────
         拖动时两个量都跟着速度走（ref，每帧算）；停手后由**排水动画器**把它们荡回 0，
         那一段需要每帧渲染，所以排水时用 state 驱动。state 存的是荡波进度 g（0..1，
         可以超过 1 = 荡过头），三个水面量都按 `(1 - g)` 从各自起点收回去。 */
      var fillDrainRef = React.useRef(null);
      var drainStartRef = React.useRef({ lead: 0, skew: 0 });
      /** 荡波当前进度（0..1，可超过 1）：手又碰上来时用它把"荡到哪"平滑接过去。 */
      var drainGRef = React.useRef(0);
      var drainCountRef = React.useRef(0);
      var fillDrainState = React.useState(null);
      var fillDrainG = fillDrainState[0];
      var setFillDrainG = fillDrainState[1];
      levelCountRef.current = levelCount;

      /* 桥：找到官方菜单那一行，把滑条容器挂进去 */
      React.useEffect(function () {
        if (sessionId === null || !ctx) return undefined;
        var bridge = createMenuBridge({
          doc: typeof document === "undefined" ? null : document,
          win: typeof window === "undefined" ? null : window,
          anchor: function () { return anchorRef.current; },
          active: function () { return levelCountRef.current > 0; },
          onChange: function (next) { setHost(next); },
          // 键盘：桥把 document 捕获阶段的按键交到这里（读 ref → 永远是最新一帧的闭包）
          onKey: function (event) {
            var handler = keyHandlerRef.current;
            return typeof handler === "function" ? handler(event) === true : false;
          },
          // 收起态那一行显示的档位名（官方 trigger 里的文字就是它）；给全部名字更抗"官方还没重渲染"
          seatLabels: function () { return seatNamesRef.current; },
        });
        if (bridge === null) return undefined;
        bridgeRef.current = bridge;
        bridge.start();
        return function () {
          bridgeRef.current = null;
          bridge.dispose();
        };
      }, [ctx, sessionId]);

      /**
       * 档位是**后到**的（目录 load 完才有 efforts）。那时 DOM 没有任何变化，
       * MutationObserver 不会响，所以这里在档位数变化时主动重扫一次 ——
       * 少了这一句，"目录晚到"会让滑条永远挂不上去（起步期抖动变永久失效）。
       */
      React.useEffect(function () {
        if (bridgeRef.current !== null) bridgeRef.current.scan();
      }, [levelCount]);

      /**
       * 落档动画器：每帧把缓动曲线算出的位置推给 React（`settle`），到点收回显示权。
       * 与桥、目录都无关，所以只建一次；卸载时取消（否则会在卸载后 setState）。
       * 时钟走 `window.performance.now()`（测试台用假 performance 把时间钉死，断言逐帧序列）。
       */
      React.useEffect(function () {
        var animator = createSnapAnimator({
          win: typeof window === "undefined" ? null : window,
          setTimeout: typeof setTimeout === "function" ? setTimeout : null,
          clearTimeout: typeof clearTimeout === "function" ? clearTimeout : null,
          // `from/to` 是这一段落档的行程：珠子"叮"的大小 = 过冲占行程的比例（见 knobBounceFor）
          onFrame: function (pct, index, fromPct, toPct) {
            settleSpanRef.current = { from: fromPct, to: toPct, travel: Math.abs(toPct - fromPct) };
            setSettle({ pct: pct, index: index });
          },
          // 末帧的 pct 就是目标刻度，而 effectivePct 也是它 —— 交接处不会跳。
          // 步进位置同时作废：此后显示权交回生效值（回滚时也才不会拿旧目标继续步进）。
          onDone: function () { stepIndexRef.current = null; setSettle(null); },
        });
        animatorRef.current = animator;
        return function () {
          animatorRef.current = null;
          animator.cancel();
        };
      }, []);

      /**
       * "排水"动画器：停手后把**液面偏移 + 水面倾斜**（还有跟着倾斜的水舌）从当前值荡回 0。
       * 复用落档动画器（`raw` 不夹正负、`curve: "slosh"` 走荡波曲线），
       * 这一荡的**时长/波数/阻尼/水量**由 `sloshSpecFor(种子)` 每次重新给（用户要的"随机"）。
       * 进度 g 交给 state（0..1，可超过 1 = 荡过头），渲染时三个水面量都按 `(1 - g)` 收回。
       */
      React.useEffect(function () {
        var drain = createSnapAnimator({
          win: typeof window === "undefined" ? null : window,
          setTimeout: typeof setTimeout === "function" ? setTimeout : null,
          clearTimeout: typeof clearTimeout === "function" ? clearTimeout : null,
          onFrame: function (progress) {
            drainGRef.current = progress;
            setFillDrainG(progress);
          },
          onDone: function () {
            motionRef.current.lead = 0;
            motionRef.current.skew = 0;
            drainGRef.current = 0;
            setFillDrainG(null); // 排水结束：显示权交回"由速度算"的那条路径（此时也是 0）
          },
        });
        fillDrainRef.current = drain;
        return function () {
          fillDrainRef.current = null;
          drain.cancel();
        };
      }, []);

      // 乐观值：提交后先按用户选的那一档显示，直到宿主真实回报（或超时回滚）。
      var optimisticId = optimistic !== null && typeof optimistic.id === "string" ? optimistic.id : null;
      var optimisticIndex = optimisticId === null ? -1 : indexOfLevel(levels, optimisticId);

      // **已生效**的档位（乐观值优先，其次真实值）：收起态那一行显示的是它，不是拖动中的草稿。
      var effectiveIndex = committedIndex >= 0 ? committedIndex : 0;
      if (optimisticIndex >= 0) effectiveIndex = optimisticIndex;
      var effectivePct = pctFromIndex(effectiveIndex, levelCount);
      var effectiveLevel = levels[effectiveIndex] || null;
      // 席按钮上可能出现的是**任意一个档位名**（档位刚切换时官方还没重渲染）
      var seatNames = [];
      for (var n = 0; n < levels.length; n += 1) {
        if (levels[n] && typeof levels[n].name === "string" && levels[n].name.length > 0) seatNames.push(levels[n].name);
      }
      seatNamesRef.current = seatNames;
      keyHandlerRef.current = handleKey; // 桥的 document 监听永远拿最新一版（见 keyHandlerRef 注释）

      // 显示用的档位/位置，三态：
      //   拖动中 → 跟草稿（连续跟手）
      //   落档中 → 跟动画曲线（吸附 + 回弹）
      //   其余   → 已生效那一档（外部改档、初次挂载都走这里，不做动画）
      var settleIndex = settle !== null && typeof settle.index === "number" ? settle.index : -1;
      var shownIndex = draft !== null ? draft.index : (settleIndex >= 0 ? settleIndex : effectiveIndex);
      var shownPct = draft !== null && typeof draft.pct === "number"
        ? draft.pct
        : (settle !== null && typeof settle.pct === "number" ? settle.pct : effectivePct);
      var shownLevel = levels[shownIndex] || null;

      // 三个由**位置**连续驱动的量：填充色（蓝→紫→深紫）、能量强度（星云+星星渐入）、位置速率。
      var energy = energyFor(shownPct);
      var energyOn = energy > 0;
      var fillBackground = fillBackgroundFor(shownPct);
      var knobOffset = knobOffsetOf(shownPct);

      /* ── 珠子的灵动：只读 ref 里上一帧算好的速度/滞后（写入在下面的 effect 里）──
         位置真的变了才更新（见 motionRef 那段 effect 的注释），所以这里纯读、无副作用。 */
      var motion = motionRef.current;
      var knobStretch = knobStretchFor(motion.velocity, reducedMotion);
      var knobBounce = settle !== null
        ? knobBounceFor(shownPct, settleSpanRef.current.to, settleSpanRef.current.travel, reducedMotion)
        : 1;
      var knobHlPct = typeof motion.lag === "number" ? motion.lag : shownPct;
      /**
       * 水面两件套（水感）：
       *   · `fillLead` —— 液面偏移（单位 = 珠子半径）：水留在珠子后面 / 泡住珠子；
       *   · `fillSkew` —— **水面倾角（度）**：这就是"高低落差"，向后拖右端抬起。
       * 排水动画期间两者都按 `(1 - g)` 从各自起点收回 0（`g` 是荡波进度，可超过 1 = 荡过头）。
       */
      var waterDrain = fillDrainG === null ? 1 : 1 - fillDrainG;
      var fillLead = fillDrainG === null ? motion.lead : drainStartRef.current.lead * waterDrain;
      var fillSkew = fillDrainG === null ? motion.skew : drainStartRef.current.skew * waterDrain;
      /**
       * 水面宽度 = **到珠子圆心**（`knobOffset`）+ **1 个半径的水位基准** + 液面偏移 × 一个半径。
       * 那个 `+ 14px` 就是"珠子始终泡在水里"：静止时水面落在珠子的**右缘**，而不是圆心
       * （v1.0 起填充只到圆心，珠子右半颗永远坐在裸轨道上 —— 用户原话"珠子右下角一直没水"）。
       *
       * ⚠️ `min(0px, …)` 是用户要求的**"水不能超过珠子"**硬上限：基准已经等于珠子的右缘，
       * 所以液面只能往**回**（左）走。向后拖时水最多停在珠子右缘、把珠子整颗泡住，
       * 绝不会越过右缘再往外堆一个半径（v1.8.0 的行为）。
       * 夹在 CSS 而不是 JS 里，是为了让 `fillLead`/`fillSkewTargetFor` 这些物理量保持自然值
       * （荡波仍然双向振荡，只有显示层被夹住），断言也能分头验"物理量"与"显示上限"两件事。
       * 用 CSS 变量而不是纯 JS 数字：偏移是"半径的倍数"，而半径在 calc 里是 14px；
       * 越界（pct=1 时再加一个半径）由 `.ces-water` 的 `overflow:hidden` 截在管内 = 水顶到管壁。
       */
      /* 基准里带 `KNOB_SCALE_X`（按压 / 落档回弹 / 跟手拉伸 × 一个半径）：珠子横向拉长时右缘跟着外移，
         水的右尖端始终与珠子的右尖端重合；纵向那一半由 `.ces-water` 右端的椭圆圆角（`KNOB_RY`）负责，
         于是"水从珠子角上溢出"两个方向都堵住了（用户截图：右上、右下角溢水）。 */
      var fillEdgeOffset =
        "calc(" +
        knobOffset +
        " + " +
        FILL_BASE_RADIUS +
        " * " +
        KNOB_RADIUS +
        "px * " +
        KNOB_SCALE_X +
        " + min(0px, var(--ces-fill-offset,0) * " +
        KNOB_RADIUS +
        "px))";

      /**
       * 灵动的位置更新：**只在位置真的变了的那一次渲染**里推进速度与高光滞后。
       * 为什么必须这样：拖动途中 store 变化（busy 之类）也会触发渲染，位置却没动 ——
       * 若按渲染次数算速度，会被算成 0，珠子会在拖动中途突然缩回圆形。
       * 停手 `KNOB_MOTION_STALE_MS` 之后由一个 timer 把速度归零（**不是**动画循环）。
       */
      React.useEffect(function () {
        var m = motionRef.current;
        var at = Date.now();
        var moved = m.pct !== null && Math.abs(shownPct - m.pct) > 1e-6;
        if (moved) {
          m.velocity = velocityFor(m.pct, shownPct, at - m.at);
          // 手又动了：荡波立刻让位（水面重新由速度决定）。
          // **要把"当前荡到哪"接过来**：不然水面会从荡波位置瞬间跳回上一次拖动时的旧值
          // （真机上就是手一碰水面"啪"地跳一下）。
          if (fillDrainRef.current !== null) fillDrainRef.current.cancel();
          if (fillDrainG !== null) {
            var carry = 1 - drainGRef.current;
            m.lead = drainStartRef.current.lead * carry;
            m.skew = drainStartRef.current.skew * carry;
          }
          setFillDrainG(null);
        } else {
          m.velocity = 0;
        }
        var lagDt = m.lagAt > 0 ? at - m.lagAt : 0;
        if (m.lag === null) m.lag = shownPct;
        m.lag = knobLagPctFor(m.lag, shownPct, lagDt);
        m.lagAt = at;

        // 水面（水感）：液面偏移 + 水面倾角（高低落差）都由速度给目标，自己指数逼近 ——
        // "先停在珠子后缘，再继续流过去"，同时水面斜着甩
        if (moved) {
          var leadDt = m.leadAt > 0 ? at - m.leadAt : 0;
          var skewDt = m.skewAt > 0 ? at - m.skewAt : 0;
          m.lead = approachFor(m.lead, fillLeadTargetFor(m.velocity, reducedMotion), leadDt, FILL_LAG_TAU_MS);
          m.skew = approachFor(m.skew, fillSkewTargetFor(m.velocity, reducedMotion), skewDt, SKEW_LAG_TAU_MS);
        }
        m.leadAt = at;
        m.skewAt = at;
        m.pct = shownPct;
        m.at = at;

        if (relaxRef.current !== null) {
          clearTimeout(relaxRef.current);
          relaxRef.current = null;
        }
        if (m.velocity !== 0) {
          relaxRef.current = setTimeout(function () {
            relaxRef.current = null;
            var current = motionRef.current;
            current.velocity = 0;
            // 停手 → 让水面"荡回去"：三个量从各自起点按同一条荡波曲线收回 0。
            // 这一荡的参数是**随机**的（时长/波数/阻尼/水量），种子把"第几荡 + 当时的水面"混进去，
            // 所以每次的观感都不一样；但同一个种子可复现（测试断言得住）。
            var lead = current.lead;
            var skew = current.skew;
            if (fillDrainRef.current !== null && (Math.abs(lead) > FILL_LEAD_EPSILON || Math.abs(skew) > FILL_LEAD_EPSILON)) {
              drainCountRef.current += 1;
              var seed = drainCountRef.current * 37 + Math.abs(lead) * 100 + Math.abs(skew) / 10;
              var spec = sloshSpecFor(seed);
              drainStartRef.current = { lead: lead, skew: skew };
              fillDrainRef.current.start({
                from: 0,
                to: 1,
                index: 0,
                raw: true,                 // 水面量有正负，不能被 [0,1] 夹平
                curve: "slosh",            // 荡波（不是落档那种单次回弹）
                slosh: spec,
                durationMs: spec.durationMs,
                reduced: reducedMotion === true,
              });
              return;
            }
            current.lead = 0;
            current.skew = 0;
            setFillDrainG(1);
            setMotionSeq(function (n) { return n + 1; });
          }, KNOB_MOTION_STALE_MS);
        }
      }, [shownPct]);

      // 官方那一行在最高档时描一圈紫边，强度跟着能量走（写内联样式，退出时由桥还原）。
      React.useEffect(function () {
        if (host === null || !host.row || !host.row.style) return;
        host.row.style.boxShadow = energyOn
          ? "inset 0 0 0 1px rgba(168,85,247," + (0.16 + 0.34 * energy).toFixed(2) + ")"
          : "";
      }, [host, energyOn, energy]);

      // 官方那一行的**数值文字**（"Max"）也跟着位置变色：蓝 → 亮紫（用户要求）。
      // 同样写内联、退出时由桥还原；**只改颜色，文字内容一个字都不碰**。
      React.useEffect(function () {
        if (host === null || !host.value || !host.value.style) return;
        host.value.style.color = valueColorFor(shownPct, shownLevel);
      }, [host, shownPct, shownLevel]);

      // **收起态**那一行的档位文字（模型席按钮上的 "High"，菜单没打开时就看得见）也跟着变色。
      // 颜色交给桥保管：官方重渲染换了节点时，桥会在重新抓到的那一刻补上，不必等 React。
      // 注意这里用**已生效**的档位（不是拖动中的草稿）—— 收起态显示的是真实档位。
      React.useEffect(function () {
        if (bridgeRef.current === null) return;
        bridgeRef.current.setSeatColor(valueColorFor(effectivePct, effectiveLevel));
      }, [levelCount, effectivePct, effectiveLevel]);

      // 宿主追上乐观值 → 撤掉乐观态（此后以真实目录为准）。
      React.useEffect(function () {
        if (optimisticId !== null && effectiveId === optimisticId) setOptimistic(null);
      }, [effectiveId, optimisticId]);

      // 超时兜底：宿主迟迟不回报就回滚并说明，不继续假装已生效。
      React.useEffect(function () {
        if (optimisticId === null) return undefined;
        var handle = setTimeout(function () {
          if (optimisticIdRef.current === optimisticId) {
            optimisticIdRef.current = null;
            setOptimistic(null);
            setError("档位切换超时，宿主未回报结果（已回滚显示）");
          }
        }, COMMIT_DEADLINE_MS);
        return function () { clearTimeout(handle); };
      }, [optimisticId]);

      /**
       * 落档途中真实状态变了，只有两种情况，分别处理：
       *   · 档位表缩了（换模型）→ 取消动画，显示交回生效值（目标档位已经不存在了）
       *   · 只是档位分叉（写回失败回滚 / 超时）→ 从**当前位置**再弹一次到真实档位
       * 依赖里只放 `settleIndex`（动画期间恒定），所以不会每帧触发。
       */
      React.useEffect(function () {
        if (settleIndex < 0) return;
        var animator = animatorRef.current;
        if (settleIndex >= levelCount) {
          if (animator !== null) animator.cancel();
          setSettle(null);
          return;
        }
        if (settleIndex === effectiveIndex) return;
        if (animator === null) { setSettle(null); return; }
        animator.retarget({
          to: pctFromIndex(effectiveIndex, levelCount),
          index: effectiveIndex,
          reduced: reducedMotion === true,
        });
      }, [settleIndex, effectiveIndex, levelCount, reducedMotion]);

      /**
       * 滚轮：**不能用 React 的 onWheel** —— React 17+ 把 wheel 注册成 passive，
       * 里面 `preventDefault()` 是无效的（滑条上的滚轮就会连带滚页面/菜单）。
       * 所以自己挂一个原生非 passive 监听，挂点是**桥注入的容器**（它由桥创建、跨 React
       * 重渲染持久，真机与测试台都成立）。状态从 `wheelStepRef` 里取最新的一帧。
       */
      React.useEffect(function () {
        if (host === null || !host.container || typeof host.container.addEventListener !== "function") return undefined;
        var container = host.container;
        var handler = function (event) {
          var step = wheelStepRef.current;
          if (typeof step !== "function") return;
          var handled = false;
          try { handled = step(event) === true; } catch (error) { handled = false; }
          if (!handled) return;
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
        };
        container.addEventListener("wheel", handler, { passive: false });
        return function () {
          try { container.removeEventListener("wheel", handler, { passive: false }); } catch (error) { /* 节点可能已被卸载 */ }
        };
      }, [host]);

      // 组件卸载：清掉降频定时器（否则会在卸载后写一次宿主）。
      React.useEffect(function () {
        return function () {
          var pending = commitRef.current;
          if (pending.timer !== null) {
            clearTimeout(pending.timer);
            pending.timer = null;
          }
          pending.queued = null;
          // 灵动的"速度归零"定时器也要清：否则会在卸载后 setState
          if (relaxRef.current !== null) {
            clearTimeout(relaxRef.current);
            relaxRef.current = null;
          }
        };
      }, []);

      function currentState() {
        return access === null ? EMPTY_SNAPSHOT : access.getSnapshot();
      }

      function flush() {
        var pending = commitRef.current;
        if (pending.timer !== null) {
          clearTimeout(pending.timer);
          pending.timer = null;
        }
        var op = pending.queued;
        pending.queued = null;
        if (op === null || op === undefined || access === null) return;

        var snapshot = currentState();
        var current = snapshot && snapshot.current;
        var isModel = op.kind === "model";
        if (!current || typeof current.provider !== "string" || typeof current.model !== "string") {
          setError(isModel ? "模型目录尚未就绪，无法切换模型" : "模型目录尚未就绪，无法写入档位");
          return;
        }
        // 发送前再判一次（去重的第二道闸）：档位看生效档、模型看当前模型。
        if (isModel ? current.model === op.id : effectiveEffortId(snapshot) === op.id) return;

        var directory = access.directory();
        if (directory === null || typeof directory.select !== "function") {
          setError(isModel ? "模型目录不可用，模型未切换" : "模型目录不可用，档位未写入");
          return;
        }

        pending.inFlight = true;
        setError(null);
        setBusy(true);

        var result;
        try {
          // 档位：与官方档位行同一个载荷（带 reasoningEffort）。
          // 模型：与官方**模型行**同一个载荷（只有 provider/model，**不带** reasoningEffort）
          //       —— 所以档位原样保留（"Pro 的 Max 很贵"在这里由用户自己按 ← 决定）。
          result = isModel
            ? directory.select({ provider: current.provider, model: op.id })
            : directory.select({ provider: current.provider, model: current.model, reasoningEffort: op.id });
        } catch (error) {
          result = Promise.reject(error);
        }
        // 只有档位做乐观显示：模型切换要等目录回报（档位表会随模型变，抢跑会显示错档位）。
        if (!isModel) {
          optimisticIdRef.current = op.id;
          setOptimistic({ id: op.id });
        }

        Promise.resolve(result).then(
          function (outcome) {
            pending.inFlight = false;
            if (outcome && outcome.ok === false) {
              if (!isModel) {
                optimisticIdRef.current = null;
                setOptimistic(null);
              }
              setError(errorText(outcome.error));
            }
          },
          function (error) {
            pending.inFlight = false;
            if (!isModel) {
              optimisticIdRef.current = null;
              setOptimistic(null);
            }
            setError(errorText(error));
          },
        ).then(function () {
          setBusy(false);
          // 在途合并：拖动/连滚期间攒下的**最新一件**在这里补发。
          if (pending.queued !== null) flush();
        });
      }

      /** 请求写回某一档：同档位去重 + 在途合并 + 降频；immediate 用于松手/键盘。 */
      function requestCommit(levelId, immediate) {
        if (levelId === null || levelId === undefined) return;
        var pending = commitRef.current;
        var snapshot = currentState();
        if (effectiveEffortId(snapshot) === levelId && pending.queued === null && !pending.inFlight) return;
        pending.queued = { kind: "effort", id: levelId };
        if (pending.inFlight) return;
        if (immediate === true) {
          flush();
          return;
        }
        if (pending.timer !== null) return;
        pending.timer = setTimeout(function () {
          pending.timer = null;
          flush();
        }, COMMIT_THROTTLE_MS);
      }

      /**
       * 请求切换模型（`↑` / `↓`）：写入口与官方模型行完全一致（载荷只有 provider/model）。
       * 去重 / 在途合并 / 降频与档位共用一条管线 —— 狂按也不会排队打宿主，
       * 而目录自己的 generation 会把过期的响应作废。
       */
      function requestModelSwitch(modelId, immediate) {
        if (typeof modelId !== "string" || modelId.length === 0) return;
        var pending = commitRef.current;
        var snapshot = currentState();
        var current = snapshot && snapshot.current;
        if (current && current.model === modelId && pending.queued === null && !pending.inFlight) return;
        pending.queued = { kind: "model", id: modelId };
        if (pending.inFlight) return;
        if (immediate === true) {
          flush();
          return;
        }
        if (pending.timer !== null) return;
        pending.timer = setTimeout(function () {
          pending.timer = null;
          flush();
        }, COMMIT_THROTTLE_MS);
      }

      function pctAt(clientX) {
        var track = trackRef.current;
        if (!track || typeof track.getBoundingClientRect !== "function") return null;
        var rect = track.getBoundingClientRect();
        // 与视觉几何一致：指针落点映射到"旋钮圆心能到的那一段"，所以拖到最左/最右必定命中端点档位。
        var usable = rect.width - KNOB_RADIUS * 2;
        if (!(usable > 0)) return null;
        return clamp01((clientX - rect.left - KNOB_RADIUS) / usable);
      }

      /** 吞掉事件：滑条在官方的 <button> 里，不能让拖动触发那一行的 onClick（会跳进等级列表）。 */
      function swallow(event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      }

      function moveTo(clientX, immediate) {
        if (levelCount === 0) return;
        var pct = pctAt(clientX);
        if (pct === null) return;
        var index = indexFromPct(pct, levelCount);
        var next = { pct: pct, index: index };
        draftRef.current = next;
        setDraft(next);
        requestCommit(levels[index].id, immediate === true);
      }

      /**
       * 开启一段落档动画：从 `fromPct` 弹性吸附到 `index` 档的刻度。
       * 拿不到动画器（没有 window/渲染环境异常）就**什么都不做** —— 显示直接落到生效值，
       * 也就是退化成旧行为，功能不受影响（fail-open）。
       */
      function startSettle(fromPct, index) {
        var animator = animatorRef.current;
        if (animator === null || levelCount <= 0 || index < 0 || index >= levelCount) return;
        animator.start({
          from: typeof fromPct === "number" ? fromPct : pctFromIndex(index, levelCount),
          to: pctFromIndex(index, levelCount),
          index: index,
          reduced: reducedMotion === true,
        });
      }

      function endDrag() {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        var latest = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (latest === null || levelCount === 0) return;
        // 1) 先写回（时机与旧版一字不差：松手立即落地，不放进动画里）
        requestCommit(levels[latest.index].id, true);
        // 2) 再只管视觉：从松手位置弹性吸附到目标刻度
        //    （写回失败/超时会由 retarget 效果把动画重新引到真实档位）
        startSettle(latest.pct, latest.index);
      }

      function onTrackPointerDown(event) {
        if (locked || levelCount === 0) return;
        swallow(event);
        // 打断上一段落档：立刻取消动画并清掉落档状态，草稿随即接管显示
        // （少了清状态这一句，"落档中点一下但没移动"会把显示永久冻在动画位置）
        if (animatorRef.current !== null) animatorRef.current.cancel();
        setSettle(null);
        stepIndexRef.current = null; // 手指接管：步进的逻辑位置交给草稿
        draggingRef.current = true;
        try {
          if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        } catch (error) { /* 指针捕获失败不影响拖动 */ }
        moveTo(event.clientX, false);
      }

      function onTrackPointerMove(event) {
        if (!draggingRef.current) return;
        swallow(event);
        moveTo(event.clientX, false);
      }

      /**
       * 当前显示位置（落档动画的起点）：拖动中跟草稿 → 落档中跟动画 → 其余跟生效值。
       * 键盘与滚轮步进都从这里接着弹，所以连按/连滚会一档一档地累积，而不是回到旧位置。
       */
      function basePctNow() {
        if (draft !== null && typeof draft.pct === "number") return draft.pct;
        if (settle !== null && typeof settle.pct === "number") return settle.pct;
        return effectivePct;
      }

      /** 当前显示档位下标（步进的起点）。 */
      function baseIndexNow() {
        if (draftRef.current !== null && typeof draftRef.current.index === "number") return draftRef.current.index;
        if (stepIndexRef.current !== null) return stepIndexRef.current;
        if (settle !== null && typeof settle.index === "number") return settle.index;
        return shownIndex;
      }

      /**
       * 跳到指定档位（`←`/`→` 各一步、滚轮各一格、`Home`/`End`）：
       * **一次只动一档、到端点钳住不环绕**，并且从当前显示位置弹性落档。
       * 返回是否真的动了（没动也要吞事件：滚轮顶到端点时不能把滚动传给页面）。
       */
      function moveToIndex(index, immediate) {
        if (locked || levelCount === 0) return false;
        var target = Math.max(0, Math.min(levelCount - 1, index));
        if (target === baseIndexNow()) return false;
        var fromPct = basePctNow();
        stepIndexRef.current = target; // 逻辑位置立刻前进：连发事件也一档一档地走
        setDraft(null);
        requestCommit(levels[target].id, immediate === true);
        startSettle(fromPct, target);
        return true;
      }

      /**
       * `↑` / `↓`：在 Flash / Pro 之间来回（`toggleModelFor` 认不出就什么都不做）。
       * **不动档位**（与官方模型行同款载荷），也不播落档动画 —— 档位表可能随模型变，
       * 显示交给目录回报后的生效值（与"外部改档"一致）。
       */
      function switchModel() {
        if (locked) return false;
        var target = toggleModelFor(currentState());
        if (target === null) return false;
        stepIndexRef.current = null; // 档位表可能随模型变，步进位置作废
        requestModelSwitch(target.model, true);
        return true;
      }

      function onKeyDown(event) {
        if (handleKey(event) !== true) return;
        swallow(event);
        if (typeof event.preventDefault === "function") event.preventDefault();
      }

      /**
       * 按键的**唯一**实现，两个入口共用：
       *   · 滑条自己的 onKeyDown（焦点正好在滑条上时）；
       *   · 桥挂在 document **捕获阶段**的监听（焦点在官方菜单别处时 —— 这才是打开菜单后的常态）。
       *     ↔/→ 调档位（步进、到端点钳住不环绕）、↑/↓ 切模型、Home/End 跳两端；
       *     其余键一律返回 false，**放行给官方菜单**（Esc / Enter / Tab 照旧）。
       */
      function handleKey(event) {
        if (locked || levelCount === 0 || !event) return false;
        var key = event.key;
        if (key === "ArrowLeft") { moveToIndex(baseIndexNow() - 1, true); return true; }
        if (key === "ArrowRight") { moveToIndex(baseIndexNow() + 1, true); return true; }
        if (key === "ArrowUp" || key === "ArrowDown") return switchModel();
        if (key === "Home") { moveToIndex(0, true); return true; }
        if (key === "End") { moveToIndex(levelCount - 1, true); return true; }
        return false;
      }

      /**
       * 滚轮一格 = 一档（向上 = 升档、向下 = 降档）。
       *
       * 三条纪律：
       *   · **归一化**：像素/行/页三种 `deltaMode` 都换算成"格"，再累积（见 `wheelNotchesFor`）；
       *   · **一步封顶**：一次事件最多走一档，累积器钳在 ±1 —— 触控板连续小增量不会机枪扫档
       *     （"Pro 的 Max 很贵"，所以宁可手感钝一点）；
       *   · **吞掉**：处理了就 preventDefault + stopPropagation，滑条上的滚轮既不滚页面也不滚菜单。
       * 还没攒够一格时也返回 true（吞掉但不换档），否则手势会半路跑去滚页面。
       */
      wheelStepRef.current = function (event) {
        if (locked || levelCount === 0 || draggingRef.current) return false;
        var notches = wheelNotchesFor(event);
        if (notches === 0) return false;
        var acc = wheelAccRef.current + notches;
        var steps = acc >= 1 ? 1 : (acc <= -1 ? -1 : 0);
        acc = Math.max(-WHEEL_ACC_LIMIT, Math.min(WHEEL_ACC_LIMIT, acc - steps));
        wheelAccRef.current = acc;
        if (steps === 0) return true;
        // 滚轮向下 = 降档（与音量/档位控件的直觉一致）；用**限频**模式，狂滚也只有 1 在途 + 1 排队。
        moveToIndex(baseIndexNow() - steps, false);
        return true;
      };

      var trackTitle = "推理等级" + (shownLevel !== null ? "：" + shownLevel.name : "");
      trackTitle += "（←/→ 调档位 · ↑/↓ 切 Flash/Pro · 滚轮调档位）";
      if (reducedMotion) trackTitle += "；系统「减少动态效果」已开启：粒子已放缓";
      // 版本号放最尾：重开后鼠标停一下就能确认自己跑的是哪一版（见 SLIDER_VERSION 的注释）
      trackTitle += " · v" + SLIDER_VERSION;

      var tickNodes = [];
      for (var t = 0; t < levelCount; t += 1) {
        tickNodes.push(React.createElement("span", {
          key: "tick-" + levels[t].id,
          className: "ces-tick",
          "data-ces-part": "tick",
          "data-on": t <= shownIndex ? "1" : "0",
          style: { left: knobOffsetOf(pctFromIndex(t, levelCount)) },
        }));
      }

      // 星空：所有出现粒子的档位都用这一套动画（统一的横穿 + 不消失 + 亮度即大小）。
      // 速率随**位置**变化（速度变化保留）：MAX 档 1.5s 横穿，high 档 3s，左端约 8.6s。
      var positionSpeed = speedFor(shownPct);
      var starCount = starCountFor(shownPct);
      var starLayerOpacity = starLayerOpacityFor(shownPct);
      var particleNodes = [];
      for (var s = 0; s < starCount; s += 1) {
        var starBrightness = starBrightnessFor(s);
        // 「减少动态效果」的放缓在 JS 里算（时长是内联的，不走媒体查询覆盖）
        var starDuration = starDurationFor(s, positionSpeed) * (reducedMotion ? REDUCED_MOTION_SLOWDOWN : 1);
        particleNodes.push(React.createElement(
          "span",
          {
            key: "star-" + s,
            className: "ces-star",
            "data-ces-part": "star",
            style: {
              top: PARTICLES[s].y + "%",
              // ⚠️ 时长与**负相位**必须直接内联：写成 CSS 变量时真宿主里相位不生效，
              //    会出现"一打开星星全挤在起点"（见样式表里的注释）。
              animationDuration: starDuration.toFixed(3) + "s",
              animationDelay: starDelayFor(s, starDuration).toFixed(3) + "s",
            },
          },
          React.createElement("span", {
            className: "ces-star__dot",
            "data-ces-part": "particle",
            // 亮度即大小系数：越亮越大（同时也是不透明度）
            "data-brightness": starBrightness.toFixed(3),
            style: { "--ces-b": starBrightness.toFixed(3) },
          }),
        ));
      }

      var ui = null;
      if (host !== null && host.container && levelCount > 0) {
        ui = ReactDOM.createPortal(
          React.createElement(
            "div",
            {
              className: "ces-inline",
              "data-ces-part": "root",
              "data-energy": energyOn ? "1" : "0",
              "data-motion": reducedMotion ? "reduced" : "full",
              // 活泼档开关（默认 0）：静止时的呼吸微光；见 KNOB_BREATH_ENABLED
              "data-breath": KNOB_BREATH_ENABLED ? "1" : "0",
              "data-busy": busy ? "1" : "0",
              // 拖动中（草稿在）与落档中（动画在）各给一个标记：前者用来关掉那两层 opacity 过渡，
              // 后者既是观感开关，也是测试观察动画生命周期的抓手。
              "data-dragging": draft !== null ? "1" : "0",
              "data-settling": settle !== null ? "1" : "0",
              // 水面（水感）：液面偏移 + **水面倾角（高低落差）**，水层共用这两个变量。
              style: {
                "--ces-energy": String(energy),
                "--ces-fill-offset": fillLead.toFixed(4),
                "--ces-skew": fillSkew.toFixed(3) + "deg",
                // 珠子那三个形变变量写在**根**上（不只是珠子上）：`.ces-water` 右端的椭圆端面要用它们，
                // 才可能"珠子被压扁时水跟着扁"。珠子自身靠继承照样拿得到（CSS 里 var 不吃位置）。
                "--ces-stx": knobStretch.x.toFixed(4),
                "--ces-sty": knobStretch.y.toFixed(4),
                "--ces-bounce": knobBounce.toFixed(4),
              },
            },
            React.createElement(
              "div",
              {
                ref: trackRef,
                className: "ces-track",
                "data-ces-part": "track",
                role: "slider",
                tabIndex: locked ? -1 : 0,
                "aria-label": "推理等级",
                "aria-valuemin": 0,
                "aria-valuemax": Math.max(0, levelCount - 1),
                "aria-valuenow": shownIndex,
                "aria-valuetext": shownLevel !== null ? shownLevel.name : "",
                "aria-disabled": locked ? "true" : undefined,
                // 键位声明给读屏器：←/→ 调档位、↑/↓ 切模型、Home/End 跳两端
                "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home End",
                title: trackTitle,
                onPointerDown: onTrackPointerDown,
                onPointerMove: onTrackPointerMove,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
                onKeyDown: onKeyDown,
                onClick: swallow,
              },
              // ── 水：`.ces-water` 是"水管形状"的裁切层（圆角由它提供 → 水面永远是圆的/直的，
              //    不会被切出尖角），里面 `.ces-water-inner` 比轨道高、绕左端旋转出水面倾角。
              //    珠子是它们的**兄弟节点**，所以要气泡珠的材质与投影都不受裁切影响。
              React.createElement(
                "div",
                // 水层的宽度就在这一层：它的右缘就是水面，所以端面形状（珠子当下的椭圆）也由它决定。
                {
                  className: "ces-water",
                  "data-ces-part": "water",
                  style: { width: fillEdgeOffset },
                },
                React.createElement(
                  "div",
                  { className: "ces-water-inner", "data-ces-part": "water-inner" },
                  React.createElement("div", {
                    className: "ces-fill",
                    "data-ces-part": "fill",
                    // 水宽 = 到旋钮圆心 + **一个半径的水位基准**（珠子始终泡在水里）+ 液面偏移 × 半径。
                    // 背景是"左蓝 → 当前位置颜色"的渐变。
                    style: { background: fillBackground },
                  }),
                  // 能力层（星云 + 扫光）：透明度 = 能量强度，负责"通电"的渐入。
                  React.createElement(
                    "div",
                    { className: "ces-energy", "data-ces-part": "energy" },
                    React.createElement("div", { className: "ces-energy__sweep", "data-ces-part": "sweep" }),
                  ),
                  // 星星单独一层：不跟星云淡入（否则 high 档星星被星云的 0.5 透明度压得看不见）。
                  React.createElement(
                    "div",
                    {
                      className: "ces-stars",
                      "data-ces-part": "stars",
                      // 星尘也跟着液面（水盖到哪，星就亮到哪）
                      style: { opacity: starLayerOpacity.toFixed(3) },
                    },
                    particleNodes,
                  ),
                ),
              ),
              // 刻度画在水**上面**（和以前一样：先水后刻度），珠子最后。
              tickNodes,
              React.createElement("div", {
                className: "ces-knob",
                "data-ces-part": "knob",
                // 玻璃质感与"灵动"全在 CSS 里，这里只把当帧的几个数交出去：
                // 高光位置（带滞后）、跟手拉伸（x/y）、落档"叮"、以及按压（CSS 按 data-dragging 给）
                style: {
                  left: knobOffset,
                  "--ces-hl": knobHighlightFor(knobHlPct),
                },
              }),
            ),
            errorText_ !== null
              ? React.createElement("div", { className: "ces-error", "data-ces-part": "error", role: "status" }, errorText_)
              : null,
          ),
          host.container,
        );
      }

      // 锚点：不可见、不占位，只用来(1)拿住插槽给的 sessionId 上下文 (2)反查自己的 composer。
      return React.createElement("span", {
        ref: anchorRef,
        hidden: true,
        "data-ces-part": "anchor",
        "aria-hidden": "true",
      }, ui);
    }

    /* ════════════════════════════ 插件接线 ════════════════════════════ */

    /**
     * 三个服务都是官方客户端插件已经在用的（slots 不必说；sessions 与 modelDirectories
     * 是 client-ui-model-selection / client-ui-workspace 的既有注入面）。
     * 这里刻意**不**注入 locale / theme：多声明一个可能不存在的服务会让 fiber 停在
     * PENDING，代价远大于省下两行文案。
     */
    var inject = ["slots", "sessions", "modelDirectories"];

    function apply(ctx) {
      installStyles();
      try {
        ctx.slots.inject(SLOT_NAME, function () {
          return ctx.slots.register(
            {
              name: SLOT_NAME,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              label: function () { return "Reasoning effort"; },
              // 会话 id 的第二条来路（标准 props 一般已经带了；两条都走 props.sessionId）。
              inject: function (sessionId) { return { sessionId: sessionId }; },
            },
            function SlotComponent(props) {
              return React.createElement(GlassEffortSlider, Object.assign({}, props, { __ctx: ctx }));
            },
          );
        });
      } catch (error) {
        // 注册失败只意味着这块控件不出现，绝不能连累宿主输入区。
        try { console.error("[glass-effort-slider] 插槽注册失败，控件不会出现：", error); } catch (e) { /* 忽略 */ }
      }
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    // 离线测试用的接缝（纯函数 + 桥 + 组件本身）。运行时无副作用。
    exports.__internals = {
      CSS: CSS,
      SLIDER_VERSION: SLIDER_VERSION,
      SLOT_NAME: SLOT_NAME,
      ENTRY_ID: ENTRY_ID,
      PARTICLES: PARTICLES,
      ROW_PADDING_BLOCK: ROW_PADDING_BLOCK,
      EFFORT_ROW_LABELS: EFFORT_ROW_LABELS,
      GlassEffortSlider: GlassEffortSlider,
      createMenuBridge: createMenuBridge,
      findEffortRow: findEffortRow,
      findMenuFor: findMenuFor,
      effortRowOf: effortRowOf,
      firstSpanText: firstSpanText,
      levelsOf: levelsOf,
      modelOf: modelOf,
      effectiveEffortId: effectiveEffortId,
      indexOfLevel: indexOfLevel,
      indexFromPct: indexFromPct,
      pctFromIndex: pctFromIndex,
      energyFor: energyFor,
      speedFor: speedFor,
      particleCountFor: particleCountFor,
      starCountFor: starCountFor,
      starLayerOpacityFor: starLayerOpacityFor,
      starBrightnessFor: starBrightnessFor,
      starDurationFor: starDurationFor,
      starDelayFor: starDelayFor,
      starHash01: starHash01,
      STARFIELD_DURATION_MEAN: STARFIELD_DURATION_MEAN,
      STARFIELD_DURATION_SPREAD: STARFIELD_DURATION_SPREAD,
      STARFIELD_MIN: STARFIELD_MIN,
      GOLDEN_RATIO: GOLDEN_RATIO,
      MAX_SPEED_FACTOR: MAX_SPEED_FACTOR,
      REDUCED_MOTION_SLOWDOWN: REDUCED_MOTION_SLOWDOWN,
      MIN_HEIGHT_SLOTS: MIN_HEIGHT_SLOTS,
      fillColorFor: fillColorFor,
      fillBackgroundFor: fillBackgroundFor,
      valueColorFor: valueColorFor,
      isOffLevel: isOffLevel,
      // 键盘 / 滚轮：模型切换目标与滚轮归一化（都可离线断言）
      toggleModelFor: toggleModelFor,
      wheelNotchesFor: wheelNotchesFor,
      MODEL_TOGGLE_TOKENS: MODEL_TOGGLE_TOKENS,
      WHEEL_NOTCH_PX: WHEEL_NOTCH_PX,
      WHEEL_ACC_LIMIT: WHEEL_ACC_LIMIT,
      // 落档（吸附 + 回弹）：常量、纯函数与动画器都开给离线测试
      SNAP_DURATION_MS: SNAP_DURATION_MS,
      SNAP_DURATION_REDUCED_MS: SNAP_DURATION_REDUCED_MS,
      SNAP_OVERSHOOT: SNAP_OVERSHOOT,
      SNAP_FRAME_MS: SNAP_FRAME_MS,
      SNAP_BACK_C1: SNAP_BACK_C1,
      snapBackOvershootFor: snapBackOvershootFor,
      snapEaseFor: snapEaseFor,
      snapDurationFor: snapDurationFor,
      settlePctFor: settlePctFor,
      createSnapAnimator: createSnapAnimator,
      findValueElement: findValueElement,
      findSeatEffort: findSeatEffort,
      knobOffsetOf: knobOffsetOf,
      knobHighlightFor: knobHighlightFor,
      // 珠子的灵动（都可在离线断言）：速度、拉伸、"叮"、高光滞后 + 幅度常量
      velocityFor: velocityFor,
      knobStretchFor: knobStretchFor,
      knobBounceFor: knobBounceFor,
      knobLagPctFor: knobLagPctFor,
      approachFor: approachFor,
      // 进度条的水感：液面偏移目标 + 幅度/时间常数
      fillLeadTargetFor: fillLeadTargetFor,
      // 水面倾角（高低落差）+ 排水荡波
      fillSkewTargetFor: fillSkewTargetFor,
      sloshHash: sloshHash,
      sloshSpecFor: sloshSpecFor,
      sloshEaseFor: sloshEaseFor,
      SKEW_MAX_DEG: SKEW_MAX_DEG,
      SKEW_VELOCITY_SOFT: SKEW_VELOCITY_SOFT,
      SKEW_LAG_TAU_MS: SKEW_LAG_TAU_MS,
      WATER_PAD_PX: WATER_PAD_PX,
      FILL_BASE_RADIUS: FILL_BASE_RADIUS,
      SLOSH_DURATION_MIN: SLOSH_DURATION_MIN,
      SLOSH_DURATION_MAX: SLOSH_DURATION_MAX,
      SLOSH_WAVES_MIN: SLOSH_WAVES_MIN,
      SLOSH_WAVES_MAX: SLOSH_WAVES_MAX,
      SLOSH_AMPLITUDE_MIN: SLOSH_AMPLITUDE_MIN,
      SLOSH_AMPLITUDE_MAX: SLOSH_AMPLITUDE_MAX,
      FILL_LEAD_MAX: FILL_LEAD_MAX,
      FILL_VELOCITY_SOFT: FILL_VELOCITY_SOFT,
      FILL_LAG_TAU_MS: FILL_LAG_TAU_MS,
      FILL_DRAIN_MS: FILL_DRAIN_MS,
      FILL_LEAD_EPSILON: FILL_LEAD_EPSILON,
      KNOB_STRETCH_MAX: KNOB_STRETCH_MAX,
      KNOB_VELOCITY_SOFT: KNOB_VELOCITY_SOFT,
      KNOB_BOUNCE_MAX: KNOB_BOUNCE_MAX,
      KNOB_LAG_TAU_MS: KNOB_LAG_TAU_MS,
      KNOB_MOTION_STALE_MS: KNOB_MOTION_STALE_MS,
      KNOB_MOTION_REDUCED_SCALE: KNOB_MOTION_REDUCED_SCALE,
      KNOB_VELOCITY_LIMIT: KNOB_VELOCITY_LIMIT,
      KNOB_BREATH_ENABLED: KNOB_BREATH_ENABLED,
      KNOB_RADIUS: KNOB_RADIUS,
      KNOB_SIZE: KNOB_SIZE,
      KNOB_SCALE_X: KNOB_SCALE_X,
      KNOB_SCALE_Y: KNOB_SCALE_Y,
      KNOB_RX: KNOB_RX,
      KNOB_RY: KNOB_RY,
      TRACK_HEIGHT: TRACK_HEIGHT,
      BASE_SPEEDUP: BASE_SPEEDUP,
      ENERGY_START: ENERGY_START,
      ENERGY_END: ENERGY_END,
      clamp01: clamp01,
      installStyles: installStyles,
    };

    return module.exports;
  },
});
