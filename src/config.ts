import "dotenv/config"
import { resolve } from "node:path"

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name},请检查 .env`)
  return v
}

// 必须在 agent 里 chdir 之前解析成绝对路径
const dataDir = resolve(process.env.DATA_DIR ?? "data")

export const config = {
  appId: need("FEISHU_APP_ID"),
  appSecret: need("FEISHU_APP_SECRET"),
  // 本机直接跑时 opencode 会自己读 ~/.local/share/opencode/auth.json;Docker 里必须通过环境变量提供
  deepseekKey: process.env.DEEPSEEK_API_KEY,
  dataDir,
  // 为空 = 不限制;否则只响应这些 open_id(逗号分隔)
  allowedOpenIds: (process.env.ALLOWED_OPEN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  defaults: {
    model: process.env.OPENCODE_MODEL ?? "deepseek/deepseek-chat",
    context: Number(process.env.CONTEXT_MESSAGES ?? 10),
    search: true,
  },
  contextWindowMinutes: Number(process.env.CONTEXT_WINDOW_MINUTES ?? 30),
  contextMaxChars: 3000,
  // /model 只能在这些里选,避免乱填
  models: ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
}
