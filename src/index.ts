import * as Lark from "@larksuiteoapi/node-sdk"
import { config } from "./config.js"
import { startAgent } from "./agent.js"
import { runCommand } from "./commands.js"
import { getSettings } from "./settings.js"

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

// bot 自己发的是卡片,拉历史时读不到内容,所以按 message_id 记住最近的回复
const botReplies = new Map<string, string>()
function rememberReply(id: string, text: string) {
  botReplies.set(id, text)
  if (botReplies.size > 200) botReplies.delete(botReplies.keys().next().value!)
}

function textOf(msgType: string, content: string, mentions?: any[]): string {
  let out = `[${msgType}]`
  try {
    const c = JSON.parse(content)
    if (msgType === "text") out = c.text ?? ""
    else if (msgType === "post") {
      const body = c.zh_cn ?? c.en_us ?? Object.values(c)[0]
      out = (body?.content ?? []).flat().map((x: any) => x.text ?? "").join("")
    }
  } catch {}
  for (const m of mentions ?? []) out = out.replaceAll(m.key, m.name ? `@${m.name}` : "@某人")
  return out
}

/** 群聊上下文:最近 N 条且在时间窗内的所有成员发言,加被回复的那条。不拉整个聊天记录 */
async function buildContext(chatId: string, currentId: string, parentId: string | undefined, n: number): Promise<string> {
  const lines: string[] = []
  if (n > 0) {
    try {
      const res = await api.im.message.list({
        params: { container_id_type: "chat", container_id: chatId, sort_type: "ByCreateTimeDesc", page_size: n + 1 },
      })
      const since = Date.now() - config.contextWindowMinutes * 60_000
      const labels = new Map<string, string>()
      const items = (res.data?.items ?? [])
        .filter((m) => m.message_id !== currentId && !m.deleted && m.body?.content && Number(m.create_time) >= since)
        .slice(0, n)
        .reverse()
      for (const m of items) {
        const sid = m.sender?.id ?? "?"
        const isBot = m.sender?.sender_type === "app"
        const who = isBot ? "机器人" : labels.get(sid) ?? (labels.set(sid, `成员${labels.size + 1}`), labels.get(sid)!)
        const text = (isBot && botReplies.get(m.message_id!)) || textOf(m.msg_type ?? "text", m.body!.content, m.mentions as any[])
        lines.push(`${who}: ${text}`)
      }
    } catch (e) {
      console.warn("拉取上下文失败(可能缺权限):", (e as Error).message)
    }
  }
  if (parentId) {
    try {
      const p = await api.im.message.get({ path: { message_id: parentId } })
      const m = p.data?.items?.[0]
      if (m?.body?.content) lines.push(`(被回复的消息) ${botReplies.get(parentId) ?? textOf(m.msg_type ?? "text", m.body.content, m.mentions as any[])}`)
    } catch {}
  }
  return lines.join("\n").slice(-config.contextMaxChars)
}

const card = (md: string) =>
  JSON.stringify({ schema: "2.0", body: { elements: [{ tag: "markdown", content: md.slice(0, 8000) }] } })

async function replyText(messageId: string, text: string) {
  await api.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "text", content: JSON.stringify({ text }) },
  })
}

async function handle(data: any) {
  const msg = data.message
  if (!msg || isDup(msg.message_id)) return
  if (data.sender?.sender_type !== "user") return // 忽略机器人消息,避免死循环
  const senderId: string | undefined = data.sender?.sender_id?.open_id
  if (config.allowedOpenIds.length && !(senderId && config.allowedOpenIds.includes(senderId))) return

  if (msg.chat_type !== "group") {
    await replyText(msg.message_id, "我只在群里工作,把我拉进群并 @ 我吧。").catch(() => {})
    return
  }
  // 开了 group_msg 权限后群里每条消息都会推过来,这里只处理 @ 我的
  if (!(msg.mentions ?? []).some((m: any) => m.id?.open_id === botOpenId)) return

  const question = textOf(msg.message_type, msg.content, (msg.mentions ?? []).map((m: any) => ({ ...m, name: m.id?.open_id === botOpenId ? "" : m.name })))
    .replace(/@某人/g, "")
    .trim()
  if (!question) return

  const cmd = runCommand(msg.chat_id, question)
  if (cmd !== null) return void (await replyText(msg.message_id, cmd))

  // 先回「思考中」卡片,答案出来后更新同一条
  const placeholder = await api.im.message.reply({
    path: { message_id: msg.message_id },
    data: { msg_type: "interactive", content: card("⏳ 思考中…") },
  })
  const cardId = placeholder.data?.message_id

  let answer: string
  try {
    const s = getSettings(msg.chat_id)
    const context = await buildContext(msg.chat_id, msg.message_id, msg.parent_id, s.context)
    console.log(`[ctx] chat=${msg.chat_id} q=${JSON.stringify(question)} ctx_chars=${context.length}\n${context}`)
    answer = await agent.ask(question, context, s)
  } catch (e) {
    console.error("处理失败:", e)
    answer = (e as Error).message // 原样输出,不再包一层
  }
  if (cardId) rememberReply(cardId, answer)
  if (cardId) await api.im.message.patch({ path: { message_id: cardId }, data: { content: card(answer) } })
  else await replyText(msg.message_id, answer)
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

const stop = () => { agent.close(); process.exit(0) }
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
