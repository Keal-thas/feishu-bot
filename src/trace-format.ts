export function formatTrace(t: any): string {
  const o: string[] = []
  o.push(`━━ ${t.ts}  chat=${t.chat}  sender=${t.sender ?? "?"}  ${t.kind}`)
  o.push(`问题: ${t.question}`)
  if (t.settings) o.push(`设置: model=${t.settings.model} context=${t.settings.context} search=${t.settings.search}`)
  if (t.context) o.push(`上下文(${t.context.length} 字):\n${t.context.replace(/^/gm, "  | ")}`)
  for (const x of t.tools ?? [])
    o.push(`工具: ${x.tool} [${x.status}] ${JSON.stringify(x.input)}  ${x.ms ?? "?"}ms\n  → ${String(x.output ?? x.error ?? "").slice(0, 200).replace(/\n/g, " ")}`)
  if (t.tokens) o.push(`tokens: in=${t.tokens.input} out=${t.tokens.output} reasoning=${t.tokens.reasoning} cost=${t.cost}`)
  if (t.timings) o.push(`耗时: ${JSON.stringify(t.timings)}`)
  if (t.error) o.push(`❌ 原始错误: ${t.error}`)
  if (t.answer) o.push(`答案:\n${String(t.answer).replace(/^/gm, "  > ")}`)
  return o.join("\n") + "\n"
}
