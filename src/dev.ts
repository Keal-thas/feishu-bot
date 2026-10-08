// Claude Code 开发测试机器人 claude-dev 的命令行。以「claude-dev 这个机器人」的身份操作飞书,不是以用户身份。
// 用法:npm run dev -- <命令> ...      详见 `npm run dev -- help`
import "dotenv/config"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { formatTrace } from "./trace-format.js"

const cfg = JSON.parse(readFileSync(process.env.CONFIG_FILE ?? "bot.config.json", "utf8"))
const appId: string = cfg.dev?.appId
const appSecret = process.env.DEV_APP_SECRET
if (!appId || !appSecret) {
  console.error("缺少 bot.config.json 的 dev.appId 或 .env 的 DEV_APP_SECRET")
  process.exit(1)
}
const STATE = "data/dev.json" // 记住测试群 chat_id 等
const state = (): Record<string, any> => { try { return JSON.parse(readFileSync(STATE, "utf8")) } catch { return {} } }
const save = (patch: Record<string, any>) => { mkdirSync("data", { recursive: true }); writeFileSync(STATE, JSON.stringify({ ...state(), ...patch }, null, 2)) }

let token = ""
async function tenantToken() {
  if (token) return token
  const r: any = await (await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })).json()
  if (!r.tenant_access_token) throw new Error(`换令牌失败: ${JSON.stringify(r)}`)
  return (token = r.tenant_access_token)
}

/** 通用调用,返回飞书原始 JSON(不包装错误) */
export async function api(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method,
    headers: { authorization: `Bearer ${await tenantToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return r.json()
}

const [cmd, ...args] = process.argv.slice(2)
const out = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LLM_BOT_APP_ID = "cli_aa4d2a5ea7f8dcb8"

async function ensureChat(): Promise<{ chatId: string; llmBotId: string }> {
  let { chatId, llmBotId } = state()
  if (!chatId) {
    const u = state().userUnionId // 用户的 union_id(跨应用通用),建群时一起拉进来,方便围观
    const r = await api("POST", "/im/v1/chats?user_id_type=union_id", {
      name: "llm-bot dev", description: "Claude Code 自动化测试群", bot_id_list: [LLM_BOT_APP_ID], ...(u ? { user_id_list: [u] } : {}), chat_mode: "group", chat_type: "private",
    })
    if (r.code !== 0) throw new Error(`建群失败: ${JSON.stringify(r)}`)
    chatId = r.data.chat_id
    save({ chatId })
  }
  if (!llmBotId) {
    const r = await api("GET", `/im/v1/chats/${chatId}/members/bots`)
    llmBotId = r.data?.items?.find((b: any) => b.bot_name === "llm-bot")?.bot_id
    if (!llmBotId) throw new Error(`群里没找到 llm-bot: ${JSON.stringify(r)}`)
    save({ llmBotId })
  }
  return { chatId, llmBotId }
}

const readTraces = (): any[] => {
  try { return readFileSync("data/traces.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] }
}

switch (cmd) {
  case "api": // npm run dev:bot -- api GET /im/v1/chats/oc_xxx/members
    out(await api(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined))
    break
  case "info":
    out(await api("GET", "/bot/v3/info"))
    break
  case "setup": {
    const c = await ensureChat()
    out(`测试群 chat_id=${c.chatId}\nllm-bot(claude-dev 视角)=${c.llmBotId}`)
    break
  }
  case "send": { // npm run dev:bot -- send "问题" [--raw]  以 claude-dev 身份 @llm-bot,等 llm-bot 处理完,打印完整运行记录
    const text = args.filter((a) => !a.startsWith("--")).join(" ")
    if (!text) throw new Error("用法: send <文字>   (文字为空会测试「只 @ 不带文字」)")
    const { chatId, llmBotId } = await ensureChat()
    const r = await api("POST", "/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId, msg_type: "text", content: JSON.stringify({ text: `<at user_id="${llmBotId}">llm-bot</at> ${text}` }),
    })
    if (r.code !== 0) throw new Error(`发送失败: ${JSON.stringify(r)}`)
    const id = r.data.message_id
    console.log(`已发送 ${id},等待 llm-bot…`)
    const t0 = Date.now()
    while (Date.now() - t0 < 120_000) {
      const hit = readTraces().find((t) => t.message_id === id)
      if (hit) { console.log("\n" + formatTrace(hit)); process.exit(0) }
      await sleep(1000)
    }
    console.log("⏱ 120 秒内没有对应的运行记录。看 `docker compose logs --since 3m` 或 data/traces.jsonl 里的 ignored 记录")
    process.exitCode = 1
    break
  }
  case "invite": { // 把用户拉进当前测试群
    const { chatId } = await ensureChat()
    const u = state().userUnionId
    if (!u) throw new Error("data/dev.json 里没有 userUnionId")
    const r = await api("POST", `/im/v1/chats/${chatId}/members?member_id_type=union_id`, { id_list: [u] })
    out(r.code === 0 ? `已把你拉进测试群 ${chatId}` : r)
    break
  }
  case "new": { // 解散旧的测试群(claude-dev 自己建的),新建一个干净的,保证上下文从零开始
    const old = state().chatId
    if (old) {
      const r = await api("DELETE", `/im/v1/chats/${old}`)
      console.log(`解散旧群 ${old}: code=${r.code} ${r.msg}`)
    }
    save({ chatId: undefined, llmBotId: undefined })
    const c = await ensureChat()
    out(`新测试群 chat_id=${c.chatId}`)
    break
  }
  case "say": { // 不 @ 任何人的普通发言(模拟群里别人聊天,bot 不会回复,只会被记作上下文)
    const text = args.join(" ")
    if (!text) throw new Error("用法: say <文字>")
    const { chatId } = await ensureChat()
    const r = await api("POST", "/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }),
    })
    out(r.code === 0 ? `已发送 ${r.data.message_id}` : r)
    break
  }
  case "read": { // 读群里最近的消息;bot 的卡片回复用 data/replies.json 补全内容
    const { chatId } = await ensureChat()
    const n = Number(args[0] ?? 10)
    const r = await api("GET", `/im/v1/messages?container_id_type=chat&container_id=${chatId}&sort_type=ByCreateTimeDesc&page_size=${n}`)
    let replies: Record<string, string> = {}
    try { replies = JSON.parse(readFileSync("data/replies.json", "utf8")) } catch {}
    for (const m of [...(r.data?.items ?? [])].reverse()) {
      let text = m.body?.content
      try { const c = JSON.parse(text); text = c.text ?? text } catch {}
      if (m.msg_type === "interactive") text = replies[m.message_id] ?? "(卡片,内容读不到)"
      console.log(`[${new Date(Number(m.create_time)).toLocaleTimeString()}] ${m.sender?.sender_type}:${m.sender?.id?.slice(0, 12)}  ${text}`)
    }
    break
  }
  default:
    out(`claude-dev 开发测试命令行(以机器人身份操作,不是用户):
  setup                        确认/创建测试群(llm-bot dev)\n  invite                       把用户拉进当前测试群\n  new                          解散旧测试群并新建一个干净的(上下文从零开始)
  say <文字>                   不 @ 的普通发言(模拟群里别人聊天,只会成为上下文)\n  send <文字>                  @llm-bot 发消息,等处理完,打印完整运行记录(上下文/工具/token/耗时/答案)
  read [条数]                  读测试群最近的消息(bot 的卡片回复用本地记录补全)
  api <METHOD> <PATH> [json]   原样调用飞书 API
  info                         claude-dev 自己的机器人信息`)
}
