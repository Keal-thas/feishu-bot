import * as Lark from "@larksuiteoapi/node-sdk"
import { config } from "./config.js"
import { startAgent } from "./agent.js"

const base = { appId: config.appId, appSecret: config.appSecret, domain: Lark.Domain.Feishu }
const api = new Lark.Client(base)
const agent = await startAgent()

// 机器人自己的 open_id,用来判断群消息是不是 @ 了它
const botInfo: any = await api.request({ method: "GET", url: "/open-apis/bot/v3/info" })
const botOpenId: string | undefined = botInfo?.bot?.open_id
if (!botOpenId) throw new Error(`获取机器人信息失败: ${JSON.stringify(botInfo)}`)
console.log(`bot ready, open_id=${botOpenId}`)

// 事件可能重复推送,按 message_id 去重
const seen = new Map<string, number>()
function isDup(id: string): boolean {
  const now = Date.now()
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k)
  if (seen.has(id)) return true
  seen.set(id, now)
  return false
}

function textOf(msgType: string, content: string): string {
  try {
    const c = JSON.parse(content)
    if (msgType === "text") return c.text ?? ""
    if (msgType === "post") {
      const body = c.zh_cn ?? c.en_us ?? Object.values(c)[0]
      return (body?.content ?? []).flat().map((x: any) => x.text ?? "").join("")
    }
  } catch {}
  return `[${msgType}]`
}

// 只取最近几条 + 被回复的那条,不拉整个聊天记录
async function buildContext(chatId: string, currentId: string, parentId?: string): Promise<string> {
  const lines: string[] = []
  try {
    const res = await api.im.message.list({
      params: { container_id_type: "chat", container_id: chatId, sort_type: "ByCreateTimeDesc", page_size: config.contextMessages + 1 },
    })
    const items = (res.data?.items ?? []).filter((m) => m.message_id !== currentId).reverse()
    for (const m of items) {
      if (!m.body?.content || m.deleted) continue
      const who = m.sender?.sender_type === "app" ? "机器人" : "用户"
      lines.push(`${who}: ${textOf(m.msg_type ?? "text", m.body.content)}`)
    }
  } catch (e) {
    console.warn("拉取上下文失败(可能缺权限):", (e as Error).message)
  }
  if (parentId) {
    try {
      const p = await api.im.message.get({ path: { message_id: parentId } })
      const m = p.data?.items?.[0]
      if (m?.body?.content) lines.push(`(被回复的消息) ${textOf(m.msg_type ?? "text", m.body.content)}`)
    } catch {}
  }
  return lines.join("\n").slice(-config.contextMaxChars)
}

async function reply(messageId: string, markdown: string) {
  await api.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "post", content: JSON.stringify({ zh_cn: { content: [[{ tag: "md", text: markdown }]] } }) },
  })
}

async function handle(data: any) {
  const msg = data.message
  if (!msg || isDup(msg.message_id)) return
  if (data.sender?.sender_type !== "user") return // 忽略机器人消息,避免死循环
  const isGroup = msg.chat_type === "group"
  const mentioned = (msg.mentions ?? []).some((m: any) => m.id?.open_id === botOpenId)
  if (isGroup && !mentioned) return // group_msg 权限会收到所有群消息,这里只处理 @ 我的

  // 去掉 @机器人 占位符 (@_user_1)
  let question = textOf(msg.message_type, msg.content)
  for (const m of msg.mentions ?? []) question = question.replaceAll(m.key, "")
  question = question.trim()
  if (!question) return

  // 先点个表情表示收到了
  api.im.messageReaction
    .create({ path: { message_id: msg.message_id }, data: { reaction_type: { emoji_type: "OnIt" } } })
    .catch(() => {})

  try {
    const context = await buildContext(msg.chat_id, msg.message_id, msg.parent_id)
    const answer = await agent.ask(question, context)
    await reply(msg.message_id, answer)
  } catch (e) {
    console.error("处理失败:", e)
    await reply(msg.message_id, `⚠️ 出错了:${(e as Error).message}`).catch(() => {})
  }
}

const dispatcher = new Lark.EventDispatcher({}).register({
  // 回调里立刻返回,真正处理放后台,避免飞书超时重推
  "im.message.receive_v1": async (data: any) => {
    void handle(data).catch((e) => console.error(e))
  },
})

const ws = new Lark.WSClient({ ...base, loggerLevel: Lark.LoggerLevel.info })
await ws.start({ eventDispatcher: dispatcher })
console.log("长连接已启动,等待消息…")

process.on("SIGINT", () => { agent.close(); process.exit(0) })
