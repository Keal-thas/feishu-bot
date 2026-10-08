import "dotenv/config"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// 密钥只来自环境变量(.env);其余普通配置在 bot.config.json(可提交)
function secret(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name},请检查 .env`)
  return v
}

// 必须在 agent 里 chdir 之前解析成绝对路径
const configFile = resolve(process.env.CONFIG_FILE ?? "bot.config.json")
const dataDir = resolve(process.env.DATA_DIR ?? "data")

type FileConfig = {
  appId: string
  model: string
  models: string[]
  contextMessages: number
  contextWindowMinutes: number
  contextMaxChars: number
  search: boolean
  allowedOpenIds: string[]
}
const file: FileConfig = JSON.parse(readFileSync(configFile, "utf8"))

export const config = {
  // —— 密钥(.env)——
  appSecret: secret("FEISHU_APP_SECRET"),
  // 本机直接跑时 opencode 会自己读 ~/.local/share/opencode/auth.json;Docker 里必须通过环境变量提供
  deepseekKey: process.env.DEEPSEEK_API_KEY,
  // —— 普通配置(bot.config.json)——
  appId: file.appId,
  dataDir,
  allowedOpenIds: file.allowedOpenIds, // 为空 = 不限制
  defaults: { model: file.model, context: file.contextMessages, search: file.search },
  models: file.models, // /model 只能在这些里选
  contextWindowMinutes: file.contextWindowMinutes,
  contextMaxChars: file.contextMaxChars,
}
