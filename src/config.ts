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

// 带 baseURL 的是自定义 OpenAI 兼容 provider(key 从 apiKeyEnv 指定的环境变量读);
// 不带 baseURL 的是 opencode 内置 provider(如 deepseek,key 用它自己约定的环境变量/登录凭证)
export type ProviderEntry = { name?: string; baseURL?: string; apiKeyEnv?: string; models: string[] }

type FileConfig = {
  appId: string
  model: string
  providers: Record<string, ProviderEntry>
  contextMessages: number
  contextWindowMinutes: number
  contextMaxChars: number
  search: boolean
  allowedOpenIds: string[]
}
const file: FileConfig = JSON.parse(readFileSync(configFile, "utf8"))
const allModels = Object.entries(file.providers).flatMap(([p, e]) => e.models.map((m) => `${p}/${m}`))
if (!allModels.includes(file.model)) {
  throw new Error(`bot.config.json: 默认模型 ${file.model} 不在 providers 列表里,可选:${allModels.join("、")}`)
}

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
  providers: file.providers,
  // /model 只能在这些里选,形如 provider/model
  models: Object.entries(file.providers).flatMap(([p, e]) => e.models.map((m) => `${p}/${m}`)),
  contextWindowMinutes: file.contextWindowMinutes,
  contextMaxChars: file.contextMaxChars,
}
