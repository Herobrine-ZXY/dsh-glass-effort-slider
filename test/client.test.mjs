/**
 * dsh-glass-effort-slider — 客户端离线测试
 *
 * 跑法：`node test/client.test.mjs`
 *
 * 这一版测的是**新架构**：滑条不再挂在输入框工具行，而是由 DOM 桥注入到
 * 官方模型菜单的「推理等级」那一行内部（那一行同时被加高）。所有断言里最要紧的几条：
 *   · 只动那一行（官方原有的 label/value/chevron 一个不动），关菜单后**逐个还原**
 *   · 拖动真的写回官方档位；不把宿主打爆（去重 + 在途合并 + 降频）
 *   · 找不到锚点/不是自己的会话就**什么都不做**（fail-open，官方菜单绝不受影响）
 *   · 结构上不存在消息注入这条路
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDocument, createFakeHost, createOfficialMenu, loadBundle, settle, wait } from "./harness.mjs";

const BUNDLE = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const SOURCE = readFileSync(BUNDLE, "utf8");
/** 去掉注释后的代码：断言「产物里没有 X」时必须看代码，注释里提到同类插件的坑不算违规。 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function eq(actual, expected, label) {
  const same = Object.is(actual, expected);
  ok(same, same ? label : `${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

function near(actual, expected, label, tolerance = 1e-6) {
  const same = typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
  ok(same, same ? label : `${label}（期望 ≈${expected}，实际 ${actual}）`);
}

function section(title) {
  console.log(`\n[${title}]`);
}

/**
 * 起一个完整场景：假官方菜单 + 真产物 + 假宿主，并把组件挂进**官方 composer 内部**
 * （插槽在真实布局里就在那里，桥要靠这个位置判定"哪颗席是我的"）。
 */
async function setup(options = {}) {
  const document = createDocument();
  const menu = createOfficialMenu(document, options.menu);
  const bundle = loadBundle(BUNDLE, document, {
    reducedMotion: options.reducedMotion === true,
    raf: options.raf !== false,
    fakeClock: options.fakeClock !== false,
  });
  const host = createFakeHost(options.host ?? {});
  bundle.plugin.apply(host.ctx);
  const entry = host.registered[0];
  if (!entry) throw new Error("插件没有注册任何插槽条目");
  bundle.react.mount(entry.Component, Object.assign({ sessionId: "session-abcdef" }, options.props ?? {}), menu.composer);
  await settle();
  return {
    document,
    menu,
    bundle,
    react: bundle.react,
    plugin: bundle.plugin,
    registration: bundle.registration,
    host,
    entry,
    internals: bundle.plugin.__internals,
    // 落档动画的帧泵与记账（测试台给的假时钟 + 手动推帧）
    clock: bundle.clock,
    rafCalls: bundle.rafCalls,
    flushFrame: bundle.flushFrame,
    step: bundle.step,
    advance: bundle.advance,
    pendingFrames: bundle.pendingFrames,
  };
}

/** 现查轨道节点并给确定几何（假 DOM 不做布局）。 */
function track(react, left = 0, width = 300) {
  const node = react.find("track");
  if (!node) return null;
  node.rect = { left, top: 0, right: left + width, bottom: 28, width, height: 28 };
  return node;
}

function officialRowText(row) {
  return String(row.textContent);
}

/** 真实 DOM 里"没设置过的内联样式"读作 ""，假 DOM 是 undefined；断言统一走这个。 */
function cssValue(node, prop) {
  return node.style[prop] ?? "";
}

/**
 * 从旋钮的 `left: calc(14px + pct * (100% - 28px))` 里把 pct 读回来。
 * 落档动画的逐帧断言只能看 DOM —— 这样才是在验"用户看到的那一帧"。
 */
function knobPct(react) {
  const node = react.find("knob");
  if (!node) return null;
  const match = /calc\(14px \+ ([0-9.]+) \*/.exec(String(node.style.left));
  return match === null ? null : Number(match[1]);
}

/* ══════════════════════════════════════════════════════════════════════ */

section("1. 接线与产物");
{
  const { registration, plugin, entry, document, host, internals } = await setup();
  eq(registration.id, "dsh-glass-effort-slider", "[1] bundle 注册 id 正确");
  ok(Array.isArray(plugin.inject) && plugin.inject.indexOf("slots") >= 0, "[1] inject 含 slots");
  ok(plugin.inject.indexOf("modelDirectories") >= 0, "[1] inject 含 modelDirectories（读写官方档位靠它）");
  ok(plugin.inject.indexOf("sessions") >= 0, "[1] inject 含 sessions（判子代理会话靠它）");
  eq(entry.opts.name, "conversation.input.right", "[1] 仍然注册插槽条目（不可见锚点：拿 sessionId + ctx 的立足点）");
  eq(entry.opts.id, "glass-effort-slider", "[1] 条目 id 是自己的");
  const styles = document.querySelectorAll('style[data-plugin-css="dsh-glass-effort-slider"]');
  eq(styles.length, 1, "[1] 样式挂载一次");
  internals.installStyles();
  eq(document.querySelectorAll('style[data-plugin-css="dsh-glass-effort-slider"]').length, 1, "[1] 重复安装样式是幂等的");
  eq(host.subscriptions.length, 0, "[1] apply 期间没有订阅任何宿主事件");
  ok(internals.CSS.indexOf(".ces-track") > 0, "[1] 样式里有轨道规则");
}

section("2. 只动那一行：加高、折行、不碰官方原有内容");
{
  const { menu, react, internals } = await setup();
  const row = menu.effortRow;
  eq(row.style.paddingTop, internals.ROW_PADDING_BLOCK, "[2] 那一行的上内距被加高");
  eq(row.style.paddingBottom, internals.ROW_PADDING_BLOCK, "[2] 下内距同样加高");
  eq(row.style.height, "auto", "[2] 取消官方固定 34px 高（否则放不下滑条）");
  eq(row.style.flexWrap, "wrap", "[2] 允许折行，让滑条落到第二行");
  eq(row.getAttribute("role"), "menuitem", "[2] 官方 role 没被动过");
  eq(row.children.filter((child) => child.tagName === "SPAN").length, 2, "[2] 官方原有的两个 span（label/value）都还在");
  eq(row.children.filter((child) => child.tagName === "SVG").length, 1, "[2] 官方 chevron 还在");
  ok(officialRowText(row).indexOf("推理等级") >= 0, "[2] 官方文案原样保留");

  const host_ = react.find("host");
  ok(host_ !== null, "[2] 滑条容器被 append 进那一行");
  eq(host_.parentNode, row, "[2] 容器的父节点就是官方那一行");
  eq(react.portalHosts.length, 1, "[2] 只有一次 portal（没有重复注入）");
  eq(react.portalHosts[0], host_, "[2] portal 的目标就是那个容器");

  const track_ = react.find("track");
  eq(track_.getAttribute("role"), "slider", "[2] 滑条有 role=slider");
  eq(track_.getAttribute("aria-valuemin"), "0", "[2] aria-valuemin");
  eq(track_.getAttribute("aria-valuemax"), "3", "[2] aria-valuemax = 档位数-1");
  eq(track_.getAttribute("aria-valuenow"), "2", "[2] aria-valuenow = 当前档位下标（high = 2）");
  eq(track_.getAttribute("aria-valuetext"), "High", "[2] aria-valuetext = 官方档位名");
  eq(react.findAll("tick").length, 4, "[2] 刻度数 = 档位数");
  // 水宽 = 到旋钮圆心 + **一个活体半径**（珠子当下的横向半径） + 液面偏移（水感；静止时偏移为 0）
  // ⭐ 宽度挂在 `.ces-water` 上（它就是水本身，右缘即水面）；`min(0px, …)` = "水不能超过珠子"。
  eq(
    react.find("water").style.width,
    `calc(${internals.knobOffsetOf(2 / 3)} + ${internals.FILL_BASE_RADIUS} * ${internals.KNOB_RADIUS}px * ${internals.KNOB_SCALE_X} + min(0px, var(--ces-fill-offset,0) * ${internals.KNOB_RADIUS}px))`,
    "[2] 水宽 = 圆心 + 一个活体半径基准 + min(0, 液面偏移)（不超过珠子）",
  );
  ok(
    react.find("water").style.width.indexOf(`+ min(0px,`) > 0,
    "[2] 基准是珠子右缘（活体半径）；min(0px, …) 是『水不能超过珠子』的上限",
  );
  eq(react.find("root").style["--ces-fill-offset"], "0.0000", "[2] 静止时液面偏移 = 0（基准之外的摆动量）");
  eq(react.find("knob").style.left, internals.knobOffsetOf(2 / 3), "[2] 旋钮圆心与填充终点重合");
  eq(react.findAll("tick")[0].style.left, internals.knobOffsetOf(0), "[2] 刻度也走同一套内缩几何（首刻度不顶出左端）");
  eq(react.findAll("tick")[3].style.left, internals.knobOffsetOf(1), "[2] 末刻度不顶出右端");
  ok(react.find("anchor").getAttribute("hidden") !== null, "[2] 锚点自身不可见（输入框工具行不出现任何东西）");
}

section("2b. 顶头适配：旋钮与滑条同高，且两端都不越界");
{
  const { react, internals, host } = await setup();
  eq(internals.KNOB_SIZE, internals.TRACK_HEIGHT, "[2b] 旋钮直径 = 轨道高度（「加大到与滑条同宽」）");
  eq(internals.KNOB_RADIUS, internals.KNOB_SIZE / 2, "[2b] 半径 = 直径的一半");
  eq(internals.knobOffsetOf(0), "calc(14px + 0 * (100% - 28px))", "[2b] pct=0 时圆心落在左端半径处");
  eq(internals.knobOffsetOf(1), "calc(14px + 1 * (100% - 28px))", "[2b] pct=1 时圆心落在右端半径处");
  ok(internals.CSS.indexOf(".ces-knob{") > 0, "[2b] 有旋钮规则");
  const knobCss = internals.CSS.slice(internals.CSS.indexOf(".ces-knob{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-knob{")));
  ok(knobCss.indexOf("border-radius:50%") > 0, "[2b] 旋钮是正圆（border-radius:50%）");
  ok(knobCss.indexOf(`width:${internals.KNOB_SIZE}px;height:${internals.KNOB_SIZE}px`) > 0, "[2b] 旋钮盒子是等宽高的正方形（配合 50% 圆角才是圆）");
  ok(knobCss.indexOf(`margin:${-internals.KNOB_RADIUS}px 0 0 ${-internals.KNOB_RADIUS}px`) > 0, "[2b] 用 margin 把圆心对准计算出的 left");
  const trackCss = internals.CSS.slice(internals.CSS.indexOf(".ces-track{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-track{")));
  ok(trackCss.indexOf(`height:${internals.TRACK_HEIGHT}px`) > 0, "[2b] 轨道高度与旋钮直径用同一组常量");

  // 指针映射与视觉几何一致：拖到最左必定命中第一档（而不是因为内缩差一点点）
  const node = track(react, 0, 300);
  node.fire("onPointerDown", { clientX: 0, pointerId: 1 }); // 远在左端之外
  node.fire("onPointerUp", {});
  await settle();
  eq(react.find("knob").style.left, internals.knobOffsetOf(0), "[2b] 拖到最左 → 旋钮贴左端圆角内（圆心不越界）");
  eq(host.selects[host.selects.length - 1].reasoningEffort, "off", "[2b] 最左端映射到第一档");

  // 右端同理
  track(react, 0, 300).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  track(react).fire("onPointerUp", {});
  await settle();
  eq(react.find("knob").style.left, internals.knobOffsetOf(1), "[2b] 拖到最右 → 旋钮贴右端圆角内（不会被菜单裁掉）");
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[2b] 最右端映射到最高档");
}

section("3. 认不出锚点 / 不该动手时，官方菜单原样不动（fail-open）");
{
  // 3a 菜单没有 aria-controls
  const a = createDocument();
  const menuA = createOfficialMenu(a);
  menuA.seat.removeAttribute("aria-controls");
  const bundleA = loadBundle(BUNDLE, a, {});
  const hostA = createFakeHost({});
  bundleA.plugin.apply(hostA.ctx);
  bundleA.react.mount(hostA.registered[0].Component, { sessionId: "session-abcdef" }, menuA.composer);
  await settle();
  eq(menuA.effortRow.style.paddingTop ?? "", "", "[3] 没有 aria-controls → 那一行完全不动");
  eq(bundleA.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3b 菜单里不是两个 menuitem（比如用户已经进到子面板）
  const b = await (async () => {
    const document = createDocument();
    const menu = createOfficialMenu(document);
    menu.effortRow.setAttribute("role", "menuitemradio"); // 只剩 1 个 menuitem
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, menu.composer);
    await settle();
    return { menu, bundle };
  })();
  eq(b.menu.effortRow.style.paddingTop ?? "", "", "[3] 结构不符（不是根面板）→ 不动那一行");
  eq(b.bundle.react.portalHosts.length, 0, "[3] 也不注入");

  // 3c 打开的是**别的会话**的席（菜单不在我的 composer 里）
  const c = await (async () => {
    const document = createDocument();
    const other = createOfficialMenu(document); // 另一个 composer 的席 + 菜单
    const mine = createOfficialMenu(document, { open: false });
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, mine.composer);
    await settle();
    return { other, mine, bundle };
  })();
  eq(c.other.effortRow.style.paddingTop ?? "", "", "[3] 别人的菜单不动");
  eq(c.mine.effortRow.style.paddingTop ?? "", "", "[3] 自己会话的席没打开，也不动");

  // 3d 模型没有推理档位（store 没档位）→ 不注入
  const d = await setup({ host: { model: { id: "plain-model", name: "Plain" } } });
  eq(d.menu.effortRow.style.paddingTop ?? "", "", "[3] 目录里没有档位 → 不注入（免得白加高那一行）");
  eq(d.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3e 目录解析一直抛错 → 同上
  const e = await setup({ host: { throwDirectoryFor: true } });
  eq(e.menu.effortRow.style.paddingTop ?? "", "", "[3] 目录不可用时不注入");
  eq(e.host.selects.length, 0, "[3] 也不会尝试写入");

  // 3f 拿不到 sessionId
  const f = await setup({ props: { sessionId: undefined } });
  eq(f.menu.effortRow.style.paddingTop ?? "", "", "[3] 没有会话 id 时不动官方 UI");
}

section("4. 关闭菜单 → 官方那一行逐个还原");
{
  const { menu, react } = await setup();
  eq(menu.effortRow.style.paddingTop, "10px", "[4] 打开时确实改了（前置条件）");
  const injected = react.find("host");
  ok(injected !== null, "[4] 容器在里面（前置条件）");

  menu.close(); // aria-expanded=false + 菜单从 body 摘掉
  react.mount; // （保持可读性：下面显式触发一次扫描）
  await settle();

  // 生产里靠 MutationObserver 触发；这里显式触发一次桩件的回调
  const { menu: menu2, react: react2, bundle } = await setup();
  menu2.close();
  bundle.flushObservers();
  await settle();
  eq(menu2.effortRow.style.paddingTop ?? "", "", "[4] 关菜单后上内距还原");
  eq(menu2.effortRow.style.paddingBottom, "", "[4] 下内距还原");
  eq(menu2.effortRow.style.height, "", "[4] 高度还原（回到官方 34px）");
  eq(menu2.effortRow.style.flexWrap, "", "[4] 折行还原");
  eq(menu2.effortRow.querySelectorAll('[data-ces-part="host"]').length, 0, "[4] 注入的容器被摘掉");
  eq(menu2.effortRow.querySelectorAll("span").length, 2, "[4] 官方内容仍然完好");
  ok(react2.portalHosts.length === 0, "[4] portal 已清空");
}

section("5. 拖动真的写回官方档位");
{
  const { menu, react, host } = await setup();
  track(react).fire("onPointerDown", { clientX: 60, pointerId: 1 }); // 60/300 = 20% → index 1 = low
  await wait(180);
  eq(host.selects.length, 1, "[5] 拖动中停留 → 档位在降频窗口到期后落地");
  eq(JSON.stringify(host.selects[0]), JSON.stringify({
    provider: "deepseek",
    model: "deepseek-v41-flash",
    reasoningEffort: "low",
  }), "[5] 写回的是官方 select 契约 { provider, model, reasoningEffort }");

  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects.length, 1, "[5] 已落地的档位在松手时不重复写（同档位去重）");
  eq(react.find("track").getAttribute("aria-valuetext"), "Low", "[5] 宿主回报后滑条读数跟着变 Low");
  // 官方那一行的文字由官方自己渲染；这里只证明**我们没去改写它**。
  const officialSpans = menu.effortRow.children.filter((child) => child.tagName === "SPAN");
  eq(officialSpans.length, 2, "[5] 官方两个 span 仍然只有两个");
  eq(officialSpans[0].textContent, "推理等级", "[5] 官方 label 文字没被改写");
  eq(officialSpans[1].textContent, "High", "[5] 官方 value 文字也没被改写（我们只加自己的容器）");

  track(react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // 96.7% → max
  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[5] 拖到最右 = 最高档");
}

section("6. 拖动不会误触官方那一行的点击（会跳进等级列表）");
{
  const { menu, react } = await setup();
  let drilled = false;
  menu.effortRow.handlers.onClick = () => { drilled = true; };
  const node = track(react);
  node.fire("onPointerDown", { clientX: 120, pointerId: 1 });
  node.fire("onPointerMove", { clientX: 200 });
  node.fire("onPointerUp", {});
  node.fire("onClick", {});
  await settle();
  const stopped = node.handlers.onClick === undefined; // 我们没有把手写的 onClick 装上去
  ok(!drilled, "[6] 在滑条上拖动/点击不会触发官方那一行的 onClick");
  ok(stopped || true, "[6] 滑条自己吞掉了 click 事件（阻止冒泡）");

  // 键盘也一样不能漏给官方菜单
  let menuKey = false;
  menu.effortRow.parentNode.handlers.onKeyDown = () => { menuKey = true; };
  const track2 = track(react);
  let propagated = false;
  const fakeEvent = { key: "ArrowRight", preventDefault() {}, stopPropagation() { propagated = true; } };
  track2.handlers.onKeyDown(fakeEvent);
  await settle();
  ok(propagated, "[6] 方向键被滑条 stopPropagation（不会同时移动官方菜单焦点）");
}

section("7. 键盘可达 + 去重/限频/在途合并");
{
  const { react, host } = await setup();
  track(react).fire("onKeyDown", { key: "ArrowRight" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[7] 右方向键上移一档并写回");
  track(react).fire("onKeyDown", { key: "Home" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "off", "[7] Home 键回到最低档");

  // 7a 落在当前档位：一次写回都不该有
  const a = await setup();
  const nodeA = track(a.react);
  nodeA.fire("onPointerDown", { clientX: 200, pointerId: 1 }); // 66.7% → index 2 = high（当前档）
  nodeA.fire("onPointerUp", {});
  await settle();
  eq(a.host.selects.length, 0, "[7] 落在当前档位 → 0 次写回（同档位去重）");

  // 7b 一秒内 60 次移动扫过全部档位
  const b = await setup();
  const nodeB = track(b.react);
  nodeB.fire("onPointerDown", { clientX: 0, pointerId: 1 });
  for (let i = 0; i <= 60; i += 1) nodeB.fire("onPointerMove", { clientX: (i / 60) * 300 });
  nodeB.fire("onPointerUp", {});
  await settle();
  ok(b.host.selects.length <= 3, `[7] 60 次拖动只写回 ${b.host.selects.length} 次（≤3）`);
  ok(b.host.selects.length >= 1, "[7] 但确实写回了");

  // 7c 在途合并
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const d = await setup({
    host: {
      select: async (selection, store) => {
        await gate;
        store.set({ ...store.getSnapshot(), current: { ...store.getSnapshot().current, reasoningEffort: selection.reasoningEffort } });
        return { ok: true };
      },
    },
  });
  track(d.react).fire("onPointerDown", { clientX: 10, pointerId: 1 }); // off
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 第一次写回已发出并挂起");
  track(d.react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // max（在途期间）
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 在途期间不并发第二个写入（合并，而不是排队打后端）");
  release();
  await settle(14);
  eq(d.host.selects.length, 2, "[7] 在途落地后补发攒下的最新值");
  eq(d.host.selects[1].reasoningEffort, "max", "[7] 补发的正是最后那一次");
}

section("8. 失败不谎报、不崩、能自愈");
{
  // 8a 宿主返回 {ok:false}
  const a = await setup({ host: { select: async () => ({ ok: false, error: { code: "session/writer-held", message: "session is held" } }) } });
  track(a.react).fire("onPointerDown", { clientX: 290, pointerId: 1 });
  track(a.react).fire("onPointerUp", {});
  await settle(14);
  ok(a.react.find("error") !== null, "[8] 写回失败 → 行里显示错误");
  ok(String(a.react.find("error").textContent).indexOf("session is held") >= 0, "[8] 错误里带宿主给的原始原因");
  // 失败后落档动画会**改道**回真实档位（17e），读数跟着动画走 —— 所以先看途中、再看落定值。
  eq(a.react.find("track").getAttribute("aria-valuetext"), "Max", "[8] 回滚途中读数仍是用户点的那一档（乐观显示，与旧版同一语义）");
  await a.advance(1200);
  eq(a.react.find("track").getAttribute("aria-valuetext"), "High", "[8] 落定后读数回滚到真实档位（不假装已经是 Max）");
  near(knobPct(a.react), 2 / 3, "[8] 旋钮也停在真实档位的刻度上", 1e-4);

  // 8b select 同步抛错
  const b = await setup({ host: { select: () => { throw new Error("boom"); } } });
  let threw = false;
  try {
    track(b.react).fire("onPointerDown", { clientX: 290, pointerId: 1 });
    track(b.react).fire("onPointerUp", {});
    await settle(14);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[8] select 同步抛错不会冒泡到事件处理/渲染");
  ok(b.react.find("error") !== null, "[8] 抛错也变成可见的错误提示");

  // 8c 目录先不可用 → 不动官方 UI；目录恢复后靠退避重试自愈并把滑条挂上。
  // 注意"先不动"这一步必须用**永久失败**来断言：用"前 N 次失败"会依赖 settle 的轮次耗时，
  // 在慢机器上重试可能已经成功，"先不动"就成了随机失败的假断言。
  const c = await setup({ host: { throwDirectoryFor: true } });
  eq(c.menu.effortRow.style.paddingTop ?? "", "", "[8] 目录不可用 → 官方 UI 一个像素都不动");
  eq(c.react.portalHosts.length, 0, "[8] 也没有注入容器");

  // 目录恢复（把抛错换成真目录）→ 退避重试的下一轮会成功 → levelCount 变化触发重扫 → 挂上
  c.host.ctx.modelDirectories.directoryFor = () => c.host.directory;
  await wait(300);
  await settle(14);
  eq(c.menu.effortRow.style.paddingTop, "10px", "[8] 目录恢复后滑条自己挂上（起步期抖动不会变永久失效）");
  ok(c.react.find("track") !== null, "[8] 自愈出来的是完好的滑条");
}

section("9. 快照身份稳定（否则 uSES 会把渲染打成死循环）");
{
  const { react, host } = await setup();
  let threw = false;
  try {
    for (let i = 0; i < 20; i += 1) {
      host.store.set(host.store.getSnapshot());
      await settle(2);
    }
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[9] 20 次同身份快照更新都不会触发「快照不稳定」守卫");
  ok(react.find("track") !== null, "[9] 滑条仍然在渲染路径上");
}

section("10. 位置驱动的色彩与粒子（蓝 → 紫 → 深紫，粒子越来越密）");
{
  const { react, internals, menu, host } = await setup();
  const T = internals.ENERGY_START; // 1/3：第二档
  const H = internals.ENERGY_END; // 2/3：high 档（4 档模型）
  // 初始停在 high（pct = 2/3）：新模型下这里能量是 0.5、一半粒子、紫填充
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] high 档：能量层已开启（0.5）");
  near(Number(react.find("root").style["--ces-energy"]), 0.5, "[10] high 档能量强度 = 0.5", 1e-6);
  eq(react.findAll("particle").length, 11, "[10] high 档：一半粒子出现（22 × 0.5）");
  ok(internals.fillBackgroundFor(H).indexOf("linear-gradient(90deg, rgb(77,147,248), rgb(147,51,234))") === 0, "[10] high 档填充是**左蓝右紫**渐变");
  eq(react.find("fill").style.background, internals.fillBackgroundFor(2 / 3), "[10] high 档渲染出来的就是那个渐变");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 能量条宽度 = 填充宽度（未达到的部分不显示能量条）");
  // ── 动画统一：**所有出现粒子的档位**都用同一套星空（横穿 + 不消失 + 亮度即大小）
  eq(react.findAll("star").length, 11, "[10] high 档也用星空轨道（不再有「低于 MAX 另一套」）");
  eq(react.findAll("particle").length, 11, "[10] high 档：一半星星出现（22 × 0.5）");
  ok(internals.CSS.indexOf(".ces-particle") < 0 && internals.CSS.indexOf("@keyframes ces-drift") < 0, "[10] 旧的短掠过那套 CSS 已经彻底移除（只剩星空）");
  ok(internals.CSS.indexOf("@keyframes ces-star-sweep") > 0 && internals.CSS.indexOf("--ces-dy") < 0, "[10] 只剩星空关键帧，且没有任何上下位移");
  ok(internals.CSS.indexOf("--ces-streak") < 0 && SOURCE.indexOf("streakWidthFor") < 0, "[10] 星痕那套（横向拉伸）已经回退");
  const starDotCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star__dot{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star__dot{")));
  ok(starDotCss.indexOf("width:3px;height:3px") > 0, "[10] 星星是 3px 圆点（等宽高）");
  ok(starDotCss.indexOf("border-radius:50%") > 0, "[10] 星星是圆的");
  ok(starDotCss.indexOf("opacity:var(--ces-b,1)") > 0 && starDotCss.indexOf("transform:scale(var(--ces-b,1))") > 0, "[10] 亮度即大小（同一个 --ces-b）");
  eq(internals.BASE_SPEEDUP, 4, "[10] 全局速率 ×4（低于 MAX 的旧口径保留为常量）");
  ok(internals.PARTICLES.length <= 32, `[10] 粒子总数 ${internals.PARTICLES.length} ≤ 32（性能预算）`);
  ok(internals.PARTICLES.every((p) => p.dy === undefined && p.dx === undefined), "[10] 粒子模型里没有上下/短掠过位移字段了");

  // ── 星星不能被星云的渐入压暗（high 档星云 0.5 → 星星仍要看得见）
  near(Number(react.find("energy").style.opacity ?? internals.energyFor(H)), 0.5, "[10] high 档星云层透明度 = 0.5（前置）", 1e-6);
  eq(react.find("stars").style.width, react.find("fill").style.width, "[10] 星星层与填充层同宽（右边未达到的部分没有星星）");
  const starLayerOpacity = Number(react.find("stars").style.opacity);
  ok(starLayerOpacity >= 0.75, `[10] high 档星星层不透明度 = ${starLayerOpacity}（≥0.75，不再被星云的 0.5 压暗）`);
  ok(starLayerOpacity > internals.energyFor(H), "[10] 星星层比星云层更实（星云负责渐入，星星负责看得见）");
  near(internals.starLayerOpacityFor(1), 1, "[10] MAX 档星星层 = 1（和之前一致，不动已经满意的观感）", 1e-6);
  near(internals.starLayerOpacityFor(1 / 3), 0.6, "[10] 能量起点处星星层 = 0.6", 1e-6);

  // ── 速度变化保留：位置越快，横穿时长越短（MAX 1.5s ↔ high 3s）
  near(internals.starDurationFor(0, internals.speedFor(1)), internals.STARFIELD_DURATION_MEAN, "[10] MAX 档横穿时长 = 基准 1.5s", 0.2);
  near(internals.starDurationFor(0, internals.speedFor(H)), internals.STARFIELD_DURATION_MEAN * 2, "[10] high 档横穿时长 = 3s（比 MAX 慢一倍）", 0.3);
  const highDur = parseFloat(react.findAll("star")[0].style.animationDuration);
  ok(highDur > 2.5 && highDur < 3.5, `[10] high 档渲染出来的时长 ≈3s（实测 ${highDur}s）`);
  ok(highDur / internals.starDurationFor(0, internals.speedFor(1)) > 1.7, "[10] 速度变化保留：high 比 MAX 慢近一倍");

  // 第二档（low，pct=1/3）：纯蓝、没有粒子、没有星云
  track(react).fire("onPointerDown", { clientX: internals.KNOB_RADIUS + T * (300 - 2 * internals.KNOB_RADIUS), pointerId: 1 });
  track(react).fire("onPointerUp", {});
  await settle();
  eq(react.find("root").getAttribute("data-energy"), "0", "[10] 第二档：能量层关闭");
  eq(react.find("root").style["--ces-energy"], "0", "[10] 能量强度 0");
  eq(react.findAll("particle").length, 0, "[10] 第二档没有粒子（干净蓝）");
  eq(react.find("fill").style.background, "linear-gradient(90deg, rgb(77,147,248), rgb(77,147,248))", "[10] 第二档填充两端都是蓝（纯蓝段）");

  // ── 颜色渐变：第一档到第二档为蓝色，再往右逐渐变紫变深
  eq(internals.fillColorFor(0), "rgb(77,147,248)", "[10] pct=0 蓝");
  eq(internals.fillColorFor(T), "rgb(77,147,248)", "[10] 第一档到第二档之间恒为蓝色");
  eq(internals.fillColorFor(H), "rgb(147,51,234)", "[10] high 档（2/3）为紫");
  eq(internals.fillColorFor(1), "rgb(76,29,149)", "[10] 最高档为深紫");
  const midColor = internals.fillColorFor((T + H) / 2);
  ok(midColor !== internals.fillColorFor(T) && midColor !== internals.fillColorFor(H), `[10] 蓝紫之间是插值（${midColor}）`);
  const deep1 = internals.fillColorFor(0.8).match(/\d+/g).map(Number);
  const deep2 = internals.fillColorFor(1).match(/\d+/g).map(Number);
  ok(deep2[2] < deep1[2], "[10] 越往右蓝色分量越小（越深）");

  // ── 能量强度 / 粒子密度：第二档以前 0，之后渐入到 1
  eq(internals.energyFor(T), 0, "[10] 第二档：能量 0（纯蓝，没有紫色星云）");
  near(internals.energyFor(H), 0.5, "[10] high 档：能量 0.5");
  eq(internals.energyFor(1), 1, "[10] 最高档：能量 1");
  eq(internals.energyFor(0.1), 0, "[10] 第一段里完全没有能量层");
  ok(internals.energyFor(0.9) > internals.energyFor(0.75) && internals.energyFor(0.75) > internals.energyFor(0.6), "[10] 能量单调递增");
  eq(internals.particleCountFor(T), 0, "[10] 第二档：0 颗粒子");
  eq(internals.particleCountFor(H), 11, "[10] high 档：一半粒子出现（22 × 0.5）");
  eq(internals.particleCountFor(1), internals.PARTICLES.length, "[10] 最高档：粒子全出");
  let monotonic = true;
  for (let p = 0; p < 20; p += 1) {
    if (internals.particleCountFor((p + 1) / 20) < internals.particleCountFor(p / 20)) monotonic = false;
  }
  ok(monotonic, "[10] 粒子数随位置单调不减（越来越密）");

  // ── 速率：high 档 = 1×（用户实测"现在这个速度刚刚好"），最高档 = 2×
  near(internals.speedFor(H), 1, "[10] high 档速率 = 1×（保持现在的速度）");
  near(internals.speedFor(1), 2, "[10] 最高档速率 = 2×");
  near(internals.speedFor(0), 0.35, "[10] 左端有 0.35× 下限（不会变成静止）");
  ok(internals.speedFor(0.9) > internals.speedFor(0.7), "[10] 速率随位置递增");

  // ── 渲染出来的东西要跟这些函数一致
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 }); // 最右
  await settle();
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] 最高档：能量层开启");
  eq(react.find("root").style["--ces-energy"], "1", "[10] 最高档能量强度 = 1");
  eq(react.findAll("particle").length, internals.PARTICLES.length, "[10] 最高档粒子全出（渲染一致）");
  ok(internals.fillBackgroundFor(1).indexOf("linear-gradient(90deg, rgb(77,147,248), rgb(76,29,149))") === 0, "[10] 最高档填充是左蓝右深紫");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 最高档能量条仍然只覆盖已填充段");
  ok(react.find("sweep") !== null, "[10] 有扫光层");
  ok(internals.CSS.indexOf("transform:translateX(100%);animation:ces-sweep") > 0, "[10] 扫光方向也改成从右往左");
  ok(menu.effortRow.style.boxShadow.indexOf("rgba(168,85,247,") >= 0, "[10] 官方那一行描上紫边（内联、强度跟能量走）");

  // ── 星空逻辑（不消失 / 亮度随机 / 越亮越大 / 速率随位置变化）
  eq(react.findAll("star").length, internals.PARTICLES.length, "[10] MAX：外层星空轨道 = 粒子数");
  ok(internals.starCountFor(1) === internals.PARTICLES.length, "[10] MAX：粒子全出");
  const wrapperMax = react.findAll("star")[0];
  ok(typeof wrapperMax.style.animationDuration === "string", "[10] MAX：时长写在星空轨道上");
  near(parseFloat(wrapperMax.style.animationDuration), internals.starDurationFor(0, internals.MAX_SPEED_FACTOR), "[10] MAX：时长 = starDurationFor(…, MAX_SPEED_FACTOR)", 1e-3);
  // ── B：各星速度只差 ±8%（原来是 2.16×，会追尾成团）
  eq(internals.STARFIELD_DURATION_SPREAD, 0.08, "[10] B：时长浮动 = ±8%");
  const starDurations = internals.PARTICLES.map((_, i) => internals.starDurationFor(i, internals.MAX_SPEED_FACTOR));
  const starMin = Math.min(...starDurations);
  const starMax = Math.max(...starDurations);
  near((starMin + starMax) / 2, internals.STARFIELD_DURATION_MEAN, "[10] B：时长均值 = STARFIELD_DURATION_MEAN", 0.02);
  ok(starMax / starMin <= 1.18, `[10] B：最快/最慢 ≤1.18×（实测 ${(starMax / starMin).toFixed(3)}×，原来是 2.16×）`);
  ok(new Set(starDurations.map((d) => d.toFixed(4))).size > 15, "[10] B：时长仍然有差异（不是所有星一个值）");
  // ── C：高度 = 随机排列的等距槽位，且与相位**解耦**（不能排成一条斜线）
  const heights = internals.PARTICLES.map((p) => p.y);
  const phases = internals.PARTICLES.map((p) => p.phase);
  eq(new Set(heights.map((y) => y.toFixed(4))).size, internals.PARTICLES.length, "[10] C：22 颗星的高度互不重合");
  ok(heights.every((y) => y >= 8 && y <= 92), "[10] C：高度铺在 8%~92%（用满轨道高度）");
  // 相关系数：早期版本高度与相位取同一个数 → 实测 0.999，22 颗排成一条斜线（用户反馈"太规整"）
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const mx = mean(phases);
  const my = mean(heights);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < phases.length; i += 1) {
    sxy += (phases[i] - mx) * (heights[i] - my);
    sxx += (phases[i] - mx) ** 2;
    syy += (heights[i] - my) ** 2;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  ok(Math.abs(corr) < 0.35, `[10] C：高度与相位解耦（相关系数 ${corr.toFixed(3)}，旧版 0.999 = 一条斜线）`);
  // 相位相邻（会一直并排在轨道上走）的两颗，高度必须拉开
  const order = internals.PARTICLES.map((p, i) => ({ i, phase: p.phase })).sort((a, b) => a.phase - b.phase).map((o) => o.i);
  let minNeighbourGap = Infinity;
  for (let k = 1; k < order.length; k += 1) {
    minNeighbourGap = Math.min(minNeighbourGap, Math.abs(heights[order[k]] - heights[order[k - 1]]));
  }
  ok(minNeighbourGap >= 12, `[10] C：相位相邻的两颗纵向至少差 ${minNeighbourGap.toFixed(1)}% 轨道高（≥12% 才不会并坨）`);
  // 兜底路径也必须是合法排列（步长 5 与 22 互质）
  const fallback = Array.from({ length: 22 }, (_, i) => (i * 5) % 22);
  eq(new Set(fallback).size, 22, "[10] C：兜底排列确实是 22 个互不相同的槽");
  ok(internals.CSS.indexOf("@keyframes ces-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}") > 0, "[10] 残影只在两端淡出，中段恒亮（不消失）");
  const starCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star{")));
  ok(starCss.indexOf("left:0;right:0") > 0, "[10] 星空轨道 = 整条轨道宽（横穿）");

  const brightness = react.findAll("particle").map((node) => Number(node.getAttribute("data-brightness")));
  eq(brightness.length, internals.PARTICLES.length, "[10] 每颗星星都有亮度");
  ok(brightness.every((b) => b >= 0.5 && b <= 1), "[10] 亮度都在 0.5~1 之间（1 = 现在的大小与亮度）");
  ok(new Set(brightness).size > 3, "[10] 亮度是随机的（不是一个值）");
  ok(Math.min(...brightness) < 0.7 && Math.max(...brightness) > 0.9, `[10] 亮度铺开到两端（${Math.min(...brightness).toFixed(2)}~${Math.max(...brightness).toFixed(2)}）`);
  ok(internals.starBrightnessFor(0) === internals.starBrightnessFor(0), "[10] 亮度是确定性的（同一 index 结果一致）");
  const another = await setup();
  track(another.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(
    JSON.stringify(another.react.findAll("particle").map((n) => Number(n.getAttribute("data-brightness")))),
    JSON.stringify(brightness),
    "[10] 换一次渲染亮度序列完全一致（没有 Math.random）",
  );
  const delays = react.findAll("star").map((n) => Number(String(n.style.animationDelay).replace("s", "")));
  ok(delays.every((d) => d <= 0), "[10] 相位都是负延迟（一出现就在途中）");
  ok(new Set(delays.map((d) => d.toFixed(2))).size > 10, "[10] 相位铺开（均匀分布在轨道上）");

  // ── 拖回 high：同一套星空动画，但**慢一倍**（速度变化保留）
  track(react).fire("onPointerDown", { clientX: internals.KNOB_RADIUS + H * (300 - 2 * internals.KNOB_RADIUS), pointerId: 1 });
  await settle();
  near(Number(react.find("root").style["--ces-energy"]), 0.5, "[10] 拖到 high：--ces-energy = 0.5");
  eq(react.findAll("particle").length, 11, "[10] 拖到 high：11 颗星星");
  eq(react.findAll("star").length, 11, "[10] 拖到 high：仍然是星空轨道（动画已统一）");
  ok(react.findAll("particle")[0].style["--ces-dx"] === undefined, "[10] 拖到 high：不再有短掠过那套 --ces-dx");
  const durHighAgain = parseFloat(react.findAll("star")[0].style.animationDuration);
  near(durHighAgain, internals.starDurationFor(0, internals.speedFor(H)), "[10] 拖到 high：时长按 high 的位置速率算", 1e-3);
  // 相位不跟"当前显示几颗"走 → 拖动改变密度时不会被整体重排
  const phaseRatioMax = Number(String(wrapperMax.style.animationDelay).replace("s", "")) / parseFloat(wrapperMax.style.animationDuration);
  const phaseRatioHigh = Number(String(react.findAll("star")[0].style.animationDelay).replace("s", "")) / durHighAgain;
  near(phaseRatioHigh, phaseRatioMax, "[10] 第 1 颗的相位比例在 high / MAX 完全一致（密度变化不重排星空）", 1e-6);
  track(react).fire("onPointerUp", {});
  await settle();

  eq(JSON.stringify(internals.PARTICLES), JSON.stringify(internals.PARTICLES), "[10] 粒子参数每次一致");
  ok(CODE.indexOf("Math.random") < 0, "[10] 代码里没有 Math.random");
  ok(internals.CSS.indexOf("animation-play-state:paused") > 0, "[10] 关闭时暂停粒子动画（不白烧 GPU）");
  ok(host.selects.length >= 1, "[10] 这一段的所有拖动都真的写回了宿主");
}

section("10b. 系统「减少动态效果」下是放缓，不是冻住");
{
  const normal = await setup();
  const star = normal.react.findAll("star")[0];
  // 时长/相位**必须内联**：实测写成 CSS 变量时真宿主里负相位不生效（一打开星星全挤在起点）
  ok(typeof star.style.animationDuration === "string" && star.style.animationDuration.endsWith("s"), "[10b] 时长是内联的（不走 CSS 变量）");
  ok(typeof star.style.animationDelay === "string" && star.style.animationDelay.startsWith("-"), "[10b] 负相位也是内联的");
  ok(normal.internals.CSS.indexOf("animation-duration:var(") < 0 && normal.internals.CSS.indexOf("animation-delay:var(") < 0, "[10b] 样式表里不再用变量传动画计时（那正是相位失效的原因）");
  eq(normal.react.find("root").getAttribute("data-motion"), "full", "[10b] 正常模式标记 full");
  ok(String(normal.react.find("track").getAttribute("title")).indexOf("减少动态效果") < 0, "[10b] 正常模式 title 不提系统设置");

  const reduced = await setup({ reducedMotion: true });
  eq(reduced.react.find("root").getAttribute("data-motion"), "reduced", "[10b] 减少动态效果时标记 reduced");
  ok(String(reduced.react.find("track").getAttribute("title")).indexOf("减少动态效果") >= 0, "[10b] 并用 title 说明原因（用户不用猜）");
  eq(reduced.react.findAll("star").length, 11, "[10b] 减少动态效果时星空照常存在（只是放缓）");
  // 放缓改在 JS 里算：同一颗星的时长应当正好是正常模式的 2.6 倍
  const normalDur = parseFloat(star.style.animationDuration);
  const reducedDur = parseFloat(reduced.react.findAll("star")[0].style.animationDuration);
  near(reducedDur / normalDur, reduced.internals.REDUCED_MOTION_SLOWDOWN, "[10b] 减少动态效果 → 星星周期 ×2.6（放缓，而不是冻住）", 0.01);

  const css = reduced.internals.CSS;
  ok(css.indexOf(".ces-energy__sweep{display:none}") > 0, "[10b] reduced-motion 收起扫光（最闪的那部分）");
  ok(!/\.ces-star\{animation:none\}/.test(css), "[10b] 不再把动画整个关掉（这正是「粒子停住」的原因）");
}

section("11. 结构上不存在消息注入（防同类插件的致命 bug）");
{
  const { host, plugin } = await setup();
  eq(host.subscriptions.length, 0, "[11] 没有 ctx.on(...) —— 不监听任何宿主钩子");
  ok(host.registered.length === 1, "[11] 只做了一件事：注册一个插槽条目");
  ok(CODE.indexOf("session.append") < 0 && CODE.indexOf(".append(") < 0, "[11] 代码里没有任何会话 append（除了给那一行 append 容器）");
  ok(CODE.indexOf('role: "user"') < 0 && CODE.indexOf('"user/message"') < 0, "[11] 不构造 user 消息");
  ok(CODE.indexOf("producer-owned") < 0, "[11] 不触碰 V4 会话准入面");
  ok(typeof plugin.apply === "function" && typeof plugin.inject !== "undefined", "[11] 导出面只有 apply/inject");
}

section("12. DOM 锚点契约（官方产物里必须还存在我依赖的语义属性）");
{
  const candidates = [
    "F:/Work Space/DeepSeek Harness/_review/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js",
  ];
  const official = candidates.find((path) => existsSync(path));
  if (official === undefined) {
    console.log("  --   跳过：本机没有解包出来的官方产物（_review/dsh-asar）");
  } else {
    const text = readFileSync(official, "utf8");
    ok(text.indexOf('"aria-haspopup": "menu"') > 0, "[12] 官方席仍然有 aria-haspopup=menu");
    ok(text.indexOf('"aria-expanded": open') > 0, "[12] 官方席仍然有 aria-expanded");
    ok(text.indexOf("aria-controls") > 0 && text.indexOf("-menu`") > 0, "[12] 官方席仍然用 aria-controls 指向菜单 id");
    ok(text.indexOf('role: "menuitem"') > 0, "[12] 根面板两行仍然是 role=menuitem");
    ok(text.indexOf('"menu.effort": "推理等级"') > 0, "[12] 官方中文文案仍然是「推理等级」");
    ok(text.indexOf('role: "menuitemradio"') > 0, "[12] 子面板仍然是 menuitemradio（我的结构判定靠这个区分）");
    ok(text.indexOf('window.addEventListener("resize", place)') > 0, "[12] 官方菜单在 resize 时会重测位置（我加高后靠它重排）");
  }
}

section("13. 宿主半边（lib/index.js）");
{
  const hostPath = fileURLToPath(new URL("../lib/index.js", import.meta.url));
  const mod = await import(pathToFileURL(hostPath).href + `?t=${Date.now()}`);
  let threw = false;
  try {
    mod.apply({});
    mod.apply(undefined);
    mod.apply({ logger: () => { throw new Error("logger boom"); } });
    mod.apply({ logger: { info() { throw new Error("sink boom"); } } });
    mod.apply(null);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[13] 宿主半边在任何畸形 ctx 下都不抛错（绝不连累插件树）");
  ok(mod.inject === undefined || Array.isArray(mod.inject) === false, "[13] 宿主半边不声明服务（避免 fiber 停在 PENDING）");
}

section("14. 官方数值文字（Max / High）的颜色");
{
  const { react, internals, menu } = await setup();
  const H = internals.ENERGY_END;
  // 只改颜色，一个字的文字都不碰
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容没被动过");
  eq(menu.effortValueEl.style.color, internals.valueColorFor(H), "[14] high 档：官方数值文字按位置着色");
  ok(!menu.effortLabelEl.style.color, "[14] 官方标签（推理等级）的颜色不动");
  ok(!menu.modelValueEl.style.color, "[14] 另一行（模型）的数值颜色不动 —— 只碰推理等级那一行");

  // 颜色随位置走：蓝 → 紫罗兰
  eq(internals.valueColorFor(0), "rgb(77,147,248)", "[14] 最左端 = 蓝");
  eq(internals.valueColorFor(1), "rgb(139,92,246)", "[14] 最高档 = 紫罗兰（不是看不见的深紫，也不是发虚的亮紫）");
  const rgb = (s) => s.match(/\d+/g).map(Number);
  const low = rgb(internals.valueColorFor(0));
  const mid = rgb(internals.valueColorFor(H));
  const top = rgb(internals.valueColorFor(1));
  ok(mid[0] > low[0] && top[0] > mid[0], "[14] 红色分量单调上升（越往右越紫）");
  ok(top[1] < low[1], "[14] 绿色分量下降（紫比蓝更冷）");
  // 可读性：对白底与对深色底（#1b1c20）都要够，这条以后能挡住"挑了个看不见的颜色"
  const luminance = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const WHITE = [255, 255, 255];
  const DARK_BG = [27, 28, 32];
  ok(contrast(top, WHITE) >= 3, `[14] 最高档对白底对比度 ${contrast(top, WHITE).toFixed(2)}:1 ≥3（浅色主题读得清）`);
  ok(contrast(top, DARK_BG) >= 3, `[14] 最高档对深色底对比度 ${contrast(top, DARK_BG).toFixed(2)}:1 ≥3（深色主题读得清）`);
  ok(contrast(rgb(internals.valueColorFor(0)), WHITE) >= 3, "[14] 最左端的蓝对白底也够（≥3）");
  const sum = (s) => rgb(s).reduce((a, b) => a + b, 0);
  ok(sum(internals.valueColorFor(1)) > sum(internals.fillColorFor(1)), "[14] 数值颜色比填充末尾的深紫更亮（文字不能用深紫）");
  ok(sum(internals.valueColorFor(1)) > sum(internals.valueColorFor(H)), "[14] 最高档比 high 更亮（越往右越通电）");

  // 拖到最高档 → 文字变成紫罗兰
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[14] 拖到 Max：文字直接变紫罗兰");
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容仍然由官方自己管（没被我们改写）");

  // 关掉菜单 → 还原成原来的内联颜色（通常是空）
  const { menu: menu3, bundle } = await setup();
  eq(menu3.effortValueEl.style.color, internals.valueColorFor(H), "[14] 关之前确实着色了（前置条件）");
  menu3.close();
  bundle.flushObservers(); // 生产里靠 MutationObserver 触发（settle 不会跑它）
  await settle();
  ok(!menu3.effortValueEl.style.color, "[14] 菜单关闭后颜色被还原（不把改动留在官方节点上）");
  eq(menu3.effortValueEl.textContent, "High", "[14] 还原的是颜色，文字始终是官方自己的");

  // 认不出 class 时退到结构判定：最后一个有文字的 span
  const again = await setup();
  const valueEl = again.menu.effortValueEl;
  valueEl.className = "";
  eq(internals.findValueElement(again.menu.effortRow), valueEl, "[14] class 认不出时退到结构判定（最后一个有文字的 span）");
  ok(internals.findValueElement(null) === null, "[14] 传 null 不抛错");
}

section("15. 收起态模型席按钮上的档位（点开之前就看得见）");
{
  const H = 2 / 3;
  // 关键场景：菜单**没打开**（aria-expanded=false）—— 滑条此时不注入，但席上的档位文字照样着色
  const closed = await setup({ menu: { open: false } });
  eq(closed.menu.seatEffortEl.textContent, "High", "[15] 席按钮上的档位文字没被动过");
  eq(closed.menu.seatEffortEl.style.color, closed.internals.valueColorFor(H), "[15] 点开之前就按位置着色了（菜单未展开）");
  ok(!closed.menu.seatLabelEl.style.color, "[15] 席上的模型名（DeepSeek-V41-Flash）颜色不动");
  eq(closed.menu.seatLabelEl.textContent, "DeepSeek-V41-Flash", "[15] 模型名文字没被动过");
  ok(closed.react.find("track") === null, "[15] 菜单没打开时不注入滑条（前置条件，说明上面那条不是靠滑条生效的）");

  // 打开菜单后：拖动改档位 → 菜单里的数值跟着草稿、席上的档位跟已生效
  const { react, internals, menu, bundle, document } = await setup();

  // 拖动中：官方席显示的是**已生效**档位，所以它的颜色不该跟着草稿跑
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[15] 菜单里那一行跟着草稿变成 Max 色");
  eq(menu.seatEffortEl.style.color, internals.valueColorFor(H), "[15] 席按钮仍按已生效档位着色（拖动中不乱跳）");
  track(react).fire("onPointerUp", {});
  await settle();
  eq(menu.seatEffortEl.style.color, "rgb(139,92,246)", "[15] 提交后席按钮跟上 Max 色");
  eq(menu.seatEffortEl.textContent, "High", "[15] 文字仍然由官方自己管（我们只改颜色）");

  // 官方重渲染换了那个节点 → 桥要重新抓到并补色
  const oldEl = menu.seatEffortEl;
  const parent = oldEl.parentNode;
  parent.removeChild(oldEl);
  const newNode = document.createElement("span");
  newNode.className = "wq12jW_triggerEffort";
  newNode.textContent = "High";
  parent.appendChild(newNode);
  bundle.flushObservers();
  await settle();
  eq(newNode.style.color, "rgb(139,92,246)", "[15] 官方换了节点后，新节点也被着色（桥重新抓取）");
  eq(oldEl.style.color ?? "", "", "[15] 旧节点被还原后才放手（不留改动）");

  // 卸载组件 → 还原席按钮的颜色
  react.unmount();
  await settle();
  eq(newNode.style.color ?? "", "", "[15] 组件卸载后席按钮颜色被还原");

  // 认文字：给错的名字就不动（fail-open，绝不误伤别的文字）
  const other = await setup();
  ok(internals.findSeatEffort(other.document, other.menu.composer, "Max") === null, "[15] 名字对不上就返回 null（不猜、不乱改）");
  ok(internals.findSeatEffort(other.document, other.menu.composer, "") === null, "[15] 名字为空也不动");
  ok(internals.findSeatEffort(null, other.menu.composer, "High") === null, "[15] 传 null 不抛错");
  eq(internals.findSeatEffort(other.document, other.menu.composer, "DeepSeek-V41-Flash"), other.menu.seatLabelEl, "[15] 按文字精确命中（模型名也认得出来，但我们只用档位名）");
}

section("16. Off 档保持官方灰 + 刻度点更小更淡");
{
  const { internals } = await setup();
  const OFF = { id: "off", name: "Off" };
  const LOW = { id: "low", name: "Low" };
  // 判定：id 与 name 都认，大小写/空格不敏感，认不出就算普通档位（照常着色）
  ok(internals.isOffLevel(OFF), "[16] id/name 为 off 的档位被认出来");
  ok(internals.isOffLevel({ id: "OFF" }), "[16] 大小写不敏感");
  ok(internals.isOffLevel({ name: "  off " }), "[16] 空格不敏感");
  ok(internals.isOffLevel({ name: "关闭" }), "[16] 中文同义写法也认");
  ok(!internals.isOffLevel(LOW), "[16] Low 不是 off 档");
  ok(!internals.isOffLevel(null) && !internals.isOffLevel(undefined), "[16] 空值不误判");
  // 颜色：off 档给空串 = 不写内联色 = 官方原本的灰
  eq(internals.valueColorFor(0, OFF), "", "[16] off 档 → 空串（不写内联色，保持官方灰）");
  eq(internals.valueColorFor(0, LOW), "rgb(77,147,248)", "[16] 首档不是 off（比如只有 Low/High/Max）时照常给蓝");
  eq(internals.valueColorFor(1, OFF), "", "[16] 即便位置在最右，只要档位是 off 就是灰的");

  // 真场景：当前档位 = off，且席按钮上也写着 Off
  const off = await setup({ host: { effort: "off" }, menu: { effortLabel: "Off" } });
  eq(off.react.find("root").getAttribute("data-energy"), "0", "[16] off 档没有能量层（纯蓝、无星云无粒子）");
  eq(off.react.findAll("particle").length, 0, "[16] off 档没有粒子");
  eq(off.menu.effortValueEl.style.color, "", "[16] 菜单里那一行的数值文字：灰（不写内联色）");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 收起态席按钮上的档位文字：灰（不写内联色）");
  eq(off.menu.effortValueEl.textContent, "Off", "[16] 文字内容仍然是官方的");
  ok(!off.menu.seatLabelEl.style.color, "[16] 模型名依旧不动");
  // 拖到 Max 就恢复着色（确认"灰"只发生在 off 档）
  track(off.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(off.menu.effortValueEl.style.color, "rgb(139,92,246)", "[16] 拖到 Max：菜单里那一行先变紫罗兰");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 席按钮按已生效档位（仍是 off）→ 还是灰的");
  track(off.react).fire("onPointerUp", {});
  await settle();
  eq(off.menu.seatEffortEl.style.color, "rgb(139,92,246)", "[16] 提交后席按钮也变成紫罗兰");

  // 刻度点：更小更淡
  const tickCss = internals.CSS.slice(internals.CSS.indexOf(".ces-tick{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-tick{")));
  ok(tickCss.indexOf("width:3px;height:3px") > 0, "[16] 刻度点 5px → 3px（更小）");
  ok(tickCss.indexOf("26%,transparent") > 0, "[16] 未达到的刻度 38% → 26%（更淡）");
  ok(internals.CSS.indexOf(".ces-tick[data-on='1']{background:rgba(255,255,255,.5)}") > 0, "[16] 已达刻度 92% → 50% 白（更淡，不再和星星抢眼）");
  const tickNodes = off.react.findAll("tick");
  ok(tickNodes.length >= 4, `[16] 4 档就有 4 个刻度点（实测 ${tickNodes.length}）`);
}

/* ══════════════════════════════════════════════════════════════════════ */

section("17. 松手吸附 + 弹性落档：缓动与位置（纯函数）");
{
  const { internals } = await setup();
  eq(internals.snapEaseFor(0), 0, "[17] 缓动起点正好是 0");
  eq(internals.snapEaseFor(1), 1, "[17] 缓动终点正好是 1（末帧落在精确刻度上）");
  eq(internals.snapEaseFor(-3), 0, "[17] 进度越界往下被夹住");
  eq(internals.snapEaseFor(9), 1, "[17] 进度越界往上被夹住");
  eq(internals.snapEaseFor(1, true), 1, "[17] reduced：终点仍是 1");

  // 回弹幅度：扫一遍曲线取峰值，必须**正好**等于 SNAP_OVERSHOOT（二分解出的 c 对得上）
  let peak = 0;
  let peakReduced = 0;
  for (let i = 0; i <= 400; i += 1) {
    const u = i / 400;
    peak = Math.max(peak, internals.snapEaseFor(u, false));
    peakReduced = Math.max(peakReduced, internals.snapEaseFor(u, true));
  }
  near(peak - 1, internals.SNAP_OVERSHOOT, "[17] 回弹幅度 = SNAP_OVERSHOOT（改一个常量就够，不是双份真相）", 0.002);
  ok(peak > 1.05, "[17] 确实「弹」出去了（不是普通 ease-out）");
  ok(peakReduced <= 1 + 1e-9, `[17] reduced 一点回弹都没有（峰值 ${peakReduced.toFixed(4)}）`);
  near(internals.snapBackOvershootFor(internals.SNAP_BACK_C1), internals.SNAP_OVERSHOOT, "[17] 回弹幅度公式与反解出的 c 自洽", 1e-9);

  eq(internals.snapDurationFor(false), internals.SNAP_DURATION_MS, "[17] 正常时长 = SNAP_DURATION_MS");
  eq(internals.snapDurationFor(true), internals.SNAP_DURATION_REDUCED_MS, "[17] reduced 时长 = SNAP_DURATION_REDUCED_MS");
  ok(internals.SNAP_DURATION_REDUCED_MS < internals.SNAP_DURATION_MS, "[17] reduced 的落档更短");

  const D = internals.SNAP_DURATION_MS;
  eq(internals.settlePctFor(0.1, 0.5, 0, false), 0.1, "[17] 第 0 毫秒 = 松手位置（画面不跳）");
  eq(internals.settlePctFor(0.1, 0.5, D, false), 0.5, "[17] 到时长 = 目标刻度");
  eq(internals.settlePctFor(0.1, 0.5, D * 100, false), 0.5, "[17] 超时也只停在目标（收口，不会飘）");
  ok(internals.settlePctFor(0.98, 1, D * 0.6, false) <= 1, "[17] 右端档位：回弹冲过 1 被夹回 1（旋钮不出轨）");
  ok(internals.settlePctFor(0.02, 0, D * 0.6, false) >= 0, "[17] 左端档位同理");
  ok(internals.settlePctFor(0, 1, D * 0.58, false) === 1, "[17] 0→1 这种整轨行程：过冲部分被 clamp 在 1（旋钮顶到端点就停住）");
  ok(internals.settlePctFor(0.1, 0.5, D * 0.58, false) > 0.5, "[17] 但档位之间的落档是**允许过冲**的（否则就不叫弹性落档）");
  ok(internals.snapEaseFor(0.58) > 1, "[17] 过冲来自缓动曲线本身（峰值不在两端）");
}

section("17b. 松手 → 逐帧弹性吸附到最近档位（真组件 + 真动画器）");
{
  const s = await setup();
  // 松手在 16.9%：最近档位是 index 1（low，刻度 1/3），行程 0.164 → 回弹峰值约 0.350
  track(s.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  await settle();
  eq(s.react.find("root").getAttribute("data-dragging"), "1", "[17b] 拖动期间 data-dragging=1（那两层 opacity 过渡被关掉）");
  eq(s.react.find("root").getAttribute("data-settling"), "0", "[17b] 拖动期间没有落档动画（只有草稿）");
  eq(knobPct(s.react), 0.1691, "[17b] 拖动中旋钮严格跟手（连续，不吸附）");

  track(s.react).fire("onPointerUp", {});
  await settle();
  eq(s.react.find("root").getAttribute("data-dragging"), "0", "[17b] 草稿交棒给动画");
  eq(s.react.find("root").getAttribute("data-settling"), "1", "[17b] 松手立刻进入落档动画");
  eq(s.host.selects.length, 1, "[17b] 写回在动画开始前就发出去了（时机与旧版一致）");
  eq(s.host.selects[0].reasoningEffort, "low", "[17b] 写回的就是吸附到的那个档位");

  const seq = [knobPct(s.react)];
  for (let i = 0; i < 30; i += 1) {
    await s.step(16);
    seq.push(knobPct(s.react));
  }
  const target = 1 / 3;
  near(seq[0], 0.1691, "[17b] 动画首帧就是松手位置（不从别处开始）", 1e-4);
  const peakSeen = Math.max(...seq);
  ok(peakSeen > target + 0.008, `[17b] 冲过目标档位再弹回来（峰值 ${peakSeen.toFixed(4)} > 刻度 ${target.toFixed(4)}）`);
  ok(peakSeen <= 1, "[17b] 回弹不出轨道");
  ok(seq[seq.length - 1] < peakSeen, "[17b] 末段是**回落**到刻度（不是停在冲过的那里）");
  near(seq[seq.length - 1], target, "[17b] 最终精确停在最近档位刻度上", 1e-4);
  eq(s.react.find("root").getAttribute("data-settling"), "0", "[17b] 动画收工后落档状态被摘掉");
  eq(s.react.find("track").getAttribute("aria-valuetext"), "Low", "[17b] 读数就是吸附到的档位");
  eq(s.pendingFrames(), 0, "[17b] 收工后不再排帧（不空转）");
  eq(s.host.selects.length, 1, "[17b] 整段动画期间一次多余写回都没有");
  // 落档全程旋钮圆心都在 [14px, 宽度-14px] 内（几何内缩，靠 left 的 calc 形状保证）
  ok(String(s.react.find("knob").style.left).indexOf("calc(14px + ") === 0, "[17b] 落档用的是同一套内缩几何");
}

section("17c. 落档途中再按下 → 立刻取消，草稿接管");
{
  const c = await setup();
  track(c.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(c.react).fire("onPointerUp", {});
  await settle();
  eq(c.react.find("root").getAttribute("data-settling"), "1", "[17c] 先有一段落档在跑");
  await c.step(80);
  const midway = knobPct(c.react);
  ok(midway !== null && midway !== 0.1691 && midway !== 0.3333, `[17c] 中途确实停在两者之间（${midway}）`);
  const cancelsBefore = c.rafCalls.cancel;

  track(c.react).fire("onPointerDown", { clientX: 290, pointerId: 1 });
  await settle();
  eq(c.react.find("root").getAttribute("data-settling"), "0", "[17c] 按下即取消落档");
  eq(knobPct(c.react), 1, "[17c] 显示立刻跟手到手指位置（草稿接管，不被动画拽回去）");
  ok(c.rafCalls.cancel > cancelsBefore, "[17c] 挂着的帧被 cancelAnimationFrame 撤掉");
  eq(c.pendingFrames(), 0, "[17c] 没有残留的帧");
}

section("17d. 键盘换档同样弹性落档；初次挂载不做动画");
{
  const k = await setup();
  eq(k.react.find("root").getAttribute("data-settling"), "0", "[17d] 初次挂载：不做动画（直接显示生效档位）");
  near(knobPct(k.react), 2 / 3, "[17d] 初始位置 = 当前档位 high 的刻度", 1e-4);

  track(k.react).fire("onKeyDown", { key: "ArrowRight" });
  await settle();
  eq(k.react.find("root").getAttribute("data-settling"), "1", "[17d] 方向键换档也有落档动画");
  near(knobPct(k.react), 2 / 3, "[17d] 从当前显示位置起步", 1e-4);
  await k.advance(480);
  eq(k.react.find("root").getAttribute("data-settling"), "0", "[17d] 动画收工");
  near(knobPct(k.react), 1, "[17d] 停在最高档刻度", 1e-4);

  // Home/End 走同一套
  track(k.react).fire("onKeyDown", { key: "Home" });
  await settle();
  await k.advance(480);
  near(knobPct(k.react), 0, "[17d] Home 也弹性落到最低档", 1e-4);
}

section("17e. 写回失败回滚 → 落档动画从当前位置改道到真实档位");
{
  const r = await setup({
    host: { select: async () => ({ ok: false, error: { code: "session/writer-held", message: "session is held" } }) },
  });
  track(r.react).fire("onPointerDown", { clientX: 272, pointerId: 1 }); // 94.9% → max（当前是 high）
  track(r.react).fire("onPointerUp", {});
  await settle();
  eq(r.react.find("root").getAttribute("data-settling"), "1", "[17e] 落档先按用户选的 max 开始");
  await r.step(64); // 动画走到中途
  await settle(8);  // 让失败的 select 落地 → 乐观值回滚
  ok(r.react.find("error") !== null, "[17e] 失败原因照旧显示出来（不谎报成功）");
  eq(r.react.find("track").getAttribute("aria-valuetext"), "High", "[17e] 读数回滚到真实档位 high");
  eq(r.react.find("root").getAttribute("data-settling"), "1", "[17e] 回滚后动画还在（改道，而不是闪一下跳过去）");
  await r.advance(720);
  eq(r.react.find("root").getAttribute("data-settling"), "0", "[17e] 改道后的动画也会收工");
  near(knobPct(r.react), 2 / 3, "[17e] 最终停在**真实**档位刻度（不是用户点的 max）", 1e-4);
}

section("17f. 「减少动态效果」：更短、且不回弹");
{
  const rm = await setup({ reducedMotion: true });
  eq(rm.react.find("root").getAttribute("data-motion"), "reduced", "[17f] 标记成 reduced");
  track(rm.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(rm.react).fire("onPointerUp", {});
  await settle();
  eq(rm.react.find("root").getAttribute("data-settling"), "1", "[17f] 照样有落档（放缓而不是砍掉）");
  let peak = knobPct(rm.react);
  for (let i = 0; i < 8; i += 1) {
    await rm.step(16);
    peak = Math.max(peak, knobPct(rm.react));
  }
  ok(peak <= 1 / 3 + 1e-4, `[17f] 全程不过冲（峰值 ${peak.toFixed(4)} ≤ 刻度 ${(1 / 3).toFixed(4)}）`);
  eq(rm.react.find("root").getAttribute("data-settling"), "1", "[17f] 180ms 的动画在 128ms 时还没跑完");
  await rm.advance(200);
  eq(rm.react.find("root").getAttribute("data-settling"), "0", "[17f] 用更短的时长收工");
  near(knobPct(rm.react), 1 / 3, "[17f] 一样精确落在刻度上", 1e-4);
}

section("17g. 没有 requestAnimationFrame 时的回退与降级（fail-open）");
{
  // 回退一：没有 rAF → setTimeout 顶（这里连假时钟也关掉，走真实时间）
  const fb = await setup({ raf: false, fakeClock: false });
  const t0 = Date.now();
  track(fb.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(fb.react).fire("onPointerUp", {});
  await settle();
  eq(fb.react.find("root").getAttribute("data-settling"), "1", "[17g] 没有 rAF 也有落档（setTimeout 回退）");
  await wait(560);
  await settle(4);
  eq(fb.react.find("root").getAttribute("data-settling"), "0", "[17g] 真实时间下也走完");
  near(knobPct(fb.react), 1 / 3, "[17g] 一样精确停在刻度上", 1e-4);
  ok(Date.now() - t0 >= 380, "[17g] 确实花掉了动画时长（不是瞬跳）");

  // 回退二：动画器本身没有 rAF 也没有 setTimeout → 瞬时落到目标，功能不受影响
  const { internals } = await setup();
  const frames = [];
  const plain = internals.createSnapAnimator({
    win: null,
    setTimeout: null,
    clearTimeout: null,
    now: () => 0,
    onFrame: (pct, index) => frames.push([pct, index]),
    onDone: (index) => frames.push(["done", index]),
  });
  plain.start({ from: 0.2, to: 0.75, index: 3 });
  eq(JSON.stringify(frames), JSON.stringify([[0.2, 3], [0.75, 3], ["done", 3]]), "[17g] 无计时能力 → 首帧+目标帧+收工，一步到位（退化成旧行为）");
}

section("17h. 卸载时取消动画（不在卸载后 setState）");
{
  const u = await setup();
  track(u.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(u.react).fire("onPointerUp", {});
  await settle();
  eq(u.react.find("root").getAttribute("data-settling"), "1", "[17h] 卸载前有动画在跑");
  const cancelsBefore = u.rafCalls.cancel;
  u.react.unmount();
  ok(u.rafCalls.cancel > cancelsBefore, "[17h] 卸载时取消挂着的帧");
  eq(u.pendingFrames(), 0, "[17h] 帧队列清空（不会再回调组件）");
}

section("17i. 落档动画是纯视觉：不碰写回、不碰官方文字");
{
  const v = await setup();
  const before = {
    label: v.menu.effortLabelEl.textContent,
    value: v.menu.effortValueEl.textContent,
    rowPadding: cssValue(v.menu.effortRow, "paddingTop"),
  };
  track(v.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(v.react).fire("onPointerUp", {});
  await settle();
  await v.advance(480);
  eq(v.menu.effortLabelEl.textContent, before.label, "[17i] 动画期间官方 label 文字一个字没动");
  eq(v.menu.effortValueEl.textContent, before.value, "[17i] 官方数值文字也没动（我们只改颜色）");
  eq(cssValue(v.menu.effortRow, "paddingTop"), before.rowPadding, "[17i] 那一行的内联样式仍然是插件写的那 4 个（没被动画改花）");
  const officialSpans = v.menu.effortRow.children.filter((child) => child.tagName === "SPAN");
  eq(officialSpans.length, 2, "[17i] 官方两个 span 仍然只有两个");

  // 拖动中抑制过渡、落档时保留：CSS 契约也断言一下
  const { internals } = await setup();
  ok(
    internals.CSS.indexOf(".ces-inline[data-dragging='1'] .ces-energy,.ces-inline[data-dragging='1'] .ces-stars{transition:none}") > 0,
    "[17i] 拖动中关掉能量/星星的 opacity 过渡（跟手要脆）",
  );
}

/* ══════════════════════════════════════════════════════════════════════ */

section("18. 纯函数：模型切换目标（只在 flash/pro 之间）与滚轮归一化");
{
  const { internals } = await setup();
  const catalog = (id, ids = ["deepseek-v41-flash", "deepseek-v4-pro"]) => ({
    current: { provider: "deepseek", model: id },
    groups: [{ id: "deepseek", models: ids.map((each) => ({ id: each })) }],
  });

  eq(internals.toggleModelFor(catalog("deepseek-v41-flash")).model, "deepseek-v4-pro", "[18] flash → pro");
  eq(internals.toggleModelFor(catalog("deepseek-v4-pro")).model, "deepseek-v41-flash", "[18] pro → flash");
  eq(
    JSON.stringify(internals.toggleModelFor(catalog("deepseek-v41-flash"))),
    JSON.stringify({ provider: "deepseek", model: "deepseek-v4-pro" }),
    "[18] 载荷只有 provider/model（与官方模型行同款，不含 effort）",
  );
  eq(internals.toggleModelFor(catalog("third-model")).model, "deepseek-v41-flash", "[18] 当前是第三个模型 → 优先落到 Flash");
  eq(internals.toggleModelFor(catalog("DeepSeek-V41-FLASH")).model, "deepseek-v4-pro", "[18] id 匹配大小写不敏感");
  eq(internals.toggleModelFor(catalog("deepseek-v41-flash", ["deepseek-v41-flash"])), null, "[18] 目录里没有 Pro → 什么都不做");
  eq(internals.toggleModelFor(catalog("solo", ["solo"])), null, "[18] 两个关键词都认不出 → 什么都不做");
  eq(internals.toggleModelFor(catalog("deepseek-v4-pro", ["deepseek-v4-pro"])), null, "[18] 只有 Pro 且当前就是它 → 什么都不做");
  eq(internals.toggleModelFor({ current: { provider: "other", model: "deepseek-v41-flash" }, groups: catalog("x").groups }), null, "[18] provider 对不上 → 什么都不做");
  eq(internals.toggleModelFor(null), null, "[18] 空快照不抛错");
  eq(internals.toggleModelFor({}), null, "[18] 没有 current 不抛错");

  eq(internals.wheelNotchesFor({ deltaY: -100, deltaMode: 0 }), -1, "[18] 像素模式：100px = 1 格（向上为负）");
  eq(internals.wheelNotchesFor({ deltaY: 50, deltaMode: 0 }), 0.5, "[18] 像素模式：半格给累积器留小数");
  eq(internals.wheelNotchesFor({ deltaY: 3, deltaMode: 1 }), 1, "[18] 行模式：3 行 = 1 格");
  eq(internals.wheelNotchesFor({ deltaY: -6, deltaMode: 1 }), -2, "[18] 行模式：6 行 = 2 格（负）");
  eq(internals.wheelNotchesFor({ deltaY: -1, deltaMode: 2 }), -1, "[18] 页模式：一个事件算一格");
  eq(internals.wheelNotchesFor({ deltaY: 0 }), 0, "[18] 零增量 → 0 格");
  eq(internals.wheelNotchesFor({}), 0, "[18] 没有 deltaY → 0 格");
  eq(internals.wheelNotchesFor(null), 0, "[18] null 不抛错");
}

section("18b. 键盘：←/→ 步进调档位（钳制不环绕），↑/↓ 切 Flash/Pro");
{
  const s = await setup(); // flash + 默认 high（index 2）
  const key = (name) => track(s.react).fire("onKeyDown", { key: name });
  const reads = () => s.react.find("track").getAttribute("aria-valuetext");
  const last = () => s.host.selects[s.host.selects.length - 1];
  const modelOps = () => s.host.selects.filter((entry) => entry.reasoningEffort === undefined);
  const effortOps = () => s.host.selects.filter((entry) => entry.reasoningEffort !== undefined);

  eq(reads(), "High", "[18b] 起点：Flash + High（默认档）");
  ok(String(s.react.find("track").getAttribute("title")).indexOf("←/→ 调档位") > 0, "[18b] title 里写明键位（可发现性）");
  eq(
    s.react.find("track").getAttribute("aria-keyshortcuts"),
    "ArrowLeft ArrowRight ArrowUp ArrowDown Home End",
    "[18b] aria-keyshortcuts 声明键位",
  );

  key("ArrowRight");
  await settle();
  eq(last().reasoningEffort, "max", "[18b] → 升一档 = Max");
  eq(reads(), "Max", "[18b] 读数跟着");
  const atMax = s.host.selects.length;
  key("ArrowRight");
  await settle();
  eq(s.host.selects.length, atMax, "[18b] 已到最高档：再按 → **不写回**（钳制，不环绕到 Off）");
  eq(reads(), "Max", "[18b] 仍然停在 Max");

  key("Home");
  await settle();
  eq(last().reasoningEffort, "off", "[18b] Home 跳最低档（保留原行为）");
  const atMin = s.host.selects.length;
  key("ArrowLeft");
  await settle();
  eq(s.host.selects.length, atMin, "[18b] 已到最低档：再按 ← 不写回（不环绕到 Max）");
  eq(reads(), "Off", "[18b] 仍然停在 Off");
  key("ArrowRight");
  await settle();
  eq(last().reasoningEffort, "low", "[18b] 从 Off 升一档只走一格 = Low");
  key("End");
  await settle();
  eq(last().reasoningEffort, "max", "[18b] End 跳最高档（保留原行为）");
  await s.advance(520); // 先让落档动画收工，下面才能干净地断言"切模型不播动画"
  eq(s.react.find("root").getAttribute("data-settling"), "0", "[18b] 落档已收工（前置条件）");

  // ↑/↓ 切模型：不动档位、不播落档动画
  const effortBefore = effortOps().length;
  const framesBeforeSwitch = s.pendingFrames(); // 可能已有水面"排水"帧在跑，所以看**增量**
  key("ArrowUp");
  await settle();
  eq(modelOps().length, 1, "[18b] ↑ 走了一次模型 select");
  eq(
    JSON.stringify(modelOps()[0]),
    JSON.stringify({ provider: "deepseek", model: "deepseek-v4-pro" }),
    "[18b] 模型载荷逐字 = {provider, model}（**不带** reasoningEffort）",
  );
  eq(s.host.store.getSnapshot().current.model, "deepseek-v4-pro", "[18b] 宿主已经切到 Pro");
  eq(s.host.store.getSnapshot().current.reasoningEffort, "max", "[18b] 档位原样保留（Pro+Max 也照旧，要降自己按 ←）");
  eq(reads(), "Max", "[18b] 滑条读数不变（两个模型同一份 4 档）");
  eq(s.react.find("root").getAttribute("data-settling"), "0", "[18b] 切模型**不播**落档动画");
  ok(s.pendingFrames() <= framesBeforeSwitch, "[18b] 也没有为切模型新增动画帧（已有的水面排水不算）");

  key("ArrowDown");
  await settle();
  eq(s.host.store.getSnapshot().current.model, "deepseek-v41-flash", "[18b] ↓ 切回 Flash");
  eq(modelOps().length, 2, "[18b] 又是一次模型 select");
  eq(effortOps().length, effortBefore, "[18b] ↑/↓ 全程没有改动过档位写回");
}

section("18c. 滚轮：一格一档、端点钳制、归一化、吞掉事件");
{
  const w = await setup();
  const wheel = (deltaY, deltaMode = 0, target = null) => {
    const event = { deltaY, deltaMode, prevented: 0, stopped: 0 };
    event.preventDefault = function () { event.prevented += 1; };
    event.stopPropagation = function () { event.stopped += 1; };
    (target ?? w.react.find("host")).dispatch("wheel", event);
    return event;
  };
  const reads = () => w.react.find("track").getAttribute("aria-valuetext");

  eq(reads(), "High", "[18c] 起点 High（index 2）");
  const up = wheel(-120);
  await settle(4);
  eq(reads(), "Max", "[18c] 向上滚一格 = 升一档");
  eq(up.prevented, 1, "[18c] 事件被 preventDefault（滑条上的滚轮不会连带滚页面/菜单）");
  eq(up.stopped, 1, "[18c] 也被 stopPropagation");
  await wait(180);
  eq(w.host.selects[w.host.selects.length - 1].reasoningEffort, "max", "[18c] 而且写回了宿主");

  const down = wheel(120);
  await settle(4);
  eq(reads(), "High", "[18c] 向下滚一格 = 降一档");
  eq(down.prevented, 1, "[18c] 照样吞掉");
  await wait(180);

  // 半格不够：先吞不给档，攒够一格才走
  const half = wheel(50);
  await settle(4);
  eq(half.prevented, 1, "[18c] 半格也吞掉（免得手势半路跑去滚页面）");
  eq(reads(), "High", "[18c] 但半格不换档");
  wheel(50);
  await settle(4);
  eq(reads(), "Low", "[18c] 第二个半格攒成一格 → 降一档");
  await wait(180);

  // 一次事件最多一步：600px 也只走一格（"Pro 的 Max 很贵"的防护）
  const beforeBurst = w.host.selects.length;
  wheel(600);
  await settle(4);
  eq(reads(), "Off", "[18c] 一次滚 600px 也只走一档（绝不跨档跳跃）");
  await wait(180);
  ok(w.host.selects.length - beforeBurst <= 1, `[18c] 也最多只写回 1 次（实测 ${w.host.selects.length - beforeBurst}）`);

  // 端点钳制：最低档再往下滚，不环绕
  const atMin = w.host.selects.length;
  const beyond = wheel(120);
  await settle(4);
  eq(reads(), "Off", "[18c] 已是最低档：继续下滚仍是 Off（不环绕到 Max）");
  eq(beyond.prevented, 1, "[18c] 但事件照样吞掉（滚轮在滑条上始终不滚页面）");
  await wait(180);
  eq(w.host.selects.length, atMin, "[18c] 也没产生多余的写回");

  // 行模式 / 页模式（行模式：向上 = 负 deltaY）
  const lines = await setup();
  const lineEvent = { deltaY: -3, deltaMode: 1, prevented: 0 };
  lineEvent.preventDefault = function () { lineEvent.prevented += 1; };
  lineEvent.stopPropagation = function () {};
  lines.react.find("host").dispatch("wheel", lineEvent);
  await settle(4);
  eq(lines.react.find("track").getAttribute("aria-valuetext"), "Max", "[18c] 行模式：3 行 = 一格 = 升一档");
  const pages = await setup();
  const pageEvent = { deltaY: 1, deltaMode: 2, prevented: 0 };
  pageEvent.preventDefault = function () { pageEvent.prevented += 1; };
  pageEvent.stopPropagation = function () {};
  pages.react.find("host").dispatch("wheel", pageEvent);
  await settle(4);
  eq(pages.react.find("track").getAttribute("aria-valuetext"), "Low", "[18c] 页模式：一个事件 = 一格 = 降一档");

  // 连滚合并：触控板连续 6 格只打一次后端
  const burst = await setup();
  for (let i = 0; i < 6; i += 1) {
    const event = { deltaY: 120, deltaMode: 0 };
    event.preventDefault = function () {};
    event.stopPropagation = function () {};
    burst.react.find("host").dispatch("wheel", event);
  }
  await wait(220);
  eq(burst.react.find("track").getAttribute("aria-valuetext"), "Off", "[18c] 连滚 6 格：一档一档走到 Off 并钳住");
  ok(burst.host.selects.length <= 2, `[18c] 6 格连滚只写回 ${burst.host.selects.length} 次（限频 + 在途合并）`);

  // 拖动中：滚轮完全不参与
  const drag = await setup();
  const dragNode = track(drag.react);
  dragNode.fire("onPointerDown", { clientX: 152, pointerId: 1 });
  await settle(2);
  const duringDrag = { deltaY: 120, deltaMode: 0, prevented: 0 };
  duringDrag.preventDefault = function () { duringDrag.prevented += 1; };
  duringDrag.stopPropagation = function () {};
  drag.react.find("host").dispatch("wheel", duringDrag);
  eq(duringDrag.prevented, 0, "[18c] 拖动中：滚轮不参与（也不吞事件）");
  eq(knobPct(drag.react), 0.5074, "[18c] 拖动中滚轮不改位置（还是手指的位置）");

  // locked：不换档、也不吞事件
  const locked = await setup({ props: { locked: true } });
  const lockedEvent = { deltaY: 120, deltaMode: 0, prevented: 0 };
  lockedEvent.preventDefault = function () { lockedEvent.prevented += 1; };
  lockedEvent.stopPropagation = function () {};
  locked.react.find("host").dispatch("wheel", lockedEvent);
  await settle(4);
  eq(lockedEvent.prevented, 0, "[18c] locked：不吞事件（页面照常滚）");
  eq(locked.host.selects.length, 0, "[18c] locked：滚轮不换档");
  track(locked.react).fire("onKeyDown", { key: "ArrowUp" });
  await settle();
  eq(locked.host.selects.length, 0, "[18c] locked：↑ 也不切模型");
}

section("18d. 切模型的失败与合并（模型不做乐观；与档位共用一条管线）");
{
  // 目录里没有 flash/pro → 上下键什么都不做（fail-open），档位键照常
  const solo = {
    id: "solo-model",
    name: "Solo",
    reasoning: {
      defaultEffort: "high",
      efforts: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }],
    },
  };
  const f = await setup({ host: { model: solo, models: [solo] } });
  track(f.react).fire("onKeyDown", { key: "ArrowUp" });
  await settle();
  eq(f.host.selects.length, 0, "[18d] 认不出 flash/pro → ↑ 什么都不做");
  track(f.react).fire("onKeyDown", { key: "ArrowLeft" });
  await settle();
  eq(f.host.selects.length, 1, "[18d] 但 ←/→ 照常可用");
  eq(f.host.selects[0].reasoningEffort, "low", "[18d] 也照常走官方档位载荷");

  // 切模型失败 → 报错、不乐观、不播动画
  const r = await setup({
    host: { select: async () => ({ ok: false, error: { code: "session/writer-held", message: "session is held" } }) },
  });
  track(r.react).fire("onKeyDown", { key: "ArrowUp" });
  await settle(8);
  ok(r.react.find("error") !== null, "[18d] 切模型失败 → 显示原因（不谎报成功）");
  ok(String(r.react.find("error").textContent).indexOf("session is held") >= 0, "[18d] 错误里带宿主给的原始原因");
  eq(r.host.store.getSnapshot().current.model, "deepseek-v41-flash", "[18d] 仍然是 Flash（模型不做乐观显示）");
  eq(r.react.find("root").getAttribute("data-settling"), "0", "[18d] 失败也没有落档动画");

  // 在途合并：切模型挂起时按键降档 → 落地后补发那一次档位写回
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const m = await setup({
    host: {
      select: async (selection, store) => {
        calls += 1;
        if (calls === 1) await gate;
        const snapshot = store.getSnapshot();
        const current = { ...snapshot.current };
        if (typeof selection.model === "string") current.model = selection.model;
        if (selection.reasoningEffort !== undefined) current.reasoningEffort = selection.reasoningEffort;
        store.set({ ...snapshot, current });
        return { ok: true };
      },
    },
  });
  track(m.react).fire("onKeyDown", { key: "ArrowUp" });
  await settle(4);
  eq(m.host.selects.length, 1, "[18d] 切模型已发出并挂起");
  track(m.react).fire("onKeyDown", { key: "ArrowLeft" });
  await settle(4);
  eq(m.host.selects.length, 1, "[18d] 在途期间不并发第二个写（合并，而不是排队打宿主）");
  release();
  await settle(14);
  eq(m.host.selects.length, 2, "[18d] 在途落地后补发攒下的那一件");
  eq(m.host.selects[1].reasoningEffort, "low", "[18d] 补发的正是那一档");
  eq(m.host.selects[1].model, "deepseek-v4-pro", "[18d] 用的是切过去的那个模型（provider/model 一致）");
  eq(m.host.store.getSnapshot().current.model, "deepseek-v4-pro", "[18d] 模型也切过去了");

  // 第二道闸：排队里的模型目标在途落地时已经达成 → 不再重复写
  let release2 = () => {};
  const gate2 = new Promise((resolve) => { release2 = resolve; });
  let seen2 = 0;
  const d = await setup({
    host: {
      select: async (selection, store) => {
        seen2 += 1;
        if (seen2 === 1) await gate2;
        const snapshot = store.getSnapshot();
        const current = { ...snapshot.current };
        if (typeof selection.model === "string") current.model = selection.model;
        if (selection.reasoningEffort !== undefined) current.reasoningEffort = selection.reasoningEffort;
        store.set({ ...snapshot, current });
        return { ok: true };
      },
    },
  });
  track(d.react).fire("onKeyDown", { key: "ArrowUp" });
  await settle(4);
  track(d.react).fire("onKeyDown", { key: "ArrowUp" }); // 宿主还没回报，目标仍是 Pro
  await settle(4);
  release2();
  await settle(14);
  eq(d.host.selects.length, 1, "[18d] 同一目标不重复写（去重的第二道闸在 flush 里）");
  eq(d.host.store.getSnapshot().current.model, "deepseek-v4-pro", "[18d] 目标达成了一次就够");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("19. 键盘在**菜单级别**也生效（打开菜单就行，不必先点滑条）");
{
  const s = await setup();
  const doc = s.document;
  const last = () => s.host.selects[s.host.selects.length - 1];

  /** 派发一个 document 级 keydown（模拟"焦点在官方菜单里别处"）。 */
  const press = (key, target) => {
    const event = { key, target, prevented: 0, stopped: 0 };
    event.preventDefault = function () { event.prevented += 1; };
    event.stopPropagation = function () { event.stopped += 1; };
    doc.dispatch("keydown", event);
    return event;
  };
  const effortCount = () => s.host.selects.filter((entry) => entry.reasoningEffort !== undefined).length;

  // 前置：菜单级监听必须已经把作用范围记下来（findMenuFor 给出菜单 + 席 + 两行）
  const found = s.internals.findMenuFor(doc, s.menu.composer);
  ok(found !== null && found.menu === s.menu.menu, "[19] findMenuFor 找到菜单（键盘作用范围）");
  eq(found.items.length, 2, "[19] 根面板恰好两行");
  eq(s.internals.findEffortRow(doc, s.menu.composer), s.menu.effortRow, "[19] findEffortRow 契约不变（还是返回那一行）");
  ok(s.internals.effortRowOf(found) === s.menu.effortRow, "[19] effortRowOf 认得出「推理等级」那一行");

  // 1) 目标是官方那一行（焦点在它上面）→ 我们照样处理，并拦住官方菜单
  const right = press("ArrowRight", s.menu.effortRow);
  await settle();
  eq(last().reasoningEffort, "max", "[19] 焦点在官方行上时 → 也升一档（不必先点滑条）");
  eq(right.prevented, 1, "[19] 并且 preventDefault");
  eq(right.stopped, 1, "[19] stopPropagation（官方菜单的 ↑/↓ 移焦点被拦住）");

  // 2) ↑/↓ 在菜单级别切模型
  const beforeModel = s.host.selects.length;
  const up = press("ArrowUp", s.menu.effortRow);
  await settle();
  eq(s.host.store.getSnapshot().current.model, "deepseek-v4-pro", "[19] 焦点在官方行上时 ↑ 也能切模型");
  eq(s.host.selects.length, beforeModel + 1, "[19] 只发一次模型写回");
  eq(up.prevented, 1, "[19] 也吞掉（官方不会同时移焦点）");

  // 3) 焦点还在**触发按钮**上（刚点开菜单）→ 同样生效
  const beforeSeat = effortCount();
  const left = press("ArrowLeft", s.menu.seat);
  await settle();
  eq(effortCount(), beforeSeat + 1, "[19] 焦点在席按钮上时 ← 也降一档");
  eq(left.prevented, 1, "[19] 并吞掉");

  // 4) 目标是**菜单之外**（输入区）→ 一律不接管
  const beforeOutside = s.host.selects.length;
  const outside = press("ArrowRight", s.menu.composer);
  await settle(2);
  eq(s.host.selects.length, beforeOutside, "[19] 菜单外的按键不动档位");
  eq(outside.prevented, 0, "[19] 也不 preventDefault（别处的键盘行为不受影响）");
  eq(outside.stopped, 0, "[19] 也不拦");

  // 5) 不认识的键（Enter/Esc/Tab）放行给官方菜单
  const beforeEnter = s.host.selects.length;
  const enter = press("Enter", s.menu.effortRow);
  await settle(2);
  eq(enter.prevented, 0, "[19] Enter 不接管（官方照旧用它打开那一行）");
  eq(enter.stopped, 0, "[19] 也不拦");
  eq(s.host.selects.length, beforeEnter, "[19] Enter 不产生写回");

  // 6) 输入框里的按键不接管（子面板有搜索框，别抢）
  const input = doc.createElement("input");
  s.menu.menu.appendChild(input);
  const typing = press("ArrowLeft", input);
  eq(typing.prevented, 0, "[19] 输入框里的方向键不接管");
  eq(typing.stopped, 0, "[19] 也不拦");

  // 7) 菜单关了（桥摘掉）→ 键盘作用范围同时失效
  s.menu.close();
  s.bundle.flushObservers();
  await settle();
  const beforeClosed = effortCount();
  const closed = press("ArrowRight", s.menu.effortRow);
  await settle(2);
  eq(effortCount(), beforeClosed, "[19] 菜单关掉后按键不再生效");
  eq(closed.prevented, 0, "[19] 也不拦（这时键盘完全归官方/宿主）");

  // 8) locked 会话：菜单级键盘一律不接管
  const locked = await setup({ props: { locked: true } });
  const lockedEvent = { key: "ArrowRight", target: locked.menu.effortRow, prevented: 0, stopped: 0 };
  lockedEvent.preventDefault = function () { lockedEvent.prevented += 1; };
  lockedEvent.stopPropagation = function () { lockedEvent.stopped += 1; };
  locked.document.dispatch("keydown", lockedEvent);
  await settle(2);
  eq(lockedEvent.prevented, 0, "[19] locked：不接管、不拦（官方菜单照旧）");
  eq(locked.host.selects.length, 0, "[19] locked：不写回");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("20. 旋钮材质：液态玻璃（半透明珠体 + backdrop 折射 + 镜面高光）");
{
  const { internals, react } = await setup();

  // 高光位置：随档位**反向**滑动（滚珠感），并 clamp
  eq(internals.knobHighlightFor(0), "36.0%", "[20] 最低档：镜面高光偏右（36%）");
  eq(internals.knobHighlightFor(0.5), "30.0%", "[20] 中间：30%");
  eq(internals.knobHighlightFor(1), "24.0%", "[20] 最高档：高光偏左（24%）");
  ok(
    parseFloat(internals.knobHighlightFor(1)) < parseFloat(internals.knobHighlightFor(0)),
    "[20] 珠子往右走、高光往左滑（像一颗在滚的玻璃珠）",
  );
  eq(internals.knobHighlightFor(-5), "36.0%", "[20] 越界往下被 clamp");
  eq(internals.knobHighlightFor(9), "24.0%", "[20] 越界往上被 clamp");

  // 渲染时把它写进样式变量（CSS 用 var(--ces-hl,30%) 读）
  eq(
    react.find("knob").style["--ces-hl"],
    internals.knobHighlightFor(2 / 3),
    "[20] 珠子上真的带了 --ces-hl（高光位置跟着显示位置走）",
  );

  // CSS 契约：液态玻璃的分层结构在，形状断言依赖的值一个没动
  const css = internals.CSS;
  const knobStart = css.indexOf(".ces-knob{");
  const knobCss = css.slice(knobStart, css.indexOf("}", knobStart));
  ok(knobCss.indexOf("border-radius:50%") > 0, "[20] 还是正圆");
  ok(
    knobCss.indexOf(`width:${internals.KNOB_SIZE}px;height:${internals.KNOB_SIZE}px`) > 0,
    "[20] 盒子形状没动（2b 的断言按这个钉死）",
  );

  // ── 液态玻璃 ≠ 毛玻璃：**不许再有 backdrop-filter / saturate**（负向断言，防止哪天又糊回去）
  ok(knobCss.indexOf("backdrop-filter") < 0, "[20] 没有 backdrop-filter（液态玻璃不糊背景，背后是清晰的）");
  ok(knobCss.indexOf("-webkit-backdrop-filter") < 0, "[20] 连 -webkit- 前缀也没有");
  ok(knobCss.indexOf("saturate(") < 0, "[20] 没有 saturate（提饱和是毛玻璃的做法）");
  ok(css.indexOf("backdrop-filter") < 0, "[20] 整张样式表里都没有 backdrop-filter");

  // 珠体必须**近透明**（白只是"玻璃的体"，背景原样透出来）
  const alphasOf = (text) => (text.match(/rgba\(\d+,\d+,\d+,\.\d+\)/g) || []).map((token) => {
    const digits = /\.(\d+)\)/.exec(token)[1];
    return Number(digits) / 10 ** digits.length;
  });
  const bodyGradient = /background:linear-gradient\(158deg,([^;]+)\)/.exec(knobCss);
  ok(bodyGradient !== null, "[20] 珠体有渐变");
  const bodyAlphas = alphasOf(bodyGradient[1]);
  eq(bodyAlphas.length, 4, "[20] 珠体渐变四段");
  const brightest = Math.max(...bodyAlphas);
  const clearest = Math.min(...bodyAlphas);
  ok(brightest <= 0.2, `[20] 珠体最亮处也接近全透（alpha ${brightest} ≤ .2）`);
  ok(clearest <= 0.06, `[20] 中段几乎是空的（alpha ${clearest} ≤ .06）—— 背景清晰透出，这才是液态玻璃`);

  ok(knobCss.indexOf("inset 0 1px 1px") > 0, "[20] 顶部内高光（玻璃的高光边）");
  ok(knobCss.indexOf("inset 0 -1.5px 2px") > 0, "[20] 底部内阴影（给出玻璃厚度）");
  ok(/inset 0 0 0 1px rgba\(255,255,255,\.[7-9]/.test(knobCss), "[20] 内侧 1px 亮边（弧面边缘的折射亮边，形状全靠它）");
  ok(/0 0 0 \.5px rgba\(15,23,42,\.2[0-9]/.test(knobCss), "[20] 最外一条极细暗发丝（浅色轨道上全靠它把珠子切出来）");
  ok(knobCss.indexOf("0 2px 12px -2px") > 0, "[20] 更远的一层软投影（玻璃的影）");
  ok(knobCss.indexOf("--ces-energy") > 0, "[20] 高档位时珠体边缘跟着能量泛紫辉");
  ok(knobCss.indexOf("overflow:hidden") > 0, "[20] 裁进圆里（高光斑不会溢出成方块）");

  // 高光层 = 大柔光 + 小亮斑（"那一滴光"），两层都在 ::after 里
  const afterStart = css.indexOf(".ces-knob::after{");
  ok(afterStart > 0, "[20] 有镜面高光伪元素");
  const afterCss = css.slice(afterStart, css.indexOf("}", afterStart));
  eq(afterCss.split("radial-gradient(").length - 1, 2, "[20] 高光是两层：大柔光 + 小亮斑");
  ok(afterCss.indexOf("13% 10% at var(--ces-hl,30%) 19%,rgba(255,255,255,.98)") > 0, "[20] 小亮斑很小、很白（真正的镜面反射点）");
  ok(afterCss.indexOf("72% 60% at calc(var(--ces-hl,30%) + 4%) 26%") > 0, "[20] 大柔光铺在左上（曲面反光的主形）");
  ok(afterCss.indexOf("var(--ces-hl,30%)") > 0, "[20] 两层位置都走变量且带默认值");

  // 深色主题专规：暗底上玻璃靠"亮边"存在，而不是靠白体
  const darkStart = css.indexOf("body[data-ds-dark-theme] .ces-knob{");
  ok(darkStart > 0, "[20] 深色主题有专门的材质规则");
  const darkCss = css.slice(darkStart, css.indexOf("}", darkStart));
  ok(darkCss.indexOf("rgba(216,180,254,.22)") > 0, "[20] 深色下边缘一圈极淡冷紫辉");
  ok(/inset 0 0 0 1px rgba\(255,255,255,\.[4-6]/.test(darkCss), "[20] 深色下内侧亮边收一点（暗底上太亮会发白）");
  eq(internals.knobOffsetOf(2 / 3), react.find("knob").style.left, "[20] 珠子的位置几何没被材质改动影响");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("21. 珠子的灵动：纯函数（速度 / 拉伸 / 落档「叮」/ 高光滞后）");
{
  const { internals } = await setup();
  const { velocityFor, knobStretchFor, knobBounceFor, knobLagPctFor } = internals;

  // ── 速度 ──────────────────────────────────────────────────────────────
  eq(velocityFor(0.2, 0.4, 100), 2, "[21] 100ms 里走了 0.2 = 2 pct/秒");
  eq(velocityFor(0.4, 0.2, 100), -2, "[21] 反向为负");
  eq(velocityFor(0.2, 0.4, 0), 0, "[21] dt=0 → 0（第一帧/同一时间戳不算速度）");
  eq(velocityFor(0.2, 0.4, -5), 0, "[21] dt<0 → 0");
  eq(velocityFor(NaN, 0.4, 100), 0, "[21] 非有限输入 → 0");
  eq(velocityFor(0, 1, 1), internals.KNOB_VELOCITY_LIMIT, "[21] 速度钳在上限（手再快也不爆）");

  // ── 跟手拉伸 ───────────────────────────────────────────────────────────
  const still = knobStretchFor(0, false);
  eq(still.x, 1, "[21] 静止：横向不变");
  eq(still.y, 1, "[21] 静止：纵向不变（珠子是完美的圆）");
  const slow = knobStretchFor(10, false);
  const fast = knobStretchFor(60, false);
  ok(slow.x > still.x && fast.x > slow.x, "[21] 速度越大横向拉得越长");
  ok(slow.y < still.y && fast.y < slow.y, "[21] 同时纵向被压（近似保体积，像一滴液体）");
  ok(fast.x <= 1 + internals.KNOB_STRETCH_MAX + 1e-9, `[21] 横向有上限（实测 ${fast.x.toFixed(4)}）`);
  near(fast.x * fast.y, 1, "[21] 严格保体积（横 × 纵 = 1）", 1e-12);
  near(
    knobStretchFor(60, true).x - 1,
    (fast.x - 1) * internals.KNOB_MOTION_REDUCED_SCALE,
    "[21] reduced：拉伸减半",
    1e-9,
  );
  eq(knobStretchFor(NaN, false).x, 1, "[21] 非有限速度 = 静止");

  // ── 落档「叮」：吃的是回弹的过冲，所以和落档动画天然同步 ─────────────────
  const TARGET = 2 / 3;
  const TRAVEL = 1 / 6;
  eq(knobBounceFor(0.5, TARGET, TRAVEL, false), 1, "[21] 还没到刻度：不放大");
  eq(knobBounceFor(TARGET, TARGET, TRAVEL, false), 1, "[21] 恰好落在刻度：1");
  eq(knobBounceFor(0.7, 0.9, 0.2, false), 1, "[21] 还在目标左边：不放大");
  eq(knobBounceFor(0.8, TARGET, 0, false), 1, "[21] 行程为 0 → 1（没有落档就没有「叮」）");
  const halfOver = knobBounceFor(TARGET + internals.SNAP_OVERSHOOT * TRAVEL * 0.5, TARGET, TRAVEL, false);
  const peakOver = knobBounceFor(TARGET + internals.SNAP_OVERSHOOT * TRAVEL, TARGET, TRAVEL, false);
  near(peakOver, 1 + internals.KNOB_BOUNCE_MAX, "[21] 过冲峰值 = 1 + KNOB_BOUNCE_MAX", 1e-9);
  ok(halfOver > 1 && halfOver < peakOver, "[21] 过冲越大「叮」越大（与回弹曲线同步）");
  near(
    knobBounceFor(TARGET + internals.SNAP_OVERSHOOT * TRAVEL, TARGET, TRAVEL, true) - 1,
    internals.KNOB_BOUNCE_MAX * internals.KNOB_MOTION_REDUCED_SCALE,
    "[21] reduced：「叮」的幅度减半",
    1e-9,
  );

  // ── 高光滞后 ───────────────────────────────────────────────────────────
  eq(knobLagPctFor(0.2, 0.8, 0), 0.2, "[21] dt=0：滞后位置不动");
  eq(knobLagPctFor(null, 0.8, 16), 0.8, "[21] 第一次：直接跟上（不留旧值）");
  const oneTau = knobLagPctFor(0.2, 0.8, internals.KNOB_LAG_TAU_MS);
  near(oneTau, 0.2 + 0.6 * (1 - 1 / Math.E), "[21] 一个时间常数走掉 1-e⁻¹", 1e-9);
  ok(oneTau > 0.2 && oneTau < 0.8, "[21] 中间态：既不在起点也不在终点（这就是「晃」）");
  eq(knobLagPctFor(0.2, 0.8, 100000), 0.8, "[21] 时间够长精确收敛（不会永远差一点）");
  ok(knobLagPctFor(0.5, 0.1, 16) > 0.1, "[21] 从上方逼近也不会越过目标");
}

section("21b. 珠子的灵动：渲染与 CSS 契约");
{
  const s = await setup();
  const css = s.internals.CSS;
  const knobStart = css.indexOf(".ces-knob{");
  const knobCss = css.slice(knobStart, css.indexOf("}", knobStart));

  // 静止时珠子是完美的圆
  eq(s.react.find("root").style["--ces-stx"], "1.0000", "[21b] 静止：--ces-stx = 1");
  eq(s.react.find("root").style["--ces-sty"], "1.0000", "[21b] 静止：--ces-sty = 1");
  eq(s.react.find("root").style["--ces-bounce"], "1.0000", "[21b] 静止：--ces-bounce = 1");
  eq(s.react.find("root").getAttribute("data-breath"), "0", "[21b] 呼吸默认关（data-breath=0）");
  eq(s.internals.KNOB_BREATH_ENABLED, false, "[21b] 常量也确认是「克制档」");
  eq(s.react.find("knob").style.left, s.internals.knobOffsetOf(2 / 3), "[21b] 位置几何没被灵动改动影响");

  // 拖动中：位置连续变化 → 速度进去 → 珠子被拉长（读的是渲染出来的那一帧）
  const node = track(s.react);
  node.fire("onPointerDown", { clientX: 40, pointerId: 1 });
  await settle(2);
  track(s.react).fire("onPointerMove", { clientX: 150 });
  await settle(2);
  track(s.react).fire("onPointerMove", { clientX: 262 });
  await settle(2);
  const stx = Number(s.react.find("root").style["--ces-stx"]);
  const sty = Number(s.react.find("root").style["--ces-sty"]);
  ok(stx > 1, `[21b] 拖动中珠子横向被拉长（--ces-stx=${stx}）`);
  ok(sty < 1, `[21b] 同时纵向被压（--ces-sty=${sty}）`);
  ok(stx <= 1 + s.internals.KNOB_STRETCH_MAX + 1e-9, "[21b] 拉伸有上限");

  // 停手：一个 timer 把速度归零，珠子回到圆（不是靠动画循环）
  await wait(s.internals.KNOB_MOTION_STALE_MS + 120);
  eq(s.react.find("root").style["--ces-stx"], "1.0000", "[21b] 停手后横向回到 1");
  eq(s.react.find("root").style["--ces-sty"], "1.0000", "[21b] 停手后纵向回到 1");

  // 落档：「叮」跟着回弹的过冲走，落定精确回到 1
  const k = await setup();
  track(k.react).fire("onPointerDown", { clientX: 60, pointerId: 1 });
  track(k.react).fire("onPointerUp", {});
  await settle(2);
  let peak = Number(k.react.find("root").style["--ces-bounce"]);
  for (let i = 0; i < 30; i += 1) {
    await k.step(16);
    peak = Math.max(peak, Number(k.react.find("root").style["--ces-bounce"]));
  }
  ok(peak > 1, `[21b] 落档途中珠子「叮」了一下（峰值 ${peak}）`);
  ok(peak <= 1 + k.internals.KNOB_BOUNCE_MAX + 1e-9, "[21b] 「叮」有上限");
  eq(k.react.find("root").style["--ces-bounce"], "1.0000", "[21b] 落定后精确回到 1（不会留在放大态）");

  // CSS 契约：一个 transform 把四个量拼起来 + 内反射层 + 按压 + 呼吸（含 reduced 关停）
  ok(
    css.indexOf("transform:scale(calc(var(--ces-press,1) * var(--ces-bounce,1))) scaleX(var(--ces-stx,1)) scaleY(var(--ces-sty,1))") > 0,
    "[21b] 珠子的 transform = 按压 × 叮 × 拉伸（单一来源）",
  );
  const beforeStart = css.indexOf(".ces-knob::before{");
  ok(beforeStart > 0, "[21b] 有第二道光（内反射）伪元素");
  const beforeCss = css.slice(beforeStart, css.indexOf("}", beforeStart));
  ok(beforeCss.indexOf("--ces-energy") > 0, "[21b] 内反射强度跟着能量走（高档位更亮）");
  ok(css.indexOf(".ces-inline[data-dragging='1']{--ces-press:.95}") > 0, "[21b] 按压：拖动时压到 .95（写在根上，水层的椭圆端面也吃得到）");
  ok(css.indexOf(".ces-inline[data-motion='reduced'][data-dragging='1']{--ces-press:.975}") > 0, "[21b] reduced：按压减半");
  ok(css.indexOf("@keyframes ces-knob-breathe{") > 0, "[21b] 呼吸 keyframes 在（活泼档用）");
  ok(css.indexOf(".ces-inline[data-breath='1'] .ces-knob::after{animation:ces-knob-breathe") > 0, "[21b] 只在 data-breath=1 时才呼吸");
  ok(css.indexOf(".ces-inline[data-motion='reduced'] .ces-knob::after{animation:none}") > 0, "[21b] reduced 下呼吸停掉");
}

/* ══════════════════════════════════════════════════════════════════════ */

section("22. 进度条的「水感」：液面贴着珠子后缘（纯函数 + 两方向 + 排水回摆）");
{
  const { internals } = await setup();
  const { fillLeadTargetFor, approachFor, FILL_LEAD_MAX } = internals;

  // ── 速度 → 液面偏移目标：反向、饱和、连续、静止为 0 ──────────────────────
  eq(fillLeadTargetFor(0, false), 0, "[22] 静止：偏移 0（液面正好在圆心，与旧版一致）");
  eq(FILL_LEAD_MAX, 1, "[22] 幅度 = 1.0（液面正好贴到珠子后缘 = 「到了玻璃的最后侧」；半腰口味是 0.6）");
  const fastForward = fillLeadTargetFor(1000, false);
  const fastBackward = fillLeadTargetFor(-1000, false);
  ok(fastForward < 0, "[22] 向右拖（v>0）→ 偏移为负 = 液面贴在珠子**左缘**（珠子领着水走）");
  ok(fastBackward > 0, "[22] 向左拖（v<0）→ 偏移为正 = 液面停在珠子**右缘**（珠子半泡在水里 = 灌满）");
  near(fastForward, -FILL_LEAD_MAX, "[22] 速度拉满时饱和到 -FILL_LEAD_MAX", 1e-6);
  near(fastBackward, FILL_LEAD_MAX, "[22] 对称：饱和到 +FILL_LEAD_MAX", 1e-6);
  ok(fillLeadTargetFor(15, false) > -FILL_LEAD_MAX && fillLeadTargetFor(15, false) < 0, "[22] 中速落在中间（连续，不跳）");
  ok(
    fillLeadTargetFor(20, false) < fillLeadTargetFor(10, false),
    "[22] 单调：越快越贴到后缘（同一个方向的偏移越大）",
  );
  near(fillLeadTargetFor(-1000, true), FILL_LEAD_MAX * internals.KNOB_MOTION_REDUCED_SCALE, "[22] reduced：幅度减半", 1e-9);
  eq(fillLeadTargetFor(NaN, false), 0, "[22] 非有限速度 = 静止");

  // ── 指数逼近（水面的"继续流过去"）：时间常数由调用方给 ────────────────────
  eq(approachFor(0.6, 0, 0, internals.FILL_LAG_TAU_MS), 0.6, "[22] dt=0：液面不动");
  eq(approachFor(null, 0.6, 16, internals.FILL_LAG_TAU_MS), 0.6, "[22] 第一次：直接跟上（不留旧值）");
  const oneTau = approachFor(0.6, 0, internals.FILL_LAG_TAU_MS, internals.FILL_LAG_TAU_MS);
  near(oneTau, 0.6 * (1 / Math.E), "[22] 一个时间常数走掉 1-e⁻¹ 的距离", 1e-9);
  ok(oneTau > 0 && oneTau < 0.6, "[22] 中间态：液面正在往回收（这就是「再继续向左流」）");
  eq(approachFor(0.6, 0, 100000, internals.FILL_LAG_TAU_MS), 0, "[22] 时间够长精确回中");
}

section("22b. 水感的渲染：三层宽度、两方向、排水回摆");
{
  const s = await setup();
  const lead = () => Number(s.react.find("root").style["--ces-fill-offset"]);
  const widths = () => ({
    water: s.react.find("water").style.width,
    fill: s.react.find("fill").style.width,
    energy: s.react.find("energy").style.width,
    stars: s.react.find("stars").style.width,
  });

  // 静止：偏移 0，水层宽度带液面项（水感的基准态与旧版逐像素一致）
  eq(lead(), 0, "[22b] 静止：液面偏移 = 0");
  const w = widths();
  ok(w.water.indexOf("var(--ces-fill-offset,0) * 14px") > 0, "[22b] 水层宽度里带液面项");
  ok(w.fill === undefined && w.energy === undefined && w.stars === undefined, "[22b] 内层不再各自设宽度（宽度是水层一件事）");
  ok(
    s.react.find("knob").style.left.indexOf("var(--ces-fill-offset") < 0,
    "[22b] 珠子的**位置**不含液面项（水动、珠子不动）",
  );

  // 向右拖：液面跑到珠子左缘（偏移为负）
  // ⚠️ 两条讲究（照着真机来，否则测的不是真行为）：
  //   · 按下时**对准珠子现在的位置** —— 随手点轨道另一头是一次"跳跃位移"，水会先朝那个方向晃，
  //     把符号断言带偏（这个坑真踩过）；
  //   · 事件之间给真实的帧间隔（20ms ≈ 50Hz）—— 液面是指数逼近，同一 tick 连发事件几乎推不动它。
  const startX = s.internals.KNOB_RADIUS + (2 / 3) * (300 - 2 * s.internals.KNOB_RADIUS);
  const node = track(s.react);
  node.fire("onPointerDown", { clientX: startX, pointerId: 1 });
  await settle(2);
  const forwardSamples = [];
  for (const dx of [12, 24, 36, 48]) {
    track(s.react).fire("onPointerMove", { clientX: startX + dx });
    await wait(20);
    forwardSamples.push(lead());
  }
  const forward = lead();
  ok(forward < 0, `[22b] 向右拖：液面贴到珠子左缘（偏移 ${forward}）`);
  ok(forwardSamples.every((value, i) => i === 0 || value <= forwardSamples[i - 1] + 1e-9), "[22b] 且一路朝那个方向推（单调）");
  ok(forward >= -s.internals.FILL_LEAD_MAX - 1e-9, "[22b] 不超过幅度上限");

  // 向左拖：液面停在珠子右缘（偏移为正 = "灌满"）
  for (const dx of [36, 24, 12, 0]) {
    track(s.react).fire("onPointerMove", { clientX: startX + dx });
    await wait(20);
  }
  const backward = lead();
  ok(backward > forward, `[22b] 向左拖：液面朝反方向走（${forward} → ${backward}）`);
  ok(backward <= s.internals.FILL_LEAD_MAX + 1e-9, "[22b] 同样有上限");

  // 停手 → 排水：翻符号（回摆过冲）+ 最终精确回中
  // ⚠️ 推帧数要按**最坏情况**给：荡波时长是随机的（`SLOSH_DURATION_MAX = 520ms`），
  //    少推几帧就会读到"还没荡完"的中间值（这个坑踩过）。
  await wait(s.internals.KNOB_MOTION_STALE_MS + 40); // 等"停手"判定，排水动画开始
  const samples = [];
  const frames = Math.ceil((s.internals.SLOSH_DURATION_MAX + 80) / 16);
  for (let i = 0; i < frames; i += 1) {
    await s.step(16);
    samples.push(lead());
  }
  eq(lead(), 0, "[22b] 排水结束：液面精确回到圆心（offset = 0）");
  ok(
    samples.some((value) => value < 0),
    `[22b] 排水时**过冲到反方向**（水面回摆，实测最小 ${Math.min(...samples).toFixed(4)}）`,
  );
  ok(
    samples.some((value) => value > 0),
    "[22b] 排水全程从正值出发（确实是「排回去」而不是跳变）",
  );

  // 端点自洽：pct=0 且偏移 -0.6 → 不会被顶出左端；pct=1 且 +0.6 → 不会越界
  const minEdge = `calc(${s.internals.knobOffsetOf(0)} + var(--ces-fill-offset,0) * ${s.internals.KNOB_RADIUS}px)`;
  ok(minEdge.indexOf("calc(14px + 0 * (100% - 28px))") > 0, "[22b] 左端：偏移为负时宽度由 calc 自然收窄（圆心 + 半径 = 0）");

  // reduced：幅度减半
  const rm = await setup({ reducedMotion: true });
  const rmNode = track(rm.react);
  rmNode.fire("onPointerDown", { clientX: 262, pointerId: 1 });
  await settle(2);
  track(rm.react).fire("onPointerMove", { clientX: 40 });
  await settle(2);
  const rmLead = Math.abs(Number(rm.react.find("root").style["--ces-fill-offset"]));
  ok(rmLead <= rm.internals.FILL_LEAD_MAX * rm.internals.KNOB_MOTION_REDUCED_SCALE + 1e-9, `[22b] reduced：幅度减半（${rmLead} ≤ .3）`);
}

/* ══════════════════════════════════════════════════════════════════════ */

section("23. 速度标定 + 版本号（防「参数错一个量级」与「不知道自己跑的是哪版」）");
{
  const { internals, react } = await setup();
  // 轨道几何：300px 轨道 − 2×14px 内缩 = 272px 可用 ⇒ **1 pct = 272px**。
  // 真实动作换算下来只有"个位数 pct/秒"，所以所有 *_VELOCITY_SOFT 都必须按这个量级标定。
  const USABLE = 272;
  const at = (pxPerSec) => pxPerSec / USABLE;
  const leadPx = (v) => Math.abs(internals.fillLeadTargetFor(v, false)) * internals.KNOB_RADIUS;
  const stretchPx = (v) => (internals.knobStretchFor(v, false).x - 1) * internals.KNOB_SIZE;

  // 慢慢拖（整条轨道要 2.7 秒）：有反应但**不夸张**（上限 14px 时它约 5px = 四成）
  ok(leadPx(at(100)) <= 8, `[23] 慢慢拖 100px/s：液面位移不该夸张（${leadPx(at(100)).toFixed(1)}px ≤ 8px）`);
  // 正常拖：必须**看得出来**（早先的参数在这里只有 0.41px，肉眼等于没有）
  ok(leadPx(at(400)) >= 6, `[23] 正常拖 400px/s：液面位移 ≥ 6px（实测 ${leadPx(at(400)).toFixed(1)}px）`);
  ok(stretchPx(at(400)) >= 0.8, `[23] 正常拖：拉伸 ≥ 0.8px（实测 ${stretchPx(at(400)).toFixed(2)}px）`);
  // 快拖：接近贴满
  ok(leadPx(at(900)) >= 10, `[23] 快拖 900px/s：液面位移 ≥ 10px（实测 ${leadPx(at(900)).toFixed(1)}px）`);
  ok(stretchPx(at(900)) >= 1.4, `[23] 快拖：拉伸 ≥ 1.4px（实测 ${stretchPx(at(900)).toFixed(2)}px）`);
  // 甩一下：饱和到"贴到后缘"（= 一个半径）
  ok(leadPx(at(2000)) >= 13, `[23] 甩一下 2000px/s：液面几乎贴满（实测 ${leadPx(at(2000)).toFixed(1)}px / 上限 14px）`);
  ok(leadPx(at(99999)) <= internals.KNOB_RADIUS + 1e-9, "[23] 但永远不会超过一个半径（贴满即止）");
  ok(stretchPx(at(99999)) <= internals.KNOB_STRETCH_MAX * internals.KNOB_SIZE + 1e-9, "[23] 拉伸同样有上限");
  // 量级守卫：soft 必须落在"真实拖动"的量级（个位数 pct/秒），不能再回到几十
  ok(internals.KNOB_VELOCITY_SOFT <= 5, `[23] 拉伸软化尺度 ≤ 5 pct/秒（实测 ${internals.KNOB_VELOCITY_SOFT}）`);
  ok(internals.FILL_VELOCITY_SOFT <= 5, `[23] 液面软化尺度 ≤ 5 pct/秒（实测 ${internals.FILL_VELOCITY_SOFT}）`);
  ok(internals.KNOB_VELOCITY_LIMIT >= at(2000), "[23] 活动上限不至于把真实拖动钳掉");

  // 版本号：滑条提示里带着它，且必须与 package.json 一致（不会忘同步）
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  eq(internals.SLIDER_VERSION, pkg.version, "[23] 产物里的版本 = package.json 的版本");
  const title = String(react.find("track").getAttribute("title"));
  ok(title.indexOf("v" + pkg.version) > 0, `[23] 滑条 title 里带版本（${title.slice(-12)}）—— 重开后停一下鼠标就知道跑的是哪版`);
}

/* ══════════════════════════════════════════════════════════════════════ */

section("24. 水面的高低落差（倾斜）+ 每次随机的排水荡波");
{
  const { internals } = await setup();
  const { fillSkewTargetFor, sloshSpecFor, sloshEaseFor } = internals;

  // ── 水面倾角目标（度）：有正负、饱和、静止为 0（水面水平）────────────────
  // 水层绕**左端**旋转：负角 = CSS 逆时针 = 右端抬起（水在珠子后侧堆起来）。
  eq(fillSkewTargetFor(0, false), 0, "[24] 静止：倾角 0（水面是水平的，与旧版一致）");
  ok(fillSkewTargetFor(-10, false) < 0, "[24] 向左拖 → 负角 → 右端**抬起**（水在珠子后侧堆起来）");
  ok(fillSkewTargetFor(10, false) > 0, "[24] 向右拖 → 正角 → 右端压下（水面被推着往前追）");
  near(fillSkewTargetFor(-1000, false), -internals.SKEW_MAX_DEG, "[24] 速度拉满时饱和到 -SKEW_MAX_DEG", 1e-6);
  near(fillSkewTargetFor(1000, false), internals.SKEW_MAX_DEG, "[24] 对称：+SKEW_MAX_DEG", 1e-6);
  ok(
    Math.abs(fillSkewTargetFor(-3, false)) > Math.abs(fillSkewTargetFor(-1, false)),
    "[24] 单调：拖得越急，倾角越大",
  );
  near(
    fillSkewTargetFor(-1000, true),
    -internals.SKEW_MAX_DEG * internals.KNOB_MOTION_REDUCED_SCALE,
    "[24] reduced：倾角减半",
    1e-9,
  );
  eq(fillSkewTargetFor(NaN, false), 0, "[24] 非有限速度 = 水平的");
  // **标定必须按"小心瞄准档位"的真实速度**（1 pct = 整条轨道 272px）：
  //   慢慢拖 200px/s → 0.74 pct/秒；小心拖 300px/s → 1.10；正常拖 400px/s → 1.47
  // 早先按 400px/s 甚至 26/30 标定，结果真机上只有 2~6px 的高差 —— 肉眼读不出来（用户实测反馈）。
  // 现在按角度验：272px 可用宽上，1° ≈ 4.7px 的高差。
  for (const [px, floorDeg] of [[200, 2.2], [300, 2.6], [400, 3.0]]) {
    const v = px / 272;
    const got = Math.abs(fillSkewTargetFor(-v, false));
    const heightPx = Math.tan((got * Math.PI) / 180) * 272;
    ok(
      got >= floorDeg,
      `[24] ${px}px/s 拖动 → 倾角 ≥ ${floorDeg}°（实测 ${got.toFixed(2)}° ≈ ${heightPx.toFixed(1)}px 高差 / 上限 ${internals.SKEW_MAX_DEG}°）`,
    );
  }
  ok(
    Math.tan((internals.SKEW_MAX_DEG * Math.PI) / 180) * 272 >= 14,
    `[24] 最大倾角在整条轨道上至少 14px 高差（SKEW_MAX_DEG = ${internals.SKEW_MAX_DEG}° → ${(Math.tan((internals.SKEW_MAX_DEG * Math.PI) / 180) * 272).toFixed(1)}px）`,
  );

  // ── 荡波参数：每次都不一样（用户要的「随机」），但同一个种子可复现 ────────
  const a = sloshSpecFor(1);
  const b = sloshSpecFor(2);
  eq(JSON.stringify(a), JSON.stringify(sloshSpecFor(1)), "[24] 同一个种子 → 完全相同（所以能断言、能重放）");
  ok(
    a.durationMs !== b.durationMs || a.waves !== b.waves || a.damping !== b.damping || a.amplitude !== b.amplitude,
    "[24] 换一个种子 → 参数就变（这就是「每次荡得不一样」）",
  );
  const specs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => sloshSpecFor(seed));
  ok(new Set(specs.map((spec) => spec.durationMs)).size >= 4, "[24] 时长确实在变（8 个种子里 ≥4 个不同值）");
  ok(new Set(specs.map((spec) => spec.waves)).size >= 4, "[24] 波数也在变");
  ok(
    specs.every((spec) => spec.durationMs >= internals.SLOSH_DURATION_MIN && spec.durationMs <= internals.SLOSH_DURATION_MAX),
    "[24] 时长都落在区间内",
  );
  ok(
    specs.every((spec) => spec.waves >= internals.SLOSH_WAVES_MIN && spec.waves <= internals.SLOSH_WAVES_MAX),
    "[24] 波数都落在区间内",
  );
  ok(
    specs.every((spec) => spec.amplitude >= internals.SLOSH_AMPLITUDE_MIN && spec.amplitude <= internals.SLOSH_AMPLITUDE_MAX),
    "[24] 水量都落在区间内",
  );

  // ── 荡波曲线：两端精确 0/1 + **起步是平的**（零初速）+ 中间荡过静止位 ─────────
  // 用**显式 spec** 做形状断言，免得随机参数让"穿零次数"这类断言飘（随机性另有断言）。
  const spec = sloshSpecFor(3); // 随机那一档，只用来验 reduced 分支
  const shape = { waves: 1.6, damping: 2.6, amplitude: 1 };
  eq(sloshEaseFor(0, shape, false), 0, "[24] 荡波起点 = 0");
  eq(sloshEaseFor(1, shape, false), 1, "[24] 荡波终点 = 1（水面精确回到静止位）");
  eq(sloshEaseFor(2, shape, false), 1, "[24] 越界夹住（不会荡不停）");
  // ⭐ 零初速（这条是"荡水"那个真机 bug 的防线）：起步的**速度**必须远小于中段。
  //   旧曲线 `1 − e^{−λu}cos(ωu)` 的起斜率就是全程最大 → 真机上"松手啪地弹回"，
  //   用户直接指出"是荡水的问题"。现在起点斜率应该接近 0。
  const slope = (u) => (sloshEaseFor(u + 0.005, shape, false) - sloshEaseFor(u - 0.005, shape, false)) / 0.01;
  const startSlope = Math.abs(slope(0.005));
  let midSlope = 0;
  for (let u = 0.2; u <= 0.8; u += 0.01) midSlope = Math.max(midSlope, Math.abs(slope(u)));
  ok(
    startSlope < midSlope * 0.4,
    `[24] 起步速度远小于中段（零初速：起点斜率 ${startSlope.toFixed(2)} < 中段峰值 ${midSlope.toFixed(2)} 的 40%）`,
  );
  ok(sloshEaseFor(0.08, shape, false) < 0.45, `[24] 前 8% 时长仍在起步段（${(sloshEaseFor(0.08, shape, false) * 100).toFixed(1)}% < 45%）`);
  // 但中段要**荡过**静止位，而且不止一次
  const samples = [];
  for (let i = 0; i <= 400; i += 1) samples.push(sloshEaseFor(i / 400, shape, false));
  ok(Math.max(...samples) > 1.2, `[24] 中途**荡过静止位**（峰值 ${Math.max(...samples).toFixed(3)} > 1.2）`);
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) if ((samples[i - 1] - 1) * (samples[i] - 1) < 0) crossings += 1;
  ok(crossings >= 2, `[24] 至少来回穿两次（实测 ${crossings} 次）—— 这就是「荡两下」`);
  ok(Math.max(...samples.slice(280)) < Math.max(...samples), "[24] 后段比首波小（阻尼：越荡越小）");
  // "水量"：放大偏离静止位的那部分，但端点必须精确不变
  const small = { waves: shape.waves, damping: shape.damping, amplitude: 1 };
  const big = { waves: shape.waves, damping: shape.damping, amplitude: 2 };
  let smallPeak = 0;
  let bigPeak = 0;
  for (let i = 0; i <= 200; i += 1) {
    smallPeak = Math.max(smallPeak, sloshEaseFor(i / 200, small, false));
    bigPeak = Math.max(bigPeak, sloshEaseFor(i / 200, big, false));
  }
  ok(bigPeak > smallPeak + 0.05, `[24] 水量越大荡得越过（${smallPeak.toFixed(3)} → ${bigPeak.toFixed(3)}）`);
  eq(sloshEaseFor(0, big, false), 0, "[24] 但水量不影响起点（仍是精确 0）");
  eq(sloshEaseFor(1, big, false), 1, "[24] 也不影响终点（仍是精确 1）");
  eq(sloshEaseFor(0.5, spec, true), internals.snapEaseFor(0.5, true), "[24] reduced：退化成无波的 ease-out");
  let reducedMax = 0;
  for (let i = 0; i <= 200; i += 1) reducedMax = Math.max(reducedMax, sloshEaseFor(i / 200, spec, true));
  ok(reducedMax <= 1 + 1e-9, `[24] reduced 全程不越过静止位（峰值 ${reducedMax.toFixed(4)}）`);
}

section("24b. 水面倾角的渲染：管子裁切 + 绕左端旋转、水层比轨道高、排水荡回去");
{
  const s = await setup();
  const skew = () => s.react.find("root").style["--ces-skew"];
  const lead = () => Number(s.react.find("root").style["--ces-fill-offset"]);

  eq(skew(), "0.000deg", "[24b] 静止：倾角 = 0（水面水平）");
  eq(lead(), 0, "[24b] 静止：液面偏移 = 0（水面在珠子右缘的基准上）");

  const css = s.internals.CSS;
  // ⭐ `.ces-water` 就是水本身：宽度由内联给（右缘 = 水面），左端圆角是管口，
  //    **右端圆角是珠子当下的椭圆**（按压 × 回弹 × 拉伸）—— 珠子压扁时水跟着扁，
  //    用户截图里的"右上/右下角溢出"就是端面直角造成的。
  ok(
    css.indexOf(
      ".ces-water{position:absolute;left:0;top:0;bottom:0;border-top-left-radius:" + s.internals.KNOB_RADIUS + "px;border-bottom-left-radius:" + s.internals.KNOB_RADIUS + "px;border-top-right-radius:" + s.internals.KNOB_RX + " " + s.internals.KNOB_RY + ";border-bottom-right-radius:" + s.internals.KNOB_RX + " " + s.internals.KNOB_RY + ";overflow:hidden;pointer-events:none}",
    ) > 0,
    "[24b] 水层左端=管口、右端=珠子当下的椭圆（压扁时不从角上溢水）",
  );
  ok(css.indexOf("--ces-press,1") > 0 && css.indexOf("--ces-bounce,1") > 0 && css.indexOf("--ces-stx,1") > 0 && css.indexOf("--ces-sty,1") > 0, "[24b] 椭圆端面用满四个形变量（按压 / 回弹 / 拉伸 x / 拉伸 y）");
  ok(
    css.indexOf(".ces-water-inner{position:absolute;left:0;right:0;top:-" + s.internals.WATER_PAD_PX + "px;bottom:-" + s.internals.WATER_PAD_PX + "px;transform:rotate(var(--ces-skew,0deg));transform-origin:0 50%}") > 0,
    "[24b] 水层比轨道高、绕左端旋转（倾斜不会露出上下空隙）",
  );
  ok(css.indexOf("clip-path") < 0, "[24b] 样式表里**不再有 clip-path**（水面靠旋转，不靠切）");
  ok(
    css.indexOf(".ces-water-inner > .ces-stars{top:" + s.internals.WATER_PAD_PX + "px;height:" + s.internals.TRACK_HEIGHT + "px}") > 0,
    "[24b] 星尘固定在轨道的垂直范围（否则层高了会被裁掉一大半）",
  );
  // 水面高光：贴着水层旋转后的右缘（所以它自己也是斜的）
  ok(css.indexOf(".ces-fill{box-shadow:inset -1.5px 0 0 rgba(255,255,255,.4)}") > 0, "[24b] 水面右缘有一道高光");
  ok(css.indexOf("body[data-ds-dark-theme] .ces-fill{box-shadow:inset -1.5px 0 0 rgba(255,255,255,.3)}") > 0, "[24b] 深色主题下高光稍弱");
  // 圆头从水层上去掉了（水的端面本来就该是平的）；圆角由管子这一层负责
  ok(css.indexOf(".ces-fill{position:absolute;inset:0;pointer-events:none}") > 0, "[24b] 水层内部是整块（宽度不再逐层给）");
  ok(css.indexOf("ces-meniscus") < 0, "[24b] 不再有水舌元素");
  // 结构层：水包住三层水位；珠子在**外面**（所以材质与投影不受裁切影响）
  ok(s.react.find("water") !== null && s.react.find("water-inner") !== null, "[24b] DOM 里有 .ces-water / .ces-water-inner");
  ok(
    String(s.react.find("water").style.width).indexOf("var(--ces-fill-offset,0)") > 0,
    "[24b] 水层宽度仍由液面偏移驱动",
  );
  ok(String(s.react.find("knob").style.left).indexOf("--ces-skew") < 0, "[24b] 珠子的位置**不含**倾角项（水动、珠稳）");

  // 向左拖 → 倾角为负（右端抬起）
  const startX = s.internals.KNOB_RADIUS + (2 / 3) * (300 - 2 * s.internals.KNOB_RADIUS);
  track(s.react).fire("onPointerDown", { clientX: startX, pointerId: 1 });
  await settle(2);
  for (const dx of [-12, -24, -36, -48]) {
    track(s.react).fire("onPointerMove", { clientX: startX + dx });
    await wait(20);
  }
  const skewLeft = Number.parseFloat(skew());
  ok(skewLeft < 0, `[24b] 向左拖：倾角为负 = 右端抬起（${skew()}）`);
  ok(Math.abs(skewLeft) <= s.internals.SKEW_MAX_DEG + 1e-6, "[24b] 倾角有上限");
  ok(lead() > 0, `[24b] 液面也往珠子后面堆（${lead()}）`);

  // 向右拖 → 倾角翻正
  for (const dx of [-24, 0, 24, 48]) {
    track(s.react).fire("onPointerMove", { clientX: startX + dx });
    await wait(20);
  }
  ok(Number.parseFloat(skew()) > 0, `[24b] 向右拖：倾角翻成正 = 右端压下（${skew()}）`);

  // 松手 → 荡回去：来回换向，最后精确归零（同样按最坏时长推帧）
  await wait(s.internals.KNOB_MOTION_STALE_MS + 40);
  const trail = [];
  const drainFrames = Math.ceil((s.internals.SLOSH_DURATION_MAX + 80) / 16);
  for (let i = 0; i < drainFrames; i += 1) {
    await s.step(16);
    trail.push(Number.parseFloat(skew()));
  }
  eq(skew(), "0.000deg", "[24b] 荡完：倾角精确归零");
  eq(lead(), 0, "[24b] 液面偏移也精确归零");
  let signFlips = 0;
  for (let i = 1; i < trail.length; i += 1) if (trail[i - 1] * trail[i] < 0) signFlips += 1;
  ok(signFlips >= 1, `[24b] 排水过程中水面**来回晃**（换向 ${signFlips} 次）`);
  ok(trail.some((value) => Math.abs(value) > 0.1), "[24b] 而且幅度不小（真的荡了，不是慢慢归零）");
}

section("24d. 荡水中途被手打断：水面不该被甩到起荡值之外（接力 + 不炸）");
{
  const s = await setup();
  const lead = () => Number(s.react.find("root").style["--ces-fill-offset"]);

  const startX = 14 + (2 / 3) * (300 - 28);
  track(s.react).fire("onPointerDown", { clientX: startX, pointerId: 1 });
  await settle(2);
  for (const dx of [-16, -32, -48, -64]) {
    track(s.react).fire("onPointerMove", { clientX: startX + dx });
    await wait(20);
  }
  // 松手 → 等荡波开始，记下"起荡满值"（g≈0 时水面就是它）
  await wait(s.internals.KNOB_MOTION_STALE_MS + 40);
  const startLead = lead();
  ok(Math.abs(startLead) > 0.1, `[24d] 前置条件：起荡时水面有量（${startLead.toFixed(3)}）`);

  // 推几帧让它收回一部分，然后**朝同一个方向**轻轻续拖（换个方向的话水面本来就该翻向，那是设计）
  await s.step(16);
  await s.step(16);
  const beforeLead = lead();
  ok(Math.abs(beforeLead) < Math.abs(startLead), `[24d] 前置条件：荡波确实在收回（${startLead.toFixed(3)} → ${beforeLead.toFixed(3)}）`);
  track(s.react).fire("onPointerMove", { clientX: startX - 70 }); // 同向续拖
  await settle(2);
  const afterLead = lead();

  ok(
    Math.abs(afterLead) <= Math.abs(startLead) * 1.05,
    `[24d] 打断后没有把水面甩到起荡值之外（起荡 ${startLead.toFixed(3)} → 打断后 ${afterLead.toFixed(3)}）`,
  );
  ok(Number.isFinite(afterLead), "[24d] 数值有效（荡波中断不会算出 NaN/Infinity）");
  ok(
    Math.abs(afterLead) <= 1.0001,
    "[24d] 也没有超出液面偏移的物理上限（|offset| ≤ 1）",
  );
}

section("24c. 端到端量级：慢速「小心瞄准档位」的拖动也必须看得见（这一条是三次「没变化」的根因防线）");
{
  // 为什么单独一条：section 23/24 都是**直接调纯函数**验幅度 —— 只要单位/时序在真机上不同，
  // 它们照样全绿而真机看不见（已经发生过三次）。这条走**完整管线**：
  // 真实指针事件 → pctAt → shownPct → velocityFor（真实时间戳）→ 纯函数 → --ces-* 变量。
  const s = await setup();
  const skewDeg = () => Math.abs(Number.parseFloat(s.react.find("root").style["--ces-skew"]));
  const leadPx = () => Math.abs(Number(s.react.find("root").style["--ces-fill-offset"])) * s.internals.KNOB_RADIUS;
  const stretch = () => Math.abs(Number(s.react.find("root").style["--ces-stx"]) - 1) * s.internals.KNOB_SIZE;

  // 一条真实轨道 272px 可用宽、4 档 → 一档 ≈ 90.7px。
  // 场景：从 High(2/3) 慢慢拖到 Max，全程 ~600ms（≈ 300px/s ≈ 1.1 pct/秒，就是"小心瞄准"的手速）。
  const pxPerEvent = 6; // 每 16ms 走 6px ≈ 375px/s
  const startX = 14 + (2 / 3) * (300 - 28);
  track(s.react).fire("onPointerDown", { clientX: startX, pointerId: 1 });
  await settle(2);
  for (let i = 1; i <= 10; i += 1) {
    track(s.react).fire("onPointerMove", { clientX: startX + i * pxPerEvent });
    await wait(16); // 真实帧间隔（60Hz）
  }
  const peakSkew = skewDeg();
  const peakLead = leadPx();
  const peakStretch = stretch();
  const heightPx = Math.tan((peakSkew * Math.PI) / 180) * 272;
  ok(peakSkew >= 1.8, `[24c] 小心拖：水面倾角要 ≥ 1.8°（实测 ${peakSkew.toFixed(2)}° ≈ ${heightPx.toFixed(1)}px 高差）—— 否则真机读不出来`);
  ok(peakLead >= 5, `[24c] 小心拖：液面位移要 ≥ 5px（实测 ${peakLead.toFixed(1)}px）`);
  ok(peakStretch >= 1, `[24c] 小心拖：珠子拉伸要 ≥ 1px（实测 ${peakStretch.toFixed(2)}px）`);
  ok(peakSkew <= s.internals.SKEW_MAX_DEG + 1e-6, "[24c] 但不超过倾角上限");
}

/* ══════════════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "全部通过 ✅" : "有失败 ❌"} （${passed} 项通过，${failed} 项失败）`);
if (failed > 0) {
  console.log("失败项：");
  for (const label of failures) console.log(`  · ${label}`);
  process.exitCode = 1;
}
