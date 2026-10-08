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

export async function startAgent() {
  const workspace = resolve("workspace")
  mkdirSync(workspace, { recursive: true })
  process.chdir(workspace) // opencode server 在空目录里启动,碰不到项目文件

  const { client, server } = await createOpencode({
    hostname: "127.0.0.1",
    port: 0,
    config: {
      model: config.defaults.model,
      permission: { edit: "deny", bash: "deny", webfetch: "allow", doom_loop: "deny", external_directory: "deny" },
      tools: off(FILE_TOOLS),
    },
  })

  async function ask(question: string, context: string, opts: { model: string; search: boolean }): Promise<string> {
    const [providerID, ...rest] = opts.model.split("/")
    const session = await client.session.create({ body: { title: question.slice(0, 40) } })
    const sessionId = session.data?.id
    if (!sessionId) throw new Error(`创建 session 失败: ${JSON.stringify(session.error)}`)
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
      if (!res.data) throw new Error(`LLM 调用失败: ${JSON.stringify(res.error)}`)
      const answer = res.data.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("\n")
        .trim()
      return answer || "(没有得到回复)"
    } finally {
      // 每次提问独立 session,用完即删,上下文只来自我们注入的那几条
      await client.session.delete({ path: { id: sessionId } }).catch(() => {})
    }
  }

  return { ask, close: () => server.close() }
}
