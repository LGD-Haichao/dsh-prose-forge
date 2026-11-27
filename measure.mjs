/**
 * measure.mjs — 量每轮成本，不随包发布。
 *
 * 每轮进上下文的只有三样：常驻契约、工具描述与参数 schema、技能目录描述。
 * 其余（rules.js 各段、SKILL.md 正文）都是按需加载，不占常规成本。
 *
 *   node measure.mjs
 */

import { STYLE_PROMPT } from './prompt.js'
import { PARTS, lookup } from './rules.js'
import { proseTools } from './index.js'
import { provider } from './index.js'

function normalize(text) {
  return text.replace(/\s/g, '').replace(/[，。！？；：、""''（）()\[\]【】]/g, '')
}

/** 取 n 字滑窗，用来量两段文字的字面重合。 */
function shingles(text, n = 8) {
  const set = new Set()
  const flat = normalize(text)
  for (let i = 0; i + n <= flat.length; i += 1) set.add(flat.slice(i, i + n))
  return set
}

const contractShingles = shingles(STYLE_PROMPT)

// ---- 每轮成本
const tools = proseTools()
const toolRows = tools.map(tool => ({
  name: tool.name,
  description: tool.description.length,
  schema: JSON.stringify(tool.parameters).length,
  total: tool.description.length + JSON.stringify(tool.parameters).length,
}))
const toolChars = toolRows.reduce((sum, row) => sum + row.total, 0)

const candidates = await provider.list()
const skillChars = candidates.reduce((sum, c) => sum + c.name.length + c.description.length, 0)

console.log('=== 每轮成本（字） ===')
console.log(`契约            ${STYLE_PROMPT.length}`)
for (const row of toolRows) {
  console.log(`  ${row.name.padEnd(18)} 描述 ${row.description} + schema ${row.schema} = ${row.total}`)
}
console.log(`工具合计        ${toolChars}`)
console.log(`技能目录        ${skillChars}`)
console.log(`固定开销总计    ${STYLE_PROMPT.length + toolChars + skillChars}`)

// ---- 按需成本
console.log('\n=== 按需成本（字） ===')
for (const part of PARTS.filter(p => p !== 'all')) console.log(`  ${part.padEnd(14)} ${lookup(part).length}`)

// ---- 字面重合：direct 与常驻契约
const direct = lookup('direct')
const lines = direct
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '' && !line.startsWith('#'))

let duplicatedLines = 0
let duplicatedChars = 0
const duplicated = []
for (const line of lines) {
  const lineShingles = shingles(line, 6)
  if (lineShingles.size === 0) continue
  let hit = 0
  for (const shingle of lineShingles) if (contractShingles.has(shingle)) hit += 1
  if (hit / lineShingles.size > 0.4) {
    duplicatedLines += 1
    duplicatedChars += line.length
    duplicated.push(line)
  }
}

console.log('\n=== direct 与契约的字面重合 ===')
console.log(`direct 非标题行 ${lines.length} 行 / ${lines.reduce((s, l) => s + l.length, 0)} 字`)
console.log(`与契约字面重合 >40% 的 ${duplicatedLines} 行 / ${duplicatedChars} 字`)
for (const line of duplicated.slice(0, 8)) console.log(`  · ${line.slice(0, 60)}`)
