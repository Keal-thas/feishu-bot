import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "./config.js"

// 新版卡片的历史消息飞书只返回「请升级客户端」,读不到内容,所以 bot 自己发过的回复自己存(落盘,重启不丢)
const file = join(config.dataDir, "replies.json")
const MAX = 200
let store: Record<string, string> = {}
try {
  store = JSON.parse(readFileSync(file, "utf8"))
} catch {}

export const getReply = (messageId: string): string | undefined => store[messageId]

export function rememberReply(messageId: string, text: string) {
  store[messageId] = text
  const keys = Object.keys(store)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete store[k]
  mkdirSync(config.dataDir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(store))
  renameSync(tmp, file)
}
