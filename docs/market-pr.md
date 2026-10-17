# 提交给精选列表（DSH 插件市场）

市场应用（`dshmarket`）**不存目录**：它每次打开都实时拉
`https://awesome-dsh-plugin.com/plugins.json`（= npm 包 `dsh-plugin-catalog` 里的 `plugins.json`）。
这份精选列表由 **<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>** 维护，它自己的 README 写明：

> 这个仓库是市场应用本身，不是插件目录。……想让你的插件上架，请去**那边**提 PR
> （在列表里加一条即可，站点和本市场会自动收录，通常一天内生效）。

## 步骤

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。
2. 按该仓库的 CONTRIBUTING / README 在列表里加**一条**（字段见 `market-entry.json`；
   其余字段 `page` / `version` / `stars` / `downloads` / `capabilities` / `added` 由它的 CI 回填）。
3. 提 PR，标题与正文用下面这份。
4. 合并后约一天：目录站 `/p/Herobrine-ZXY/dsh-glass-effort-slider/`、`plugins.json`、
   以及 DSH 的「插件市场」三处同时出现。**不需要**再向 `dsh-market/dsh-market` 提交任何东西
   （那是市场应用本体的仓库，明确不收入插件条目）。

## PR 标题

```
Add dsh-glass-effort-slider (UI: reasoning-effort slider with liquid-glass knob and water fill)
```

## PR 正文

```markdown
Adds `dsh-glass-effort-slider`, a continuous reasoning-effort slider for DSH.

- Repo: https://github.com/Herobrine-ZXY/dsh-glass-effort-slider
- Release: https://github.com/Herobrine-ZXY/dsh-glass-effort-slider/releases (zip asset, no build step)
- Install: github:Herobrine-ZXY/dsh-glass-effort-slider
- Category: ui
- License: MIT. It is a derivative of [dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)
  (MIT, Copyright (c) 2026 dsh-codex-effort-slider contributors); the upstream copyright line is kept in LICENSE
  and credited in README → 致谢 / Credits.
- Capabilities: none of `shell` / `network` / `credentials` / `fs-read` / `fs-write` — the plugin only writes four
  inline styles on the official model-menu row, portals a slider into it, and calls the official
  `ctx.modelDirectories.directoryFor(sessionId).select({provider, model, reasoningEffort})`. Every anchor it needs
  is a semantic attribute (`aria-haspopup`, `aria-controls`, `role="menuitem"`, `data-composer-card`); if any of them
  is missing it does nothing at all (fail-open).
- Zero runtime dependencies, no bundler: `lib/client.js` is the shipped artifact.
- Tests: 636 offline assertions (`node test/client.test.mjs`) covering geometry, colour mapping, injection,
  keyboard/wheel scope, snap animation, and write-failure rollback.

What it adds over the upstream slider: keyboard ←/→ (one level, clamped at the ends), ↑/↓ switching Flash ↔ Pro
while keeping the level, Home/End, hover-wheel stepping; magnetic snap-to-nearest with an elastic settle;
a liquid-glass knob (no `backdrop-filter`) that stretches with drag velocity; and a water fill that tilts with
velocity, sloshes randomly when released, and never spills past the knob.
```

## 上架前自检

| 项 | 状态 |
|---|---|
| GitHub Release + 合法 tag（`v1.9.0`，与 `package.json` 同号） | 待发布 |
| README 有安装步骤、截图、可离线看的 `preview/panel.html` | ✓ |
| LICENSE 保留上游版权行 + MIT 全文 | ✓ |
| `package.json`：`repository` / `author` / `homepage` / `bugs` / `keywords` / `dsh.bundle.patch` | ✓ |
| 目录里**没有**同名条目 | ⚠️ 有一条 `dsh-glass-effort-slider`（owner `HaoyueQin`，另一个项目，npm 已占名）。目录允许重名（先例 `dsh-memory` ×11、`dsh-prompt-polish` ×3），靠 `owner` 区分；npm 名字发不了，所以 `install` 走 `github:` |
