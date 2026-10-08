import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import { config } from "./config.js"

// 每次请求一行 JSON,写到 data/traces.jsonl,方便开发 agent 时回看:原话、实际带的上下文、工具调用、耗时、原始错误
const file = join(config.dataDir, "traces.jsonl")
const MAX_BYTES = 5 * 1024 * 1024

export function writeTrace(record: Record<string, unknown>) {
  try {
    mkdirSync(config.dataDir, { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`) // 只留一份旧的
    } catch {}
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n")
  } catch (e) {
    console.warn("写 trace 失败:", (e as Error).message)
  }
}
