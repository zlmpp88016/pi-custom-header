# pi-custom-header

[English](./README.en.md) | **中文**

一个可以为 [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) 提供动态请求头覆写的插件，支持按 provider 设置默认模板，并为特定 model 使用 Claude Code、Codex 等专属模板，同时支持 `pi-maestro-teammate` 子代理进程无缝继承请求头配置。

能够生成按会话、按轮次变化的**动态值**（会话 ID、Codex turn 元数据、请求 ID 等），这些用 `models.json` 里的静态 headers 无法实现。

## 解决什么问题

在 `models.json` 里，pi 可以为每个 provider / model 配置静态 `headers`，但静态配置没法跟随会话 ID，也不会每轮变化。这个扩展在 pi 组装好静态 headers **之后**运行（所以可以覆盖它们），并在请求发出前从 `ctx` 里填上动态值。

provider 规则适合为一个网关设置默认 Header；model 规则则处理专属客户端模板。比如 `Axon` 可以默认使用 `custom.headers`，但 `gpt-5.5` 改用 Codex 模板、`claude-opus-4-8` 改用 Claude Code 模板。model 规则命中后会完整替代 provider 模板，不会把两套客户端 Header 混在一起。

## 安装

```bash
pi install git:github.com/rays1d/pi-custom-header
```

安装只是注册代码，**不会自动生成任何东西**。没有 `config.json` 时，扩展没有任何规则，所有请求都原样通过（唯一会自动生成的文件是首次使用时的 `installation-id`）。所以你需要自己把示例配置和模板复制到用户配置目录，再重载：

```bash
# 用户配置目录：~/.pi/agent/extensions/pi-custom-header/
mkdir -p ~/.pi/agent/extensions/pi-custom-header
cp config/config.example.json ~/.pi/agent/extensions/pi-custom-header/config.json
cp templates/*.headers        ~/.pi/agent/extensions/pi-custom-header/
```

然后在 pi 里执行 `/reload`。

## 目录布局

```
代码（本仓库）                                用户数据（~/.pi/agent/extensions/pi-custom-header/）
├── index.ts                                ├── config.json            # 规则
├── src/                                    ├── claude-code.headers    # 模板
├── templates/                              ├── codex.headers
│   ├── claude-code.headers                 ├── custom.headers         # provider 默认模板
│   ├── codex.headers                       └── installation-id        # 首次使用时生成，机器固定
│   └── custom.headers
└── config/config.example.json
```

模板按以下顺序查找，命中即停：**① 用户扩展目录下、和 `config.json` 同级的平铺位置**（推荐改这里）→ **② 用户目录下的 `templates/` 子目录**（旧版布局，仍兼容）→ **③ 随包内置的默认模板**。

路径解析遵循 `PI_CODING_AGENT_DIR` 环境变量（默认 `~/.pi/agent`）。

## 配置（config.json）

```json
{
  "rules": [
    { "match": { "provider": "Axon", "modelId": "gpt-5.5" }, "template": "codex.headers" },
    { "match": { "provider": "Axon", "modelIdRegex": "^claude-" }, "template": "claude-code.headers" },
    { "match": { "provider": "Axon" }, "template": "custom.headers" }
  ],
  "blacklist": ["Authorization", "Content-Length", "Host", "Content-Encoding", "Connection", "Accept-Encoding"],
  "sandbox": "windows_sandbox",
  "teammate": true,
  "debug": false
}
```

| 字段 | 说明 |
|------|------|
| `rules` | 规则列表。固定按 **model 级 > provider 级 > 全局兜底级** 选择一个模板；同一级内按顺序取第一条命中规则。 |
| `match.provider` | 与 `ctx.model.provider` 相等（如 `Axon`）。区分大小写。可选。 |
| `match.modelId` | 与 `ctx.model.id` 相等（如 `gpt-5.5`）。区分大小写。可选。 |
| `match.modelIdRegex` | 用正则匹配 `ctx.model.id`（如 `^claude-` 可匹配 `claude-opus-4-8/4-7/4-6`）。可选。 |
| `blacklist` | 绝不写入请求的头部名称（不区分大小写），用来保护鉴权信息和传输层头部。 |
| `sandbox` | Codex turn 元数据里 `sandbox` 字段的值，默认 `windows_sandbox`。可选值：`windows_sandbox`、`windows_elevated`、`seatbelt`（macOS）、`seccomp`（Linux）、`none`（关闭沙箱 / 完全访问，慎用）、`external`。这个值要和你模板 `user-agent` 里**声称**的平台一致，而不是真实主机平台——比如你把 UA 改成了 macOS，这里就要写 `seatbelt`。 |
| `teammate` | 是否自动传播至 `pi-maestro-teammate` 子代理进程，默认 `true`。开启后子代理进程也会加载本插件并应用自定义 Header。 |
| `debug` | 调试开关，默认 `false`。设为 `true` 时，把诊断日志（token 已脱敏）写到用户扩展目录下的 `pi-custom-header.log`；默认关闭，零副作用。 |

含 `modelId` 或 `modelIdRegex` 的规则属于 model 级；只含 `provider` 的规则属于 provider 级；空 `match: {}` 是全局兜底级。跨级优先级固定，不受数组排列位置影响；同一级仍按配置顺序选择。`match` 里设置了多个字段时，需要**全部满足**（AND 关系）。model 规则命中后只应用其模板，provider 模板完全不生效；没有匹配到任何规则的模型（或请求本身没有 model）会被直接放行。模板里若有占位符没有注册生成器，那一行会被丢弃，绝不会把原始 `{{token}}` 发出去。

## 模板

模板就是**原始 HTTP 头文本**：每行一个 `Key: Value`，按第一个 `:` 切分（值里可以再包含 `:`）。空行和以 `#` 开头的注释会被忽略。除了黑名单以外，Header 名没有白名单限制：可以在 `custom.headers` 中继续添加任意合法 Header 行，都会生效。

Header 名按 HTTP 语义**不区分大小写**。写入每一行前，扩展会删除 Pi 已有 Header 中所有同名大小写变体，再以模板中的键和值写入。因此已有的 `User-Agent` 与模板中的 `user-agent` 不会并存，最终只保留模板定义的一个键；模板自身重复定义同名 Header 时，最后一行生效。对于 session ID，`Session-Id` / `SESSION-ID` 与 `Session_id` / `SESSION_ID` 等大小写变体都会被清理，最终只保留规范的 `session-id`（连字符）版本。

动态行用 `{{占位符}}` 标记：

| 占位符 | 值 |
|--------|-----|
| `{{session_id}}` | `ctx.sessionManager.getSessionId()` |
| `{{parent_session_id}}` | 父会话 ID（在 teammate 子代理中运行时解析父会话 ID，主会话中等于当前 session_id） |
| `{{correlation_id}}` | teammate 子代理关联 ID（`PI_TEAMMATE_CORRELATION_ID`） |
| `{{is_teammate}}` | 是否处于 teammate 子代理进程（`"true"` 或 `"false"`） |
| `{{window_id}}` | `<session_id>:0` |
| `{{request_id}}` | 兼容旧模板的别名，等同于当前 session id（推荐新模板使用 `{{session_id}}`） |
| `{{installation_id}}` | 持久化的机器稳定 UUID |
| `{{codex_turn_metadata}}` | 紧凑 JSON：`installation_id, session_id, thread_id, turn_id, window_id, request_kind, thread_source, sandbox, turn_started_at_unix_ms`（字段顺序和真实 Codex 抓包一致；`sandbox` 取自配置项；`workspaces` 有意省略） |

占位符按**单次钩子触发**缓存：同一次请求里所有 `{{session_id}}` 和兼容别名 `{{request_id}}` 都等于当前 session id；`turn_id` 仍按每次触发重新生成。旧用户模板即使继续使用 `x-client-request-id: {{request_id}}`，更新插件后也会自动与 session 绑定。

### 接入新后端

为整个 provider 设置默认 Header 时，添加一条只含 `provider` 的规则；为某类 model 设置例外时，再添加含 `modelId` 或 `modelIdRegex` 的规则。必要时补一个模板文件并复用已有占位符。只有出现全新的动态字段，才需要去 `src/placeholders.ts` 里加生成器。

## 安全

- **`Authorization` 必须留在黑名单里。** 从抓包转写来的模板可能带着真实的 `Bearer` token，黑名单能保证扩展绝不覆盖 pi 的真实凭证。
- **别把真实 token 或 `installation-id` 提交进仓库。** 仓库内模板只用占位符；`.gitignore` 已防止 `installation-id` 和 `*.local.headers` / `*.real.headers` 被误提交。
- 所有异常路径——配置缺失或损坏、模板读不到、模型不存在、正则写错——都会**静默放行**，扩展绝不会抛错或阻断 provider 请求。

## 开发

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # 单元 + 集成测试
```

## 致谢

感谢 [LINUX DO](https://linux.do) 社区。学 AI，上 L 站。

## License

MIT