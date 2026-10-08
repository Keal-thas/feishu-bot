import * as Lark from "@larksuiteoapi/node-sdk"
import { config } from "./config.js"
import { startAgent } from "./agent.js"
import { runCommand } from "./commands.js"
import { getSettings } from "./settings.js"
import { getReply, rememberReply } from "./replies.js"
import { writeTrace } from "./trace.js"

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
/** 话题里 @:上下文 = 整个话题的完整对话(含根消息),不套用条数/时间窗 */
async function buildThreadContext(threadId: string, skipIds: string[]): Promise<string> {
  const lines: string[] = []
  try {
    const res = await api.im.message.list({
      params: { container_id_type: "thread", container_id: threadId, sort_type: "ByCreateTimeDesc", page_size: Math.min(50, config.threadMaxMessages + 4) },
    })
    const labels = new Map<string, string>()
    const items = (res.data?.items ?? [])
      .filter((m) => !skipIds.includes(m.message_id!) && m.msg_type !== "system" && !m.deleted && m.body?.content)
      .slice(0, config.threadMaxMessages)
      .reverse()
    for (const m of items) {
      const isApp = m.sender?.sender_type === "app"
      const isSelf = isApp && m.sender?.id === config.appId
      const sid = m.sender?.id ?? "?"
      const who = isSelf ? "机器人" : isApp ? "其他机器人" : labels.get(sid) ?? (labels.set(sid, `成员${labels.size + 1}`), labels.get(sid)!)
      const text = isSelf ? getReply(m.message_id!) : textOf(m.msg_type ?? "text", m.body!.content, m.mentions as any[])
      if (text) lines.push(`${who}: ${text}`)
    }
  } catch (e) {
    console.warn("拉取话题上下文失败:", (e as Error).message)
  }
  return lines.join("\n").slice(-config.threadMaxChars)
}

async function buildContext(chatId: string, skipIds: string[], parentId: string | undefined, n: number): Promise<string> {
  const lines: string[] = []
  if (n > 0) {
    try {
      const res = await api.im.message.list({
        params: { container_id_type: "chat", container_id: chatId, sort_type: "ByCreateTimeDesc", page_size: n + 3 },
      })
      const since = Date.now() - config.contextWindowMinutes * 60_000
      const labels = new Map<string, string>()
      const items = (res.data?.items ?? [])
        .filter((m) => !skipIds.includes(m.message_id!) && m.msg_type !== "system" && !m.deleted && m.body?.content && Number(m.create_time) >= since)
        .slice(0, n)
        .reverse()
      for (const m of items) {
        const isApp = m.sender?.sender_type === "app"
        const isSelf = isApp && m.sender?.id === config.appId // llm-bot 自己的回复是卡片,内容只能从本地记录取
        const sid = m.sender?.id ?? "?"
        const who = isSelf ? "机器人" : isApp ? "其他机器人" : labels.get(sid) ?? (labels.set(sid, `成员${labels.size + 1}`), labels.get(sid)!)
        const text = isSelf ? getReply(m.message_id!) : textOf(m.msg_type ?? "text", m.body!.content, m.mentions as any[])
        if (text) lines.push(`${who}: ${text}`) // 读不到内容的机器人消息(如重启前的卡片)直接跳过
      }
    } catch (e) {
      console.warn("拉取上下文失败(可能缺权限):", (e as Error).message)
    }
  }
  if (parentId) {
    try {
      const p = await api.im.message.get({ path: { message_id: parentId } })
      const m = p.data?.items?.[0]
      if (m?.body?.content) lines.push(`(被回复的消息) ${getReply(parentId) ?? textOf(m.msg_type ?? "text", m.body.content, m.mentions as any[])}`)
    } catch {}
  }
  return lines.join("\n").slice(-config.contextMaxChars)
}

const card = (md: string) =>
  JSON.stringify({ schema: "2.0", body: { elements: [{ tag: "markdown", content: md }] } })

/** 按段落切成不超过 max 字的几块;单段过长再硬切。拼起来和原文完全一致,不丢字 */
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max)
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max)
    if (cut < max / 2) cut = max
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, "")
  }
  if (rest) out.push(rest)
  return out
}

async function replyText(messageId: string, text: string, inThread = false) {
  await api.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "text", content: JSON.stringify({ text }), reply_in_thread: inThread },
  })
}

async function handle(data: any) {
  const msg = data.message
  if (!msg || isDup(msg.message_id)) return
  // 不限制发送者(用户或其他机器人都响应),只忽略自己发的消息,避免自己回复自己
  if (data.sender?.sender_id?.open_id === botOpenId) return
  const senderId: string | undefined = data.sender?.sender_id?.open_id
  if (config.allowedOpenIds.length && !(senderId && config.allowedOpenIds.includes(senderId))) return

  if (msg.chat_type !== "group") {
    await replyText(msg.message_id, "我只在群里工作,把我拉进群并 @ 我吧。").catch(() => {})
    return
  }
  // 开了 group_msg 权限后群里每条消息都会推过来,这里只处理 @ 我的
  if (!(msg.mentions ?? []).some((m: any) => m.id?.open_id === botOpenId)) return

  let question = textOf(msg.message_type, msg.content, (msg.mentions ?? []).map((m: any) => ({ ...m, name: m.id?.open_id === botOpenId ? "" : m.name })))
    .replace(/@某人/g, "")
    .trim()
  // 只 @ 了机器人、没写别的:让它回应上面群聊里最近的话题
  if (!question) question = "(只 @ 了你,没有附加文字。请直接回应群聊上下文里最近的问题或话题。)"

  // 在话题里 @:上下文用整个话题的完整对话,回复也留在话题里;不在话题里:用群里最近的消息
  const threadId: string | undefined = msg.thread_id || undefined
  const inThread = !!threadId
  const t0 = Date.now()
  const trace: Record<string, unknown> = {
    chat: msg.chat_id, thread_id: threadId, context_mode: inThread ? "thread" : "recent",
    sender: senderId, sender_ids: data.sender?.sender_id, message_id: msg.message_id, question,
  }

  const cmd = runCommand(msg.chat_id, question)
  if (cmd !== null) {
    await replyText(msg.message_id, cmd, inThread)
    return writeTrace({ ...trace, kind: "command", answer: cmd, timings: { total_ms: Date.now() - t0 } })
  }

  // 先回「思考中」卡片,答案出来后更新同一条
  const placeholder = await api.im.message.reply({
    path: { message_id: msg.message_id },
    data: { msg_type: "interactive", content: card("⏳ 思考中…"), reply_in_thread: inThread },
  })
  const cardId = placeholder.data?.message_id

  let answer: string
  const timings: Record<string, number> = {}
  try {
    const s = getSettings(msg.chat_id)
    trace.settings = s
    const tc = Date.now()
    const skip = [msg.message_id, cardId ?? ""]
    const context = inThread ? await buildThreadContext(threadId!, skip) : await buildContext(msg.chat_id, skip, msg.parent_id, s.context)
    timings.context_ms = Date.now() - tc
    trace.context = context
    console.log(`[ctx] chat=${msg.chat_id} mode=${inThread ? "thread" : "recent"} q=${JSON.stringify(question)} ctx_chars=${context.length}\n${context}`)
    const tl = Date.now()
    const r = await agent.ask(question, context, s)
    timings.llm_ms = Date.now() - tl
    answer = r.answer
    Object.assign(trace, { tools: r.tools, tokens: r.tokens, cost: r.cost })
  } catch (e) {
    console.error("处理失败:", e)
    answer = (e as Error).message // 原样输出,不再包一层
    trace.error = answer
  }
  trace.answer = answer
  if (cardId) rememberReply(cardId, answer)
  const chunks = splitText(answer, config.maxCardChars)
  if (cardId) await api.im.message.patch({ path: { message_id: cardId }, data: { content: card(chunks[0]) } })
  else await replyText(msg.message_id, chunks[0], inThread)
  for (const c of chunks.slice(1)) {
    await api.im.message.reply({ path: { message_id: msg.message_id }, data: { msg_type: "interactive", content: card(c), reply_in_thread: inThread } })
  }
  timings.total_ms = Date.now() - t0
  writeTrace({ ...trace, kind: "question", timings })
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
