/**
 * harness.mjs — 假宿主集成测试，不随包发布。
 *
 * 用一个最小的 ctx 替身跑 apply()，检查三面是否都挂上了、形状是否对：
 *   node harness.mjs
 *
 * 它不能替代真宿主验证，但能挡住"注册形状写错"这一类错误——
 * 这类错误在真宿主里是静默的：工具不出现、插件不报错。
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, inject, name, proseTools, provider } from './index.js'
import { auditStructure } from './analyze.js'
import { STYLE_PROMPT } from './prompt.js'

const registered = { sections: [], tools: [], providers: [] }
const disposed = []

const ctx = {
  effect(factory, label) {
    const disposer = factory()
    disposed.push({ label, disposer })
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  systemPrompt: {
    section(options) {
      registered.sections.push(options)
      return () => {}
    },
  },
  tools: {
    register(tool) {
      registered.tools.push(tool)
      return () => {}
    },
  },
  skills: {
    registerProvider(factory) {
      registered.providers.push(factory())
      return () => {}
    },
  },
}

apply(ctx, {})

const checks = []
function check(label, pass, detail = '') {
  checks.push({ label, pass, detail })
}

// ---- 提示词段
check('注册了一个提示词段', registered.sections.length === 1, `实际 ${registered.sections.length}`)
const section = registered.sections[0] ?? {}
check('段名是 prose', section.name === 'prose', String(section.name))
check('顺序是 100', section.order === 100, String(section.order))
check('正文非空且等于契约', section.text === STYLE_PROMPT, `${section.text?.length ?? 0} 字`)
check('契约含文件条款', section.text.includes('结构服从内容'), '')
check('契约不含未替换占位符', !/\{\{|\}\}/.test(section.text), '')

// ---- 工具
check('注册了两个工具', registered.tools.length === 2, `实际 ${registered.tools.length}`)
const names = registered.tools.map(t => t.name).sort()
check('工具名是 prose_check / prose_rules', JSON.stringify(names) === '["prose_check","prose_rules"]', names.join(','))
for (const tool of registered.tools) {
  check(`${tool.name} 有 description`, typeof tool.description === 'string' && tool.description.length > 20, '')
  check(`${tool.name} 有 parameters`, tool.parameters?.type === 'object', '')
  check(`${tool.name} 有 output.render`, typeof tool.output?.render === 'function', '')
  check(`${tool.name} 有 execute`, typeof tool.execute === 'function', '')
}

// ---- 工具端到端
const checkTool = registered.tools.find(t => t.name === 'prose_check')
const rulesTool = registered.tools.find(t => t.name === 'prose_rules')

const scanResult = await checkTool.execute({
  text: '值得注意的是，该方案在一定程度上具有重要的里程碑意义。综上所述，希望对你有帮助。',
  mode: 'doc',
})
check('prose_check 返回 ok', scanResult.ok === true, scanResult.error ?? '')
check('prose_check 有判定', typeof scanResult.verdict === 'string', scanResult.verdict)
check('prose_check 命中数 > 0', scanResult.hitCount > 0, String(scanResult.hitCount))
const rendered = checkTool.output.render({}, scanResult)
check('prose_check 渲染出内容块', Array.isArray(rendered) && rendered[0]?.type === 'text', '')
check('渲染文本含"命中明细"或"结构问题"', /命中明细|结构问题/.test(rendered[0].text), '')

const badArgs = await checkTool.execute({ mode: 'doc' })
check('prose_check 缺 text 时拒绝', badArgs.ok === false, badArgs.error ?? '')

const badEnum = await checkTool.execute({ text: '测试。', mode: 'wrong' })
check('prose_check 非法 enum 时拒绝', badEnum.ok === false, badEnum.error ?? '')

const rulesResult = await rulesTool.execute({ part: 'doc' })
check('prose_rules 取回 doc', rulesResult.ok === true && rulesResult.markdown.includes('文件写作规范'), '')
const rulesAll = await rulesTool.execute({})
check('prose_rules 默认返回全部', rulesAll.ok === true && rulesAll.markdown.length > 3000, String(rulesAll.markdown.length))
const rulesBad = await rulesTool.execute({ part: 'nope' })
check('prose_rules 未知 part 报错', rulesBad.ok === false, rulesBad.error ?? '')

// ---- 同一个工具的两种输入
const fileResult = await checkTool.execute({ path: 'README.md', mode: 'doc' })
check('给 path 时读盘扫描', fileResult.ok === true, fileResult.error ?? '')
check(
  '回显解析后的绝对路径',
  typeof fileResult.path === 'string' && fileResult.path.endsWith('README.md'),
  String(fileResult.path),
)
check('文件模式返回结构审计', Array.isArray(fileResult.audit?.findings), '')
check('文件模式掩掉代码块', fileResult.stats.codeRatio > 0, String(fileResult.stats.codeRatio))
const fileRender = checkTool.output.render({}, fileResult)
check('文件报告首行是路径', /^文件：/.test(fileRender[0].text), fileRender[0].text.split('\n')[0] ?? '')
check('传文本时没有 audit 字段', scanResult.audit === undefined, '')

const noFile = await checkTool.execute({ path: 'no-such-file-xyz.md' })
check('文件不存在时报错', noFile.ok === false, noFile.error ?? '')
const noInput = await checkTool.execute({})
check('text 和 path 都没给时拒绝', noInput.ok === false, noInput.error ?? '')
const bothInputs = await checkTool.execute({ text: '随便。', path: 'README.md' })
check('两者都给时以 path 为准', bothInputs.ok === true && typeof bothInputs.path === 'string', '')

// ---- 编码：BOM 与 UTF-16
const scratch = await mkdtemp(join(tmpdir(), 'prose-forge-'))

const utf16Path = join(scratch, 'utf16.md')
await writeFile(utf16Path, Buffer.from('\uFEFF# 标题\n\n值得注意的是，正文。', 'utf16le'))
const utf16 = await checkTool.execute({ path: utf16Path })
check('UTF-16LE 文件能读', utf16.ok === true, utf16.error ?? '')
check('UTF-16LE 内容解析正确', (utf16.groups['元话语'] ?? 0) === 1, JSON.stringify(utf16.groups))

const bomPath = join(scratch, 'bom.md')
await writeFile(bomPath, '\uFEFF# 标题\n\n正文。', 'utf8')
const bom = await checkTool.execute({ path: bomPath })
check('UTF-8 BOM 不影响标题识别', bom.mode === 'doc', bom.mode)

const binaryPath = join(scratch, 'binary.bin')
await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]))
const binary = await checkTool.execute({ path: binaryPath })
check('二进制文件被拒绝', binary.ok === false, binary.error ?? '')

// ---- 结构审计（纯函数）
const auditText = [
  '# 一级',
  '',
  '## 空节',
  '## 有内容',
  '正文。',
  '#### 跳级',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
].join('\n')
const audit = auditStructure(auditText)
check('审计发现标题层级跳跃', audit.findings.some(f => f.kind === 'heading-jump'), '')
check('审计发现空节', audit.findings.some(f => f.kind === 'empty-section'), '')
check('容器节不算空节', !audit.findings.some(f => f.kind === 'empty-section' && f.line === 4), '')
check('审计发现小表格', audit.findings.some(f => f.kind === 'small-table'), '')
check('审计统计标题数', audit.headingCount === 4, String(audit.headingCount))
const longPara = auditStructure(`# 标题\n\n${'这是一句很长的正文。'.repeat(60)}`)
check('审计发现超长段', longPara.findings.some(f => f.kind === 'long-paragraph'), '')

const longList = ['# 标题', '', ...Array.from({ length: 10 }, (_, i) => `- 第 ${i + 1} 条：${'内容'.repeat(30)}`)].join('\n')
check('长列表不算超长段落', !auditStructure(longList).findings.some(f => f.kind === 'long-paragraph'), '')

const doubleTick = await checkTool.execute({ text: '引用 `` `值得注意的是` `` 这种写法。' })
check('双反引号里的内容不计入命中', doubleTick.hitCount === 0, JSON.stringify(doubleTick.groups))

// ---- 排版与自定义规则
const typoResult = await checkTool.execute({ text: '第一，第二,第三。等一下...再说。' })
check(
  '返回排版体检',
  typeof typoResult.typography?.total === 'number' && typoResult.typography.total > 0,
  String(typoResult.typography?.total),
)
const typoRender = checkTool.output.render({}, typoResult)
check('排版问题渲染进报告', /排版：/.test(typoRender[0].text), '')

const customTool = proseTools({ customRules: [{ pattern: 'ABC', group: '自定义', advice: '别用 ABC' }] })[0]
const customResult = await customTool.execute({ text: '这里有 ABC 出现。' })
check('自定义规则生效', (customResult.groups['自定义'] ?? 0) === 1, JSON.stringify(customResult.groups))

const badTool = proseTools({ customRules: [{ pattern: '([' }] })[0]
const badResult = await badTool.execute({ text: '测试。' })
check('坏正则不崩并报错', badResult.ok === true && badResult.invalidRules?.length === 1, '')

// ---- 技能
check('注册了一个 skill provider', registered.providers.length === 1, `实际 ${registered.providers.length}`)
const skillProvider = registered.providers[0] ?? {}
check('provider 名字是 prose-forge', skillProvider.name === 'prose-forge', String(skillProvider.name))
const candidates = await skillProvider.list()
check('列出两个 skill', candidates.length === 2, `实际 ${candidates.length}: ${candidates.map(c => c.name).join(',')}`)
for (const candidate of candidates) {
  check(`候选 ${candidate.name} 名字合规`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name), candidate.name)
  check(`候选 ${candidate.name} 有描述`, typeof candidate.description === 'string' && candidate.description.length > 10, '')
  check(`候选 ${candidate.name} 有 rank`, Number.isInteger(candidate.rank), String(candidate.rank))
  check(`候选 ${candidate.name} 有 resourceBase`, candidate.resourceBase?.kind === 'directory', '')
  check(`候选 ${candidate.name} 有 invocation`, typeof candidate.invocation?.modelInvocable === 'boolean', '')
  check(`候选 ${candidate.name} 列表项不含正文`, candidate.content === undefined, '')

  const full = await skillProvider.get(candidate)
  check(`候选 ${candidate.name} get 返回正文`, typeof full?.content === 'string' && full.content.length > 500, `${full?.content?.length ?? 0} 字`)
  check(`候选 ${candidate.name} 正文不含 frontmatter`, !full.content.startsWith('---'), '')
}

// ---- 关闭开关
const off = { sections: [], tools: [], providers: [] }
const offCtx = {
  effect: (f) => { f(); return () => {} },
  systemPrompt: { section: (o) => { off.sections.push(o); return () => {} } },
  tools: { register: (t) => { off.tools.push(t); return () => {} } },
  skills: { registerProvider: (f) => { off.providers.push(f()); return () => {} } },
}
apply(offCtx, { enabled: false })
check('enabled:false 时不挂任何东西', off.sections.length + off.tools.length + off.providers.length === 0, '')

// ---- 追加禁用表达
const extra = { sections: [] }
apply(
  {
    effect: (f) => { f(); return () => {} },
    systemPrompt: { section: (o) => { extra.sections.push(o); return () => {} } },
    tools: { register: () => () => {} },
    skills: { registerProvider: () => () => {} },
  },
  { extraBanned: ['云原生', '中台'] },
)
check('extraBanned 拼进契约', extra.sections[0].text.includes('云原生'), '')

// ---- 报告
let failed = 0
for (const { label, pass, detail } of checks) {
  if (!pass) failed += 1
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`)
}

console.log(`\n插件名 ${name} · inject ${JSON.stringify(inject)} · 工具 ${proseTools().length} 个 · provider ${provider.name}`)
console.log(`契约 ${STYLE_PROMPT.length} 字`)
if (failed > 0) {
  console.log(`\n${failed} 项失败 / 共 ${checks.length} 项`)
  process.exit(1)
}
console.log(`\n全部通过（${checks.length} 项）`)
