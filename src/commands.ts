import { config } from "./config.js"
import { getSettings, resetSettings, updateSettings } from "./settings.js"

const short = (m: string) => m

function status(chatId: string): string {
  const s = getSettings(chatId)
  return `模型:${short(s.model)}\n上下文:最近 ${s.context} 条(${config.contextWindowMinutes} 分钟内)\n联网:${s.search ? "开" : "关"}`
}

/** 返回回复文本;不是命令则返回 null */
export function runCommand(chatId: string, text: string): string | null {
  if (!text.startsWith("/")) return null
  const [cmd, ...args] = text.split(/\s+/)
  const arg = args.join(" ").trim()

  switch (cmd.toLowerCase()) {
    case "/help":
      return [
        "可用命令:",
        "/model [名字]  查看/切换模型(" + config.models.map(short).join(" | ") + ")",
        "/context [条数]  查看/设置带多少条群聊上下文(0-30)",
        "/search [on|off]  查看/开关联网",
        "/reset  恢复本群默认设置",
        "",
        "当前设置:",
        status(chatId),
      ].join("\n")

    case "/model": {
      if (!arg) return `当前模型:${short(getSettings(chatId).model)}\n可选:${config.models.map(short).join("、")}`
      // 精确匹配 > 以 /名字 结尾 > 唯一包含这段文字(不分大小写)
      const q = arg.toLowerCase()
      const pick = (f: (m: string) => boolean) => config.models.filter(f)
      const found = [
        pick((m) => m === arg),
        pick((m) => m.endsWith(`/${arg}`)),
        pick((m) => m.toLowerCase().includes(q)),
      ].find((l) => l.length > 0)
      if (!found) return `不支持的模型「${arg}」。可选:${config.models.map(short).join("、")}`
      if (found.length > 1) return `「${arg}」匹配到多个,请写具体些:\n${found.join("\n")}`
      const hit = found[0]
      updateSettings(chatId, { model: hit })
      return `已切换模型:${short(hit)}`
    }

    case "/context": {
      if (!arg) return `当前带最近 ${getSettings(chatId).context} 条上下文`
      const n = Number(arg)
      if (!Number.isInteger(n) || n < 0 || n > 30) return "请输入 0-30 的整数,0 表示不带上下文"
      updateSettings(chatId, { context: n })
      return `已设置:带最近 ${n} 条上下文`
    }

    case "/search": {
      if (!arg) return `联网当前:${getSettings(chatId).search ? "开" : "关"}`
      if (!["on", "off"].includes(arg.toLowerCase())) return "用法:/search on 或 /search off"
      const on = arg.toLowerCase() === "on"
      updateSettings(chatId, { search: on })
      return `联网已${on ? "开启" : "关闭"}`
    }

    case "/reset":
      resetSettings(chatId)
      return `已恢复默认设置\n${status(chatId)}`

    default:
      return `未知命令 ${cmd},发 /help 看看`
  }
}
