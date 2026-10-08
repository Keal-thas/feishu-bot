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

## 待定
- [ ] LLM 调用方式(OpenAI 兼容 / Ollama / 其他)
- [ ] 语言选型(默认 Python)
