// 不经过飞书,直接验证 LLM 链路。用法:docker compose exec bot npx tsx src/selftest.ts "问题"
import { startAgent } from "./agent.js"
import { config } from "./config.js"

const q = process.argv[2] ?? "用一句话介绍你自己"
const agent = await startAgent()
const t = Date.now()
try {
  const a = await agent.ask(q, "", { model: config.defaults.model, search: config.defaults.search })
  console.log(`✅ ${config.defaults.model} (${((Date.now() - t) / 1000).toFixed(1)}s)\n${a}`)
} catch (e) {
  console.error("❌", (e as Error).message)
  process.exitCode = 1
}
agent.close()
process.exit()
