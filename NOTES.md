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
- 跑在**自己的 Mac mini 上**,机器 24 小时不关机、不休眠,**不需要云服务器**
- 用长连接(WebSocket)模式:无需公网 IP / 域名(Webhook 模式才要公网 HTTPS,不用)
- 放 Docker 里跑,**手动启动,不做开机自启**:`npm run up` / `npm run down` / `npm run logs`
- 启动前先打开 Docker Desktop

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
- [x] 权限管理:2026-10-08 已开通全部 22 项 `im:message*`(应用身份,均免审),含敏感权限 `im:message.group_msg`
  - ⚠️ 开了 `group_msg` 后群里**每条**消息都会推给程序,代码里必须只处理 @ 机器人的消息,否则白烧 LLM token
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

## 代码(已写,待联调)
- `src/index.ts` 飞书长连接 + 事件处理;`src/agent.ts` opencode 封装;`src/commands.ts` 斜杠命令;`src/settings.ts` 按群设置(`data/settings.json`);`src/config.ts` 读 .env
- 只在**群里**工作:响应 @ 机器人的消息;私聊只回一句提示;忽略机器人消息、按 message_id 去重
- LLM:DeepSeek(opencode 内置 provider)。本机直接跑会自动用 `~/.local/share/opencode/auth.json` 里已有的 deepseek 凭证;**Docker 里必须在 `.env` 填 `DEEPSEEK_API_KEY`**
- 上下文:每次提问新建独立 session、用完即删;注入「群里最近 10 条且 30 分钟内所有成员发言 + 被回复的那条」(`bot.config.json` 的 `contextMessages` / `contextWindowMinutes`,上限 3000 字符)
- 回复:先回「思考中…」卡片,答案出来后 patch 更新同一条(用 `im:message:update`)
- **provider / 模型可换**:`bot.config.json` 的 `providers`。不带 `baseURL` 的是 opencode 内置 provider(如 deepseek);带 `baseURL` 的是自定义 OpenAI 兼容 provider,key 从 `apiKeyEnv` 指定的环境变量读(放进 `.env`)。`model` 是默认模型,`/model` 只能在 providers 列出的模型里选。已用本地 mock 的 OpenAI 兼容服务验证过自定义 provider 链路
  - 示例:`"free1": {"name":"Free1","baseURL":"https://xxx/v1","apiKeyEnv":"FREE1_KEY","models":["model-a"]}`,再在 `.env` 加 `FREE1_KEY=...`,`npm run restart`
- 命令(群里任何人都能改,按群保存):`/help` `/model` `/context` `/search` `/reset`;`/model` 只能选 bot.config.json 里 providers 列出的模型。后续再慢慢加
- 可选白名单 `bot.config.json` 的 `allowedOpenIds`,空数组不限制;不做用量上限
- opencode server 在空目录 `workspace/` 启动,关闭 bash/edit/read 等所有文件与命令工具,只留 webfetch/websearch
- **配置与密钥分离**:普通配置(appId、模型、上下文条数、白名单)在 `bot.config.json`(提交);`.env` **只放** `FEISHU_APP_SECRET` 和 `DEEPSEEK_API_KEY`(不提交,每台机器手填)
- 改 `bot.config.json` 后 `npm run restart` 即可,不用重建镜像
- 运行:`cp .env.example .env` 填 `FEISHU_APP_SECRET`、`DEEPSEEK_API_KEY` → `npm run up`
- ⚠️ 飞书「长连接」订阅方式要先让程序连上才能在后台保存,所以顺序是:先启动 → 再去后台选长连接 → 再发布
- 已验证:Docker 镜像能构建,容器内 opencode 能启动,用假凭证会在飞书鉴权处按预期失败。**未做**真实端到端测试(没有密钥)

## 待定
- [ ] 填 .env 并联调(`npm run up`)
- [x] 后台:事件订阅 `im.message.receive_v1`(长连接)已配置
- [x] 2026-10-08 版本 1.0.0 已发布(免审核)。可用范围目前只有应用所有者;免审核最多 owner + 5 人,要让更多人用需在版本的「可用范围」里加人
- [x] 2026-10-08 真实群聊 @ 实测:飞书收发、卡片回复链路通;首次 LLM 调用失败,原因是 opencode 的 DeepSeek 目录已改名,只剩 `deepseek-flash` / `deepseek-v4-pro`(没有 `deepseek-chat`/`deepseek-reasoner`)。已改配置,默认 `deepseek/deepseek-flash`
- [x] 用 `npm run selftest -- "问题"` 在容器内直接测 LLM(含联网),已验证:普通问答 1s、联网查询 11s 正常
- [x] 群里实测通过(2026-10-08):多人讨论上下文、单独 @、追问 bot 上一条回答、`/model`、联网查询(附来源)、容器重启后仍记得自己的回复
- 飞书对新版卡片的历史消息只返回「请升级至最新版本客户端」,**读不到 bot 自己回复的内容**,所以 bot 的回复自己存到 `data/replies.json`(最近 200 条,重启不丢);读不到内容的机器人消息不放进上下文
- 每次请求会在日志打 `[ctx]`,可看到实际带了哪些上下文:`npm run logs`
- 排查 LLM 报错:`docker compose exec bot sh -c 'tail -50 /home/node/.local/share/opencode/log/opencode.log'`;模型列表:`docker compose exec bot opencode models deepseek`

## 如何测试(给 Claude)
- **直接在真实飞书里测**(用户已授权):Chrome 打开网页版 `https://www.feishu.cn/messenger/`,进「llm-bot 测试」群(chat_id 见日志 `[ctx]`),以用户身份发消息;`@` 机器人要输入 `@llm` 后回车选中,不能手打文字
- 发完用 `docker compose logs --since 2m | grep -A14 "\[ctx\]"` 看 bot 实际带的上下文
- 不经飞书直接测 LLM:`npm run selftest -- "问题"`
- 只在「llm-bot 测试」群里测,不要动用户的其他群/会话;网页版没有「加入群聊」入口,邀请链接(applink)只能唤起桌面客户端
