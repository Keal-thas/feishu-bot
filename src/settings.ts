import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "./config.js"

export type ChatSettings = { model: string; context: number; search: boolean }

const file = join(config.dataDir, "settings.json")
let store: Record<string, Partial<ChatSettings>> = {}
try {
  store = JSON.parse(readFileSync(file, "utf8"))
} catch {}

function persist() {
  mkdirSync(config.dataDir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, file) // 原子替换,避免写一半崩溃
}

export function getSettings(chatId: string): ChatSettings {
  return { ...config.defaults, ...store[chatId] }
}

export function updateSettings(chatId: string, patch: Partial<ChatSettings>) {
  store[chatId] = { ...store[chatId], ...patch }
  persist()
}

export function resetSettings(chatId: string) {
  delete store[chatId]
  persist()
}
