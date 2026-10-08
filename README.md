# @letter2025/dsh-search-mcp

用搜索类 MCP 服务器完整替代 DeepSeek Harness（DSH）内置网页搜索的独立插件。

> 当前兼容基线：DeepSeek Harness `0.2.0-rc.2`，Node.js 20 或更高版本。
>
> 本仓库基于 [gxpppp/dsh-search-mcp](https://github.com/gxpppp/dsh-search-mcp) 继续维护，并适配 dsh 0.2.0-rc.2。

## 功能

- 模型侧继续使用原生 `web_search`，插件只替换底层 search provider。
- 支持 Tavily、Brave、Exa、Perplexity、DuckDuckGo 和自定义 HTTP/stdio MCP。
- 已知 provider 只需选择服务商并填写 CDKey/API key，不需要填写 URL、命令、鉴权参数或工具名。
- 自定义 MCP 保留 URL、stdio 命令、鉴权方式和工具名等高级配置。
- 密钥写在插件行的 secret 字段，或只填引用名交由 DSH credentials domain / 启动环境变量在搜索时解析；密钥值不会出现在普通设置字段中。
- DSH RC2 支持一次 `web_search` 提交多个查询，默认上限为 4。
- 卸载插件后 bundle 覆盖层随之移除，DSH 内置搜索组合恢复。

## 安装

```powershell
# 从 npm 安装（推荐）
dsh plugin --profile web add @letter2025/dsh-search-mcp
dsh web

# 或本地源码 + link:，改完即时生效
git clone https://github.com/Letter2025/dsh-search-mcp.git
cd dsh-search-mcp
npm install
dsh plugin --profile web add link:<仓库的绝对路径>
dsh web
```

`link:` 会让源码更新直接作用于 profile。插件只有宿主侧代码，改完重启 DSH Web 即可生效。

如果 profile 中已有独立搜索 MCP 行，建议先移除重复入口，避免同时暴露 `mcp__...` 工具和本插件提供的 `web_search`。

## 配置

打开：

**设置 → 插件 → 插件配置 → 搜索 MCP**

### 已知 provider

1. 点击 Tavily、Brave、Exa、Perplexity 或 DuckDuckGo 快捷按钮。
2. 展开服务器行。
3. 对需要凭据的 provider 填写 CDKey/API key，然后保存。
4. DuckDuckGo 无需 key。

已知 provider 的 endpoint、transport、鉴权方式、工具名和结果参数由 Host catalog 固定管理，设置页只显示服务商、ID、结果数和密钥字段。CDKey/API key 直接保存在插件行的 secret 字段；也可以只填 `apiKeyEnv` 引用名，搜索时按 内联 `apiKey` → credentials domain → 启动环境变量 的顺序解析。

也可以预先在 `$DSH_HOME/.credentials.yaml` 中保存凭据，再在设置页填写引用名：

```yaml
TAVILY_API_KEY: <your-key>
EXA_API_KEY: <your-key>
PERPLEXITY_API_KEY: <your-key>
BRAVE_API_KEY: <your-key>
```

凭据在每次搜索时按需解析，插件不缓存密钥值，也不会把密钥写回普通设置字段。

### 自定义 MCP

添加 `custom` 服务器后，可配置：

| 字段 | 说明 |
|---|---|
| `id` | 服务器唯一标识，供 `defaultServer` 引用 |
| `transport` | `http`（Streamable HTTP）或 `stdio` |
| `url` | 仅 HTTP 自定义 MCP 使用 |
| `command` / `args` | 仅 stdio 自定义 MCP 使用 |
| `apiKey` | 写入方向的 CDKey/API key 输入 |
| `apiKeyEnv` | 环境变量或 DSH credential reference |
| `authStyle` | HTTP 的 `query` 或 `header` |
| `authParam` | query/header 参数名；stdio 下作为环境变量名 |
| `toolName` | MCP 搜索工具名称 |
| `maxResults` | 单服务器结果数覆盖 |

### 全局选项

| 字段 | 说明 |
|---|---|
| `defaultServer` | 默认服务器 id；留空时使用第一行 |
| `maxResults` | 全局结果数上限，默认 8，可选 1–50 |
| `searchTimeoutMs` | 每次 MCP 搜索超时，默认 30000 ms；界面以秒显示 |

## Provider 预设

| kind | Host 管理的连接 | 凭据 | 搜索工具 | 结果数参数 |
|---|---|---|---|---|
| `tavily` | hosted Streamable HTTP | CDKey/API key | `tavily_search` | `max_results` |
| `brave` | `@brave/brave-search-mcp-server@2.1.3` stdio | `BRAVE_API_KEY` | `brave_web_search` | `count` |
| `exa` | hosted Streamable HTTP | `x-api-key` | `web_search_exa` | `numResults` |
| `perplexity` | hosted Streamable HTTP | Bearer token | `perplexity_search` | `max_results` |
| `duckduckgo` | `duckduckgo-mcp-server@0.1.2` stdio | 无 | `duckduckgo_web_search` | `count` |
| `custom` | 用户配置 | 用户配置 | 用户配置 | 无预设 |

旧配置中的 known-provider URL、transport、auth 和 tool 字段仍可被 schema 读取，但运行时会忽略它们；下一次保存服务器列表时会清理这些冗余字段。只有 `custom` 使用用户提供的连接信息。

插件在调用 known provider 前会把结果数限制到上游 MCP schema 接受的范围：Tavily 为 5–20，Brave、Perplexity 和 DuckDuckGo 为 1–20；Exa 当前保留插件的 1–50 范围。该限制只影响传给上游的参数，最终返回数量仍会受到插件全局/单服务器限制和实际 agent preset 的 `tool-web.searchMaxResults` 共同约束。

## DSH 0.2.0-rc.2 适配

- 宿主依赖按 peer 锁定 `^0.2.0-rc.2`（cordis `~4.0.4`、schemastery `^3.18.4`），不使用可能落到旧版本线的子包 `latest`。
- 插件只有宿主半边：dsh 0.1.7 起设置页按插件 Config schema 自动生成表单，`dsh.client`、`./client` 导出与浏览器 bundle 均已删除。
- 插件行的 profile 配置（bundle patch + profile 覆盖）是唯一配置来源；设置页保存会重载插件实例，`apply` 收到新配置。
- 密钥字段用 `role('secret')`、引用名用 `role('credential-ref')`；解析顺序为内联 `apiKey` → DSH credentials domain → 启动环境变量。
- `tool-web.searchMaxQueries` 配置为 4，与 RC2 默认多查询能力一致。

## URL 安全策略

所有自定义 HTTP MCP 请求在联网前执行安全校验：

- 只允许 `http:` 和 `https:`，拒绝 userinfo 与非规范 IPv4 表示。
- 拒绝 localhost、环回、RFC1918 私网、链路本地、CGNAT、benchmark、文档/测试、多播、保留和广播地址。
- IPv4-mapped IPv6 先映射为 IPv4 再判断；IPv4-compatible IPv6、IPv6 ULA、link-local、NAT64/转换、Teredo、6to4、文档和保留范围同样拒绝。
- 域名会解析全部 A/AAAA 结果；任意一个结果不公开可路由时整体拒绝，DNS 等待也受同一个搜索 AbortSignal/超时约束。
- 每次搜索使用独占 Undici Agent 和预解析地址的 pinned lookup，同时保留原始 Host 与 TLS SNI，防止 DNS rebinding。
- GET、POST、DELETE 和 SSE 重连都通过同一 fetch wrapper，HTTP 重定向设置为 `error`。
- 先关闭 MCP client，再关闭本次 Agent，不共享连接池。
- 错误信息不会输出包含 CDKey 的完整 URL。

如果代理或 TUN 把公共域名解析到 `198.18.0.0/15` fake-IP，本插件会按 benchmark/test 网段安全拒绝。应让 DSH 进程获得真实公网 DNS 结果，而不是放宽策略。

## 组合覆盖

插件通过 `cordis.patch.yml`：

- 注册 `search-mcp` provider。
- 设置 `web.searchProvider: search-mcp`。
- 禁用 `web-search-deepseek`。
- 保持 `web_fetch` 关闭。
- 请求 `tool-web.searchMaxResults: 50` 和 `searchMaxQueries: 4`。

RC2 的 standard、code、cordis agent preset 各自包含 `tool-web` 行，并且都省略了 `searchMaxResults` 和 `searchMaxQueries`，因此实际采用 `dsh-tool-web` 默认值 8 和 4。agent-scoped 工具会遮蔽根层同名工具，所以根层 patch 中的 50 条请求不会提高这些 shipped preset 的实际上限。验证结果上限时必须检查 session 使用的 preset，不能只依据根层 `--dump-config`。

## 验证

```powershell
npm test
npm run check
npm pack --dry-run
```

自动测试（`npm test`，20 个用例）覆盖 0.2.0-rc.2 依赖锁定与宿主 config 解析、known/custom catalog 边界、provider 契约与结果数上限、结果归一化，以及 URL/DNS/pinning 安全策略。

2026-08-30 的隔离 RC2 Web 冒烟检查确认：插件卡片可加载；默认 Tavily 行不显示链接或高级连接字段；DuckDuckGo 摘要显示“无需密钥”，展开后只有 ID、provider 和结果数；测试草稿已放弃且没有写入 settings。无密钥 DuckDuckGo stdio server 能启动并收到正确的 `duckduckgo_web_search`/`count` 调用，但当次公开搜索被 DuckDuckGo 上游异常流量检测拒绝，因此未取得可用于结果归一化验收的真实来源。

组合检查：

```powershell
dsh --profile web --dump-config |
  Select-String -Pattern "searchProvider|search-mcp|web-search-deepseek|searchMaxResults|searchMaxQueries"
```

预期至少包括：

- `web.searchProvider: search-mcp`
- `web-search-deepseek.disabled: true`
- `tool-web.disabled: false`
- `fetch: false`

实际 agent preset 的结果数和多查询上限应在隔离 profile/session 中单独验证。

## 故障排查

- `no search MCP servers configured`：在设置页添加 provider。
- `has no API key`：填写 CDKey/API key，或填写已有 credential reference。
- “凭证未配置”：引用名存在于 settings，但 credentials provider 当前找不到对应值。
- `defaultServer "x" is not configured`：默认 id 没有匹配任何服务器行。
- `URL policy` 拒绝：endpoint 非 HTTP(S)，或 DNS 结果包含本地、私有、保留/测试地址。
- stdio 启动失败：确认 Node/npm 可用，且运行环境允许 `npx` 获取或执行对应 MCP 包。
- 设置页没有 Search MCP 表单：确认 profile 中的插件行已启用（`dsh --profile <profile> --dump-config`），然后重启 DSH Web。
- 返回结果仍被截断：检查实际 agent preset 中的 `tool-web.searchMaxResults`，以及全局/单服务器 `maxResults`。

## 卸载

```powershell
dsh plugin --profile web remove @letter2025/dsh-search-mcp
```

随后重启 DSH Web。不要只禁用 `search-mcp` 行，因为 bundle 还覆盖了 `web`、`web-search-deepseek` 和 `tool-web`；完整卸载 bundle 才会恢复内置组合。

## License

MIT
