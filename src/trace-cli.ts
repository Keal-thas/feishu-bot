// 在宿主机上看最近的请求记录:npm run trace -- [条数] [--json]
import { readFileSync } from "node:fs"
import { formatTrace } from "./trace-format.js"

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
for (const l of lines.slice(-n)) console.log(json ? l : formatTrace(JSON.parse(l)))
