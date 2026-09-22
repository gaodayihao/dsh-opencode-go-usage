# dsh-opencode-go-usage

[English](README.en.md) | 中文

[![npm](https://img.shields.io/npm/v/dsh-ocgo-usage)](https://www.npmjs.com/package/dsh-ocgo-usage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![Footer demo](assets/custom-footer.png)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) **bundle**，在 Web 界面的输入框上方 dock（与内置 token 统计同位置）显示 [OpenCode Go](https://opencode.ai/docs/go/) 订阅用量。

它是 [pi-ocgo-usage](https://github.com/v587d/pi-ocgo-usage)（Pi 插件）的 Web 对应物：三个用量窗口（5h 滚动 / 每周 / 每月）的百分比与重置倒计时，按阈值变色，让你在窗口耗尽、请求被限流之前就发现。

```
OpenCode Go: 5h 0% · wk 0% · mo 95%
```

点开详情面板还会显示每个窗口的绝对金额（Go 的用量额度现在以**美元**计）：

```
5h Rolling   0.0%   $0.00 / $12.00 · resets in 0s
Weekly       0.0%   $0.00 / $30.00 · resets in 5d 21h
Monthly     94.7%   $56.84 / $60.00 · resets in 7d 0h
```

## 特性

- **三个窗口** —— 5h 滚动 / 每周 / 每月 的百分比 + 重置倒计时
- **美元额度** —— Go 的额度是金额上限（$12 / $30 / $60），详情面板显示 `$已用 / $上限`，比单看百分比更直观
- **颜色阈值** —— 正常 → 黄色警告（≥80%）→ 红色错误（≥90% 或已限流）
- **数据新鲜度** —— `upd HH:MM` 显示最近一次成功抓取时间；倒计时按绝对重置时间实时重算，不受 host 缓存影响
- **轻量轮询** —— 每 10s 轮询（切回标签页立即刷新）；host 端 300s 缓存（TTL 可配）+ 60s 失败冷却，不会频繁打扰 opencode.ai
- **Provider 感知** —— 仅当会话当前模型的 provider 显示为 `opencode-go` 时显示；可见性来自 **框架标准席 `useProjection('modelSelection')`**（host 推送的持久模型选择投影），用户在 composer 或 `/model` 里切换 provider 后**同一次渲染**即隐藏/恢复，无需等待下一轮询周期（与 pi-ocgo-usage 行为一致）
- **点击展开** —— 详情面板显示每个窗口的金额、重置倒计时，左下角 `Set` 可配置凭据，右侧 `refresh upd HH:MM` 手动刷新
- **内置凭据编辑器** —— 无需碰终端：`Set` 面板直接修改 workspace id 与 cookie（输入框以 `••••` + 末尾 4 位显示，点击外部 / Esc / 保存确认写入）
- **优雅降级** —— 配置缺失显示 `<err:noconfig>`，会话过期显示 `<err:unauthorized>`，其它 HTTP 失败显示 `<err:httpXXX>`；出错时点击 chip 直接进入 Set 面板
- **Cookie 只在 host 侧** —— 浏览器只访问同源 `/api/ocgo-usage` JSON 端点，cookie 永不进入页面

> **⚠️ 需要 OpenCode Go 控制台会话 cookie。** 该 cookie 是完整用户会话（不是 API key），可访问你 OpenCode 账户的全部内容。请像对待密码一样对待它——见 [配置](#配置)。

## 环境要求

- DeepSeek Harness `0.1.5-rc.1` 或更新（web profile）。`0.1.0-rc.6` 时代的 `session.models` Remote 已在后续版本移除，本插件的 provider 判断改用会话投影（见 [工作原理](#工作原理)）
- `PATH` 上有 pnpm（`dsh plugin` 需要）

## 安装

这是一个标准的 dsh **bundle**：`package.json` 声明了 `dsh.bundle`，通过 `dsh plugin --profile web add <spec>` 安装（pnpm 转发器），自动加入 profile 的 `dsh.profile.bundles`。仓库内置预构建的 `lib/` 产物，**安装无需任何构建步骤或构建权限**——遵循官方 [publish 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。

### 从 GitHub 安装（推荐）

```sh
dsh plugin --profile web add github:gaodayihao/dsh-opencode-go-usage
```

因为 `lib/` 已提交到仓库，pnpm 直接安装构建好的包，不会要求构建脚本授权。

### 从 tarball 安装

```sh
pnpm pack            # 在本仓库内 → dsh-ocgo-usage-0.1.0.tgz
dsh plugin --profile web add ./dsh-ocgo-usage-0.1.0.tgz
```

### 本地开发安装

```sh
git clone https://github.com/gaodayihao/dsh-opencode-go-usage.git
cd dsh-opencode-go-usage
pnpm install
pnpm run build
dsh plugin --profile web add link:$(pwd)
```

**重启 `dsh web` 并刷新页面**，chip 出现在输入框上方的 dock。不启动即可验证插件层已组合：

```sh
dsh --profile web --dump-config   # 应显示 "# == dsh-ocgo-usage" 层
```

## 配置

### 方式一：界面内 Set 面板（最简单）

点击 chip 展开详情 → 左下角 `Set` → 输入 workspace id 与 cookie（已设置的值以 `••••` + 末尾 4 位显示，聚焦即可输入新值）→ 点击外部 / Esc / 保存按钮确认，立即生效。

![Set editor](assets/set-cookie-wid.png)

### 方式二：环境变量（与 pi-ocgo-usage 同名）

```sh
export OPENCODE_GO_COOKIE="__Host-console_session=st_...; auth=Fe26.2*...; oc_locale=en"
export OPENCODE_GO_WORKSPACE_ID="wrk_01XXXXXXXXXXXXXXXXXXXXXXXX"
```

> **必须包含 `__Host-console_session`。** 控制台 API 只认这个会话 cookie；单给 `auth=` 会返回 `401`。最省事的做法是**整条粘贴**浏览器里 opencode.ai 的 cookie——`oc_locale`、`__stripe_*` 等无关项会被自动丢弃。只粘贴裸的 `st_...` 会话值也行（会自动补上 `__Host-console_session=`）。

### 方式三：配置文件

写入 `$DSH_HOME/ocgo-usage.json`（默认 `~/.dsh/ocgo-usage.json`）：

```jsonc
{
  "cookie": "__Host-console_session=st_...; auth=Fe26.2*...",
  "workspaceID": "wrk_01XXXXXXXXXXXXXXXXXXXXXXXX"
}
```

```sh
chmod 600 ~/.dsh/ocgo-usage.json
```

优先级：环境变量 > 配置文件 > 内置默认。

### 可选覆盖项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_GO_BASE_URL` | `https://opencode.ai` | 控制台站点源（API 路径 `/console/api/go/status` 由插件拼接） |
| `OPENCODE_GO_CACHE_TTL` | `300` | host 缓存秒数，范围 60–3600 |
| `OPENCODE_GO_TIMEOUT_MS` | `10000` | HTTP 超时 |

组合层配置（`~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
- id: ocgo-usage
  config:
    enabled: false    # 总开关，默认 true
```

> **Cookie 过期：** 控制台会话 cookie 过期（或退出登录）后 API 返回 `401`，chip 显示 `<err:unauthorized>` 而非过期数字。重新登录 opencode.ai 后，通过 Set 面板粘贴新的整条 cookie 即可。

## 使用

点击 chip 展开详情面板：每个窗口显示完整名称、百分比、`$已用 / $上限` 与重置倒计时；右下角 `refresh upd HH:MM` 手动刷新并显示数据时间。

![Usage detail](assets/usage-detail.png)

## 工作原理

- **Host 半**（`src/index.ts`、`src/service.ts`、`src/api.ts`、`src/routes.ts`）—— 携带 cookie 与 `x-org-id: <wrk_…>` 请求头调用控制台的 `GET /console/api/go/status`，把返回的三个金额计量表（`fiveHour` / `week` / `month`，单位 microcents，1e-8 美元）映射成 5h / 每周 / 每月窗口：百分比 = `used / limit`，倒计时来自 `resetsAt`（每月窗口用订阅周期的 `access.endsAt`，与官方控制台自身的算法一致）。结果缓存后通过同源 JSON 端点 `/api/ocgo-usage`（+ `/api/ocgo-usage/refresh`、`/api/ocgo-usage/config`）提供数据。
- **浏览器半**（`src/client/`）—— 通过 `ctx.slots.inject('conversation.input.right', …)` 向 composer 工具行注册 chip（声明延迟注册：slot 由 composer bar 拥有，插件不依赖加载顺序），只在当前会话选中 `opencode-go` 时轮询 host 端点（每 10s），按严重级别着色渲染三个窗口；可见性来自框架标准席 `useProjection('modelSelection')`。

浏览器永远看不到 cookie；抓取与解析全部在 host 侧完成。

> 控制台的 `GET /console/api/usage/*`（token 明细）**不包含** Go 订阅的用量——订阅额度只体现在 `go/status` 的金额计量表里，所以本插件展示的是金额与百分比，而不是 token 数。

## 安全

- 控制台会话 cookie 是**完整的 OpenCode 用户会话**（`__Host-console_session` + `auth`）。任何人拿到它都能访问你账户内的所有 workspace、订阅与账单信息。
- 插件**绝不**记录 cookie、不把它放进错误信息、不发送给浏览器；也**不**把粘贴内容原样转发——只保留 `__Host-console_session` / `console_session` / `auth` 三个已知名字，其余（`__stripe_*`、UI 偏好等）一律丢弃。
- 配置编辑器只把新值写入 `$DSH_HOME/ocgo-usage.json`（chmod 600），浏览器始终只看到 `••••` + 末尾 4 位的掩码视图。

## 开发

```sh
pnpm install
pnpm run build     # tsc -b && tsdown → lib/
pnpm run typecheck # tsc -b + tsconfig.vitest.json（源码 + 测试）
pnpm test          # vitest run（API 适配 / 配置 / 服务 / provider / chip 渲染）
```

`pnpm test` 会加载**构建产物** `lib/client.js`（`src/client/registration.test.ts`）来验证浏览器半的注册契约，因此改代码后先 `pnpm run build` 再跑测试；`src/client/chip.test.tsx` 则直接渲染组件源码，覆盖 provider 可见性开关。

构建配置（`shared/tsdown.client.ts`）改编自 [dsh-balance-meter](https://github.com/Ghost011118/dsh-balance-meter)（BSD-3-Clause），后者是官方 DSH `packages/client/tsdown.client.ts` 的副本——它产出 web shell 模块表所需的 `window.__ModuleLoader__.load({id, factory})` 闭包工厂产物。`shared/web-platform.ts` 的模块清单必须与所装 DSH 的 `packages/client/web/src/platform.ts` 保持一致。

## License

MIT —— 见 [LICENSE](./LICENSE)。

## Changelog

### v0.2.0 — 适配控制台改版（改用 Go 订阅 API）

**🔴 紧急修复**：opencode.ai 控制台在 2026-09 前后改成了**客户端 SPA**。`GET /console/wrk_.../go` 不再服务端渲染任何数字（现在只是一个 `<div id="app">` 空壳，1.4 KB），旧版本抓页面必然读不到用量 —— chip 只能显示错误。插件改为直接调用控制台自己使用的 JSON API：

```
GET https://opencode.ai/console/api/go/status
Cookie: __Host-console_session=st_...; auth=Fe26.2*...
x-org-id: wrk_01XXXXXXXXXXXXXXXXXXXXXXXX
```

- **认证方式变了**：API 只认 `__Host-console_session`（`st_...` 会话句柄）；旧的 `auth=Fe26.2*...` 单独使用会返回 **401**。`normalizeCookie` 相应重写：识别 `__Host-console_session` / `console_session` / `auth` 三个名字并稳定排序输出，裸的 `st_...` 自动补前缀，`oc_locale`（页面时代用于切中英文页）不再需要而被丢弃，其余无关 cookie 一律不转发。**旧配置里的 `auth=...; oc_locale=...` 需要重新粘贴整条 cookie。**
- **额度单位变了**：Go 的用量现在是**金额**上限（实测 $12 / 5h、$30 / 周、$60 / 月），API 用 BigInt 十进制字符串承载 microcents（1e-8 美元）。解析器把 `fiveHour` / `week` / `month` 映射为 5h / 每周 / 每月，百分比 = `used / limit`（保留一位小数），限流判定为 `≥100%`；每月窗口的重置时间取自订阅周期 `access.endsAt`（每月计量表本身没有 `resetsAt`），与官方控制台页面的算法一致。
- **新增绝对金额**：`UsageWindow.usage` / `limit` 现在携带 microcents，详情面板显示 `$已用 / $上限`。
- **倒计时不再被缓存冻结**：`UsageWindow` 新增绝对时间 `resetsAt`，浏览器据此实时重算剩余时间，而不是复用 host 缓存（默认 300s）里已经过期的秒数。
- **更清晰的错误**：`401` → `<err:unauthorized>`（提示重新登录并粘贴新 cookie）、`400` → `<err:badworkspace>`（workspace id 不对）、`404` → `<err:notfound>`（workspace 不存在或没有 Go 订阅）、非 JSON 响应 → `<err:parse>`。
- **删除失效代码**：SSR 页面解析器（`fromSSRHTML`、`parseDurationToSec` 及内嵌 payload / 渲染标记两条路径）已整体移除——它解析的页面不存在了。导出改为 `fromStatusJSON`、`GO_STATUS_PATH`、`WORKSPACE_HEADER`。
- **其它**：`tsconfig` 不再把 `*.test.tsx` 的产物打进 `lib/types/`；清理了 `lib/` 里遗留的旧构建分块。`pnpm test` 80 项。

### v0.1.2 - 修正用量数值 + 适配 DSH 0.1.5

**🩹 读数修正**：之前的解析器直接从渲染 HTML 里抠数字，而当前控制台把数字包在 Solid 注释标记里、且渲染成整数，导致读数错误（例如滚动/每周窗口解析不出、每月被算成 100% 已限流）。现在改为读取页面内嵌的**服务端原始数据**（`rollingUsage` / `weeklyUsage` / `monthlyUsage`）：

- 保留一位小数的真实百分比（如 `11.4%`、`65.9%`、`42%`），不再取整；
- `resetInSec` 直接用服务端秒数，不再靠解析「23 天 1 小时」这类文案（该文案的解析此前在中文下会算错）；
- 新增 `usage` / `limit` 绝对值（JSON 端点同时返回）；
- 与界面语言无关（不再依赖「滚动用量 / 5 小时用量」这类标签，也不受中英文切换影响）；
- 渲染标记解析保留为回退路径，并修好了它的正则（小数 + 中文「重置于」文案）。

**🩹 DSH 0.1.5 适配**：DSH 从 `0.1.0-rc.6` 升到 `0.1.5-rc.1` 后插件完全不可见，根因与修复：

- **provider 判断改用会话投影**：旧代码读取 `session.models` Remote 取当前 provider，该 Remote 已从 `dsh-api-session-controller` 移除（现为 `selectModel` / `modelCatalog`）。读取失败被 `catch` 吞掉 → provider 恒为 `undefined` → chip 始终不渲染。现改用框架标准席 `useProjection('modelSelection')`（host 推送的持久模型选择投影），切换 provider 同一次渲染即生效，不再依赖轮询。
- **slot 注册改为声明延迟**：`ctx.slots.inject('conversation.input.right', …)` 取代 `ctx.inject(['slots','conversation','connection'], …)`，不再假设 slot 已声明，也不再依赖 `connection` 服务形状。
- **构建对齐**：`shared/web-platform.ts` 模块清单同步到 0.1.5（`dsh-client-store`、`dsh-client-ui-dockkit`；移除已不存在的 `dsh-client-web-react`、`dsh-client-schema-form`）；编译期 SDK 依赖对齐到 `0.1.5-rc.2`。
- **回归测试**：新增 chip 渲染测试（provider 门控 / 错误态 / 展开）与构建产物注册测试，`pnpm test` 共 72 项。

### v2.0.0 - 中英双语支持

**🎉 重大更新：现在支持中文界面了！**

- **🌏 国际化 (i18n) 支持**：自动识别 DeepSeek Harness 的中文/英文界面语言
  - 新增中文标签解析：`滚动用量`、`每周用量`、`每月用量`
  - 新增中文时间单位支持：秒、分钟、小时、天、周、月、年
  - 智能匹配中英文重置提示：`Resets in` / `重置于`
- **🎨 深色模式优化**：调整 Logo 在深色主题下的对比度，视觉更舒适
- **🧪 完整测试覆盖**：新增中文场景单元测试，确保解析准确性

特别感谢 [@waknow](https://github.com/waknow) 贡献了核心的中文本地化功能！🙏

> 💡 **版本选择建议**：
> - 喜欢纯英文界面？继续使用 [v1.1.0](https://github.com/v587d/dsh-opencode-go-usage/releases/tag/v1.1.0)
> - 需要中英双语支持？升级到 v2.0.0+

---
