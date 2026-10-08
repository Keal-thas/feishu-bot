import { createOpencode } from "@opencode-ai/sdk"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { config } from "./config.js"

// websearch 需要此开关(走 opencode 托管的 Exa,无需 key)
process.env.OPENCODE_ENABLE_EXA = "1"
if (config.deepseekKey) process.env.DEEPSEEK_API_KEY = config.deepseekKey

// bot 无人值守:文件与命令类工具全部关闭,只保留联网工具
const FILE_TOOLS = ["bash", "edit", "write", "read", "glob", "grep", "list", "patch", "todowrite", "todoread", "task"]
const WEB_TOOLS = ["websearch", "webfetch"]
const off = (names: string[]) => Object.fromEntries(names.map((t) => [t, false]))

const SYSTEM = `你是飞书群里的聊天助手,群里的人在一起讨论。回答简洁、直接,默认用中文(用户用其他语言就跟随)。
- 只有问题需要最新信息或网页资料时才使用 websearch / webfetch,最多查 3 次,取几条最相关的结果即可。
- 引用网页信息时,在末尾用「来源:」列出链接。
- 你没有文件系统和命令行权限,不要尝试。
- 下面「群聊上下文」是最近几条群消息,由不同成员发出,仅供参考,与问题无关就忽略。`

// 把 bot.config.json 的 providers 转成 opencode 的 provider 配置(只处理带 baseURL 的自定义项)
function customProviders() {
  const out: Record<string, any> = {}
  for (const [id, p] of Object.entries(config.providers)) {
    if (!p.baseURL) continue
    const apiKey = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined
    if (p.apiKeyEnv && !apiKey) console.warn(`provider ${id}: 环境变量 ${p.apiKeyEnv} 未设置,调用会失败`)
    out[id] = {
      npm: "@ai-sdk/openai-compatible",
      name: p.name ?? id,
      options: { baseURL: p.baseURL, ...(apiKey ? { apiKey } : {}) },
      models: Object.fromEntries(p.models.map((m) => [m, { name: m, tool_call: true }])),
    }
  }
  return out
}

export async function startAgent() {
  const workspace = resolve("workspace")
  mkdirSync(workspace, { recursive: true })
  process.chdir(workspace) // opencode server 在空目录里启动,碰不到项目文件

  const { client, server } = await createOpencode({
    hostname: "127.0.0.1",
    port: 0,
    config: {
      model: config.defaults.model,
      provider: customProviders(),
      permission: { edit: "deny", bash: "deny", webfetch: "allow", doom_loop: "deny", external_directory: "deny" },
      tools: off(FILE_TOOLS),
    },
  })

  // 校验 bot.config.json 里的模型是否真的存在,模型改名时能立刻看到原因。
  // 容器刚创建时缓存是空的,opencode 要先下载最新模型目录(含新上架的模型),期间只有旧快照,所以缺失的最多等约 1 分钟再确认,仍缺失才警告(放后台,不拖慢启动)
  async function missingModels(): Promise<string[]> {
    // config.providers() 会漏掉一些实验性/新上架但能正常调用的模型,用完整目录 provider.list() 校验
    const res: any = await client.provider.list()
    const known = new Set<string>(
      (res.data?.all ?? []).flatMap((p: any) => Object.keys(p.models ?? {}).map((m) => `${p.id}/${m}`)),
    )
    return config.models.filter((m) => !known.has(m))
  }
  void (async () => {
    try {
      let missing = await missingModels()
      for (let i = 0; i < 12 && missing.length; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        missing = await missingModels()
      }
      for (const m of missing) console.warn(`⚠️ 模型 ${m} 不在 opencode 可用列表里,调用会失败`)
    } catch (e) {
      console.warn("模型校验失败:", (e as Error).message)
    }
  })()

  type Tool = { tool: string; status: string; input: unknown; output?: string; error?: string; ms?: number }
  type Result = { answer: string; tools: Tool[]; tokens?: unknown; cost?: number; sessionId: string }

  async function ask(question: string, context: string, opts: { model: string; search: boolean }): Promise<Result> {
    const [providerID, ...rest] = opts.model.split("/")
    const session = await client.session.create({ body: { title: question.slice(0, 40) } })
    const sessionId = session.data?.id
    if (!sessionId) throw new Error(JSON.stringify(session.error))
    try {
      const text = context ? `【群聊上下文(仅供参考)】\n${context}\n\n【问题】\n${question}` : question
      const res = await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID, modelID: rest.join("/") },
          system: SYSTEM,
          tools: off(opts.search ? FILE_TOOLS : [...FILE_TOOLS, ...WEB_TOOLS]),
          parts: [{ type: "text", text }],
        },
      })
      if (!res.data) throw new Error(JSON.stringify(res.error))
      // 模型/供应商报错时,错误在 assistant 消息的 info.error 里,不是 HTTP 错误;原样抛出
      const perr = (res.data.info as any)?.error
      if (perr) throw new Error(JSON.stringify(perr))
      // 一次提问会被 opencode 拆成多条 assistant 消息(调工具、再写答案),所以读整个会话来汇总
      const all = await client.session.messages({ path: { id: sessionId } })
      const msgs = (all.data ?? []) as any[]
      const assistant = msgs.filter((m) => m.info?.role === "assistant")
      const parts = assistant.flatMap((m) => m.parts ?? []) as any[]
      const answer = (res.data.parts as any[])
        .filter((p) => p.type === "text")
        .map((p) => p.text as string)
        .join("\n")
        .trim()
      const tools: Tool[] = parts
        .filter((p) => p.type === "tool")
        .map((p) => ({
          tool: p.tool,
          status: p.state.status,
          input: p.state.input,
          output: typeof p.state.output === "string" ? p.state.output.slice(0, 2000) : undefined,
          error: p.state.error,
          ms: p.state.time?.end && p.state.time?.start ? p.state.time.end - p.state.time.start : undefined,
        }))
      const tokens = { input: 0, output: 0, reasoning: 0 }
      let cost = 0
      for (const m of assistant) {
        tokens.input += m.info.tokens?.input ?? 0
        tokens.output += m.info.tokens?.output ?? 0
        tokens.reasoning += m.info.tokens?.reasoning ?? 0
        cost += m.info.cost ?? 0
      }
      return { answer: answer || "(没有得到回复)", tools, tokens, cost, sessionId }
    } finally {
      // 每次提问独立 session,用完即删,上下文只来自我们注入的那几条
      await client.session.delete({ path: { id: sessionId } }).catch(() => {})
    }
  }

  return { ask, close: () => server.close() }
}
