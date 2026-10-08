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
**首选:用 claude-dev 命令行**(以机器人身份,不用点网页,不动用户的任何会话)
- `npm run dev:bot -- new` 新建一个干净的测试群(会解散 claude-dev 自己建的旧测试群),上下文从零开始
- `npm run dev:bot -- say "文字"` 不 @ 的普通发言,模拟群里别人聊天(只会成为上下文)
- `npm run dev:bot -- send "文字"` @llm-bot 提问,等处理完,**直接打印完整运行记录**(实际带的上下文、工具调用、token、耗时、原始错误、答案)
- `npm run dev:bot -- send ""` 测试「只 @ 不带文字」
- `npm run dev:bot -- read 10` 读测试群最近消息(llm-bot 的卡片回复用本地 `data/replies.json` 补全)
- `npm run dev:bot -- api GET /im/v1/...` 原样调用飞书 API
- 测试群是 claude-dev 建的,群里只有 claude-dev 和 llm-bot(用户不在里面);用户想围观可手动加进去
- 已验证(2026-10-08):飞书**会**把「机器人 @ 机器人」的消息推给 llm-bot(靠 `im:message.group_at_msg.include_bot:readonly` 权限);llm-bot 不限制发送者,只忽略自己发的消息
- 限制:发送者是机器人而不是用户,所以测不到「用户身份」才有的差异;卡片的真实显示效果仍需网页版看一眼

**备选:网页版飞书**(以用户身份,需用户授权,只在「llm-bot 测试」群里测)
- Chrome 打开 `https://www.feishu.cn/messenger/`;`@` 机器人要输入 `@llm` 后回车选中,不能手打文字
- 网页版没有「加入群聊」入口,邀请链接(applink)只能唤起桌面客户端

**测试群的规矩(用户已明确说明)**:在测试群(「llm-bot dev」和「llm-bot 测试」)里随便发消息、不用撤回、不用清理都没关系;**唯一的红线是不能把别人拉进群**(只有用户本人、llm-bot、claude-dev)

**不经飞书直接测 LLM**:`npm run selftest -- "问题"`;看日志:`docker compose logs --since 2m | grep -A14 "\[ctx\]"`

## 运行记录(给开发 agent 用)
- 每次请求写一行到 `data/traces.jsonl`(不进 git):原话、发送者、设置、**实际带的上下文**、工具调用(搜索词/抓取的网页/耗时/返回)、token 与费用、各阶段耗时、**原始错误**、最终答案
- 查看:`npm run trace -- 3`(最近 3 条,人类可读);`npm run trace -- 3 --json` 看原始 JSON
- 注意:opencode 一次提问会拆成多条 assistant 消息(调工具、再写答案),必须读整个会话才能拿到工具调用,只看 prompt 返回的最后一条会漏

## 开发测试机器人 claude-dev(给 Claude Code 用)
- 2026-10-08 新建企业自建应用 **claude-dev**,App ID `cli_aa4d1aec7fb81cc9`,已开机器人能力、已开通「消息与群组」类 58 项免审权限、已发布 1.0.0(免审)。**不订阅事件**,只主动发/读消息
  - 控制台:https://open.feishu.cn/app/cli_aa4d1aec7fb81cc9
- 密钥 `DEV_APP_SECRET` 放 `.env`(用户自己粘贴,不提交)
- 目的:让 Claude Code 以「机器人身份」往测试群 @ llm-bot 发消息、读群消息,配合 `npm run trace` 看 llm-bot 实际带的上下文和工具调用
- 限制:飞书 API 不能冒充用户发消息,发送者是机器人。llm-bot 对发送者**不设限**(用户或其他机器人 @ 都响应),只忽略自己发的消息;用户明确说不需要信任名单、也不担心 key 用量
- 注意:open_id 是按应用隔离的,同一个人在 llm-bot 和 claude-dev 下的 open_id 不同;跨应用要用 union_id(llm-bot 的 trace 里 `sender_ids` 有)

## 免费模型 / 可接的 provider(2026-10-08 实测)
**opencode 自家的免费模型(`opencode` provider,不需要 key)**:列表有 12 个,**只有 `opencode/space-bunny-free` 能用**。其余 11 个(big-pickle、exo-free、ling-*、nemotron-3-*、step-5-preview-free 等)在我们的服务器里一律返回 403 `OpenCode's free tier can only be used from within OpenCode`——供应商限制只能在 OpenCode 自己的客户端里用,**不去绕**。本机 `opencode run` 能用,但那是 OpenCode 客户端本身。
- `space-bunny-free` 已加进 `bot.config.json`,实测:普通问答、`websearch`+`webfetch` 联网、`/model` 切换都正常(联网问答约 8~13 秒)
- 它哪天被同样限制时,群里会原样显示 403,启动时模型校验也会提示

**opencode 内置、只要在 `.env` 配 key 就能用的 provider**(环境变量名已用 `opencode models` 实测会让对应 provider 出现):
| provider | 环境变量 | 目录里的模型数 |
|---|---|---|
| openrouter | `OPENROUTER_API_KEY` | 391(其中 16 个 `:free`,如 `google/gemma-4-31b-it:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`) |
| groq | `GROQ_API_KEY` | 16 |
| cerebras | `CEREBRAS_API_KEY` | 2 |
| google | `GOOGLE_GENERATIVE_AI_API_KEY` | 38 |
| mistral | `MISTRAL_API_KEY` | 20 |
| nvidia | `NVIDIA_API_KEY` | 57 |
| siliconflow | `SILICONFLOW_API_KEY` | 57 |
| huggingface | `HF_TOKEN` | 78 |
| togetherai / fireworks-ai / xai / moonshotai / zhipuai | `TOGETHER_API_KEY` / `FIREWORKS_API_KEY` / `XAI_API_KEY` / `MOONSHOT_API_KEY` / `ZHIPU_API_KEY` | 18 / 37 / 13 / 4 / 17 |
- 各家免费额度、限速以官网为准,我没有逐一核实
- 查某家有哪些模型:`docker compose exec -e OPENROUTER_API_KEY=x bot opencode models openrouter`(key 随便填一个假的也能列出目录)
- 添加步骤:① `.env` 加真 key;② `bot.config.json` 的 `providers` 加一项,如 `"openrouter": {"models": ["google/gemma-4-31b-it:free"]}`(内置 provider 不用写 baseURL);③ `npm run restart`;④ 群里 `/model openrouter/google/gemma-4-31b-it:free`
- **不在上表里的任何 OpenAI 兼容服务**:用自定义 provider(写 `baseURL` + `apiKeyEnv`),示例见上面「provider / 模型可换」
- ⚠️ 免费模型常常不支持工具调用,或调用不稳;不支持就在群里 `/search off`,或换模型
- ⚠️ 加了 key 但没配模型名会在启动日志里看到「模型 xxx 不在 opencode 可用列表里」,以此排查

## 已确认的决定(2026-10-08,用户)
- 别的群成员可以用 bot(群成员由用户严格把控);「可用范围」不会拦群里的 @(claude-dev 不在范围内也能触发 llm-bot);真人成员第一次用时建议实测一次
- 联网抓网页的 prompt 注入风险:**接受**,bot 跑在 Docker 里,坏了重建即可,不加防护
- **长回答分多条发完整内容**,不截断:`bot.config.json` 的 `maxCardChars`(默认 6000)是单条卡片上限,按段落切分,拼起来与原文一致;第一条是「思考中…」卡片被更新,续篇另发
- **没有重启保护是用户有意为之**(手动 `npm run up`;Mac 重启/Docker 崩溃后离线直到手动启动)。不要再提议加自启/重启策略
- 默认模型 `deepseek-flash`、私聊回一句提示、上下文 10 条/30 分钟:保持默认

## 外部好友能不能用(2026-10-09 查文档 + 实看后台)
- 结论:**目前不能**。要让外部联系人用,必须先开「对外共享」,而版本页(版本管理与发布)里「允许机器人被添加到外部群中使用」「允许外部用户与机器人单聊」两个勾选框是**灰色不可点**的,悬停提示:「根据平台安全合规要求,完成**个人实名认证**后即可开启该功能」
- 官方文档(open.feishu.cn「机器人支持外部群和外部用户单聊」):不一定要企业认证,满足其一即可——企业/团队认证,或**个人实名认证**(个人版租户可走个人实名认证)
- 步骤:完成个人实名认证 → 版本管理与发布 → 新建版本 → 勾选「对外共享」两项 → 发布 → 用户在飞书里把外部好友加为外部联系人,建**外部群**,把 llm-bot 拉进去
- 实名认证要提交身份信息,**只能用户本人做**,Claude 不碰
- 文档里的限制(没实测,等认证后才能测):外部群里**只支持消息与群组里的部分 API 权限**——llm-bot 拉群历史(`im.message.list`)当上下文**可能受限**;外部用户必须先发起对话,机器人不能主动搭话;外部用户拿不到 user_access_token(我们只用 tenant 令牌,不受影响)
- 没认证的替代办法:未验证。不要假设能把好友加成「本租户成员」(个人版没有管理员后台)

## OpenRouter 免费模型(2026-10-09 实测)
- key 在 `.env` 的 `OPENROUTER_API_KEY`(用户在对话里贴出,账号是免费层 `is_free_tier=true`)
- **免费额度(官方文档,按账号计,不是按 key,多建 key 没用)**:`:free` 模型每分钟 20 次;每天 **50 次**(累计充值 <$10)或 **1000 次**(充值 ≥$10)。文档只限请求次数,没有 token 限制。超限返回 HTTP 429。查剩余:`curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"` 的 `free_model_daily_requests`(注意该计数有延迟,我测完 ~15 次仍显示 0)
- ⚠️ **一次联网提问会消耗多个请求**(模型调工具搜索一次、读结果后再答一次,通常 2~3 次),所以 50 次/天 ≈ **15~25 个联网问题**,别拿它当主力;DeepSeek 仍是默认
- 全站 467 个模型里 20 个真免费(输入输出价格都为 0),17 个支持工具调用。已加入 `bot.config.json` 并实测可用:
  - `thinkingmachines/inkling:free`(联网 5.7s,最快,1M 上下文)✅联网
  - `nvidia/nemotron-3-super-120b-a12b:free`(联网 11.9s)✅联网
  - `apodex/apodex-1.1-mini:free`(联网 7.5s)✅联网
  - `nvidia/nemotron-3-ultra-550b-a55b:free`、`nvidia/nemotron-3.5-lightning:free`、`openrouter/free`(自动路由到某个免费模型,11.5s):只测过普通问答
- 没加入:`google/gemma-4-31b-it:free`(上游限流 429)、`inclusionai/ling-3.1-flash`(44s 太慢)、`poolside/laguna-s-2.1:free`(73s 太慢);其余的没测
- 群里切换:`/model inkling`(支持模糊匹配,唯一包含即选中;多个匹配会列出候选)

## 踩坑:新容器里新模型 Model not found(已修)
- 现象:`npm run up` 新建容器后,`opencode/space-bunny-free`、`openrouter/apodex/...` 等新上架模型报 `ProviderModelNotFoundError`,而用 `opencode models`/selftest 又能看到
- 原因:新容器缓存为空,opencode 服务器先用内置旧快照启动,约 1 分钟后才后台下载新模型目录,且**不会重新加载**;`opencode models` 预热命令在下载完成前就退出了,没用
- 修复:`scripts/warm-catalog.mjs` 在 bot 启动前**同步**下载 `models.dev/api.json` 到缓存;Dockerfile 的 CMD 先跑它。同时启动时模型校验改用完整目录并等待重试
- 排查 `Unexpected server error`:`docker compose exec bot sh -c 'grep err_xxxx /home/node/.local/share/opencode/log/opencode.log'`
