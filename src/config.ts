import "dotenv/config"

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少环境变量 ${name},请检查 .env`)
  return v
}

export const config = {
  appId: need("FEISHU_APP_ID"),
  appSecret: need("FEISHU_APP_SECRET"),
  // DeepSeek 的 key 由 opencode 内置 deepseek provider 从环境变量读取
  deepseekKey: need("DEEPSEEK_API_KEY"),
  model: process.env.OPENCODE_MODEL ?? "deepseek/deepseek-chat",
  // 只带最近 N 条聊天作为上下文,不带整个聊天记录
  contextMessages: Number(process.env.CONTEXT_MESSAGES ?? 6),
  contextMaxChars: 2000,
}
