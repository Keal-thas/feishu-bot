// 启动 bot 之前,同步把 opencode 的模型目录(models.dev)下载到它的缓存位置。
// 新容器缓存是空的:opencode 服务器会先用内置旧快照启动,约 1 分钟后才在后台下载新目录且不会重读,
// 导致新上架的模型 "Model not found"。先下载完再启动就没这个问题。失败就保留现状,不影响启动。
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode")
const file = join(dir, "models.json")
try {
  const r = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const text = await r.text()
  JSON.parse(text) // 确认是完整合法的 JSON 再覆盖
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
  console.log(`[warm-catalog] 模型目录已更新 (${(text.length / 1e6).toFixed(1)}MB)`)
} catch (e) {
  console.warn(`[warm-catalog] 下载失败,沿用现有缓存: ${e.message}`)
}
