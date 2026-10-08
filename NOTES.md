# 飞书 LLM 机器人 笔记

## 目标
在飞书(Feishu,非 Lark)里做一个机器人,接入自己的 LLM 做对话。

## 架构
用户发消息 → 飞书推送事件 → 本程序 → 调用 LLM → 飞书 API 回复

## 飞书侧准备
1. [open.feishu.cn](https://open.feishu.cn) 开发者后台创建**企业自建应用**
2. 添加应用能力 → **机器人**
3. 记下 App ID / App Secret(不要提交进 git,放 `.env`)
4. 权限:`im:message`、`im:message:send_as_bot`、`im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`
5. 事件与回调:订阅 `im.message.receive_v1`,订阅方式选**长连接**
6. 创建版本并发布(需管理员审批;可注册免费个人企业自己审批)

> 不要用「自定义机器人」(群 webhook),它只能发不能收。

## 部署
- 长连接(WebSocket)模式:无需公网 IP / 域名,个人电脑可跑,但电脑休眠就离线
- Webhook 模式:需要公网 HTTPS,3 秒内响应
- 要 24h 在线 → 放到云服务器,代码不用改

## 注意点
- SDK 叫 `lark-oapi`,但 domain 要用 `lark.FEISHU_DOMAIN`
- 事件可能重复推送 → 按 `message_id` 去重;LLM 调用放后台线程,回调立刻返回
- 飞书无原生流式 → 先发卡片,再 patch 更新内容
- 多轮上下文自己按 `chat_id` 存

## 运行环境
- 本机:Mac mini (Mac16,10),Apple M4,16GB,macOS 26.4
- **LLM 用的是购买的外部 API token(非自部署)**,所以暂不需要本地模型
  - 若以后要跑本地 LLM(如 Ollama),决定放 Docker 里跑
  - 注意:Docker Desktop 的容器在 macOS 上用不到 Metal GPU,会走 CPU,较慢
- 本机已装:node、npm、docker、opencode(`/opt/homebrew/bin/opencode`)

## 语言选型
- 倾向 **Node.js / TypeScript**:opencode SDK、pi 都是 TS,飞书也有官方 `@larksuiteoapi/node-sdk`
- Python 也可行(`lark-oapi`),但接 opencode / pi 要多一层

## Agent 层候选
| 方案 | 特点 | 适合度 |
|---|---|---|
| **pi** (`@mariozechner/pi-coding-agent` / `pi-agent-core` / `pi-ai`) | 极简(4 个工具 + 短 prompt),可作为 SDK 嵌入;OpenClaw 就是用它做消息机器人 | 聊天机器人场景最贴合 |
| **opencode SDK** (`@opencode-ai/sdk`) | 起 server + 类型安全 client,session/事件流/文件操作齐全,偏编码 agent | 需要让 bot 操作代码/文件时合适 |
| 仅普通对话 | 直接调 LLM API(或 Vercel AI SDK),不需要 agent 框架 | 最简单 |

> 飞书后台首页还有「创建飞书智能体应用」入口,预置权限/事件,面向 OpenClaw、Hermes Agent 这类智能体接入。

## 飞书应用进度
- [x] 已有应用 `test-claw-bot`(旧的)
- [x] 2026-10-08 新建企业自建应用 **llm-bot**,App ID `cli_aa4d2a5ea7f8dcb8`,已添加「机器人」能力
  - 控制台:https://open.feishu.cn/app/cli_aa4d2a5ea7f8dcb8
- [ ] 权限管理:开通 `im:message` 等权限
- [ ] 事件与回调:订阅 `im.message.receive_v1`,方式选长连接
- [ ] App Secret 存入 `.env`(别提交)
- [ ] 创建版本并发布

## 已决定(2026-10-08)
- Agent 层:**opencode SDK**(`@opencode-ai/sdk`,取根入口即 v1 API;包还导出 `./v2` 子路径,不用)
  - npm latest 1.18.35。注意 dist-tag `v1` 是 2025-10 的旧快照(0.0.0-v1-...),**别装那个**
- 语言:Node.js / TypeScript
- 需求:群里 @bot 时能简单查网页资料,拿到几条上下文

## 联网查询要点(opencode)
- `webfetch`:默认可用,无需配置
- `websearch`:需 opencode/OpenCode Go provider,**或设环境变量 `OPENCODE_ENABLE_EXA=1`(或 `OPENCODE_ENABLE_PARALLEL=1`)**;无需 API key
- 工具开关通过 `opencode.json` 的 `permission` 字段(allow / deny / ask);bot 无人值守,必须设成 allow 或 deny,不能 ask
- 自带 token 的外部 LLM:在 opencode config 里配 provider(baseURL + apiKey),不要写进仓库

## 飞书权限(tenant_access_token,im:message* 共 22 项,全部免审)
需要的最小集合(拟开通):
- `im:message:send_as_bot` 以应用身份发消息
- `im:message.p2p_msg:readonly` 读取单聊
- `im:message.group_at_msg:readonly` 群里 @ 机器人
- 可选:`im:message:readonly`、`im:message:update`(更新卡片/流式)、`im:message.reactions:write_only`(加表情表示处理中)

## 待定
- [ ] 外部 LLM 的 provider / baseURL / 模型名
- [ ] 确认要开通的权限清单
