// 在宿主机上看最近的请求记录:npm run trace -- [条数] [--json]
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const json = args.includes("--json")
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 3)
let lines: string[] = []
try {
  lines = readFileSync(process.env.TRACE_FILE ?? "data/traces.jsonl", "utf8").trim().split("\n").filter(Boolean)
} catch {
  console.log("还没有记录(data/traces.jsonl 不存在)")
  process.exit(0)
}
for (const l of lines.slice(-n)) {
  const t = JSON.parse(l)
  if (json) { console.log(l); continue }
  console.log(`━━ ${t.ts}  chat=${t.chat}  sender=${t.sender ?? "?"}  ${t.kind}`)
  console.log(`问题: ${t.question}`)
  if (t.settings) console.log(`设置: model=${t.settings.model} context=${t.settings.context} search=${t.settings.search}`)
  if (t.context) console.log(`上下文(${t.context.length} 字):\n${t.context.replace(/^/gm, "  | ")}`)
  for (const x of t.tools ?? []) console.log(`工具: ${x.tool} [${x.status}] ${JSON.stringify(x.input)}  ${x.ms ?? "?"}ms\n  → ${String(x.output ?? x.error ?? "").slice(0, 200).replace(/\n/g, " ")}`)
  if (t.tokens) console.log(`tokens: in=${t.tokens.input} out=${t.tokens.output} reasoning=${t.tokens.reasoning} cost=${t.cost}`)
  if (t.timings) console.log(`耗时: ${JSON.stringify(t.timings)}`)
  if (t.error) console.log(`❌ 原始错误: ${t.error}`)
  if (t.answer) console.log(`答案:\n${String(t.answer).replace(/^/gm, "  > ")}`)
  console.log()
}
