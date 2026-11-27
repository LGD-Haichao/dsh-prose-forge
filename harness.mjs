/**
 * harness.mjs — 假宿主集成测试，不随包发布。
 *
 * 用一个最小的 ctx 替身跑 apply()，检查三面是否都挂上了、形状是否对：
 *   node harness.mjs
 *
 * 它不能替代真宿主验证，但能挡住"注册形状写错"这一类错误——
 * 这类错误在真宿主里是静默的：工具不出现、插件不报错。
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
check('契约含完整句条款', section.text.includes('句子写完整'), '')
check('契约含实限定条款', section.text.includes('限定要实'), '')
check('契约不含未替换占位符', !/\{\{|\}\}/.test(section.text), '')

// ---- 工具
check('注册了三个工具', registered.tools.length === 3, `实际 ${registered.tools.length}`)
const names = registered.tools.map(t => t.name).sort()
check(
  '工具名对得上',
  JSON.stringify(names) === '["prose_check","prose_fix","prose_rules"]',
  names.join(','),
)
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
// ---- 中英空格：默认不查，按需清理
const defaultScan = await checkTool.execute({ text: '放在 Redis 里，共 3 个。' })
check('默认不报中英空格', (defaultScan.typography.counts['cjk-latin-space'] ?? 0) === 0, JSON.stringify(defaultScan.typography.counts))

const forcedScan = await checkTool.execute({ text: '放在 Redis 里，共 3 个。', skip: [] })
check('调用时传空数组就查', (forcedScan.typography.counts['cjk-latin-space'] ?? 0) === 2, JSON.stringify(forcedScan.typography.counts))

const otherSkip = await checkTool.execute({ text: '放在 Redis 里，还有（括号', skip: ['unbalanced-mark'] })
check(
  '调用时的 skip 以它为准',
  (otherSkip.typography.counts['cjk-latin-space'] ?? 0) === 1 && (otherSkip.typography.counts['unbalanced-mark'] ?? 0) === 0,
  JSON.stringify(otherSkip.typography.counts),
)

const fixToolRef = registered.tools.find(t => t.name === 'prose_fix')
check('注册了 prose_fix', Boolean(fixToolRef), registered.tools.map(t => t.name).join(','))

const fixedText = await fixToolRef.execute({ text: '放在 Redis 里，改配置 + 触发重载。' })
check('prose_fix 清掉空格', fixedText.ok === true && fixedText.applied === 2, String(fixedText.applied))
check('prose_fix 结果正确', fixedText.text === '放在Redis里，改配置+触发重载。', String(fixedText.text))

const dryRunResult = await fixToolRef.execute({ path: 'README.md', dryRun: true })
check('dryRun 不写文件', dryRunResult.ok === true && dryRunResult.written === false, String(dryRunResult.written))

// ---- prose_fix 写盘时保留原编码
const encDir = await mkdtemp(join(tmpdir(), 'pf-fix-'))

const fixU16Path = join(encDir, 'u16.md')
await writeFile(fixU16Path, Buffer.from('\uFEFF放在 Redis 里。', 'utf16le'))
const u16Fixed = await fixToolRef.execute({ path: fixU16Path })
const u16Bytes = await readFile(fixU16Path)
check('UTF-16 写回后还是 UTF-16', u16Bytes[0] === 0xff && u16Bytes[1] === 0xfe, [...u16Bytes.slice(0, 2)].map(b => b.toString(16)).join(' '))
check('UTF-16 内容已清理', u16Bytes.toString('utf16le').includes('放在Redis里'), '')
check('UTF-16 回显编码', u16Fixed.encoding === 'utf16le', String(u16Fixed.encoding))

const fixBomPath = join(encDir, 'bom.md')
await writeFile(fixBomPath, Buffer.from('\uFEFF放在 Redis 里。', 'utf8'))
await fixToolRef.execute({ path: fixBomPath })
const bomBytes = await readFile(fixBomPath)
check('UTF-8 BOM 保留', bomBytes[0] === 0xef && bomBytes[1] === 0xbb && bomBytes[2] === 0xbf, [...bomBytes.slice(0, 3)].map(b => b.toString(16)).join(' '))

const fixPlainPath = join(encDir, 'plain.md')
await writeFile(fixPlainPath, '放在 Redis 里。', 'utf8')
const plainFixed = await fixToolRef.execute({ path: fixPlainPath })
check('UTF-8 确实写盘', plainFixed.written === true && (await readFile(fixPlainPath, 'utf8')) === '放在Redis里。', '')

// ---- prose_fix 不许动代码块和 frontmatter
const inlineCode = await fixToolRef.execute({ text: '示例：`共 3 个` 说明。' })
check('行内代码不被修改', inlineCode.applied === 0 && inlineCode.text.includes('共 3 个'), String(inlineCode.applied))

const fenced = await fixToolRef.execute({ text: '说明：\n\n\`\`\`\n放在 Redis 里\n\`\`\`\n\n结束。' })
check('围栏代码块不被修改', fenced.applied === 0 && fenced.text.includes('放在 Redis 里'), String(fenced.applied))

const front = await fixToolRef.execute({ text: '---\ntitle: 共 3 个\n---\n\n正文 共 3 个。' })
check('frontmatter 不被修改', front.text.includes('title: 共 3 个') && front.text.includes('正文 共3个。'), String(front.applied))

const outside = await fixToolRef.execute({ text: '说 `共 3 个` 之后，实际是 4 个文件。' })
check('代码外的正文照修', outside.text === '说 `共 3 个` 之后，实际是4个文件。', outside.text)

// ---- 混合文档里只动正文
const mixedDoc = [
  '---',
  'title: 共 3 个文件',
  '---',
  '',
  '# 标题 共 3 个',
  '',
  '正文 共 3 个文件。',
  '',
  '- 列表 共 3 项',
  '',
  '```js',
  'const n = 共 3 个',
  '```',
  '',
  '行内 `共 3 个` 示例。',
].join('\n')
const mixedFixed = await fixToolRef.execute({ text: mixedDoc })
check('混合文档行数不变', mixedFixed.text.split('\n').length === mixedDoc.split('\n').length, String(mixedFixed.text.split('\n').length))
check('混合文档保留 frontmatter', mixedFixed.text.includes('title: 共 3 个文件'), '')
check('混合文档保留代码块', mixedFixed.text.includes('const n = 共 3 个'), '')
check('混合文档保留行内代码', mixedFixed.text.includes('行内 `共 3 个` 示例'), '')
check('混合文档正文已清', mixedFixed.text.includes('正文 共3个文件。') && mixedFixed.text.includes('- 列表 共3项'), mixedFixed.text)
check('HTML 代码标签内容不改', (await fixToolRef.execute({ text: '<code>共 3 个</code> 示例。' })).applied === 0, '')
check('HTML 正文照改', (await fixToolRef.execute({ text: '<div>共 3 个</div>' })).text === '<div>共3个</div>', '')
check('硬换行不被删', (await fixToolRef.execute({ text: '行一  \n行二 共 3 个。' })).text === '行一  \n行二 共3个。', '')
check(
  'HTML 注释内容不改',
  (await fixToolRef.execute({ text: '<!-- 共 3 个 -->\n正文 共 3 个。', kinds: ['cjk-latin-space'] })).text ===
    '<!-- 共 3 个 -->\n正文 共3个。',
  '',
)
check(
  '缩进代码块不改',
  (await fixToolRef.execute({ text: '说明：\n\n    const n = 共 3 个\n\n正文 共 3 个。', kinds: ['cjk-latin-space'] })).text ===
    '说明：\n\n    const n = 共 3 个\n\n正文 共3个。',
  '',
)
check(
  '嵌套列表仍然照改',
  (await fixToolRef.execute({ text: '- 项\n    - 子项 共 3 个', kinds: ['cjk-latin-space'] })).text === '- 项\n    - 子项 共3个',
  '',
)
check(
  '数学块不改',
  (await fixToolRef.execute({ text: '$$\nE = 共 3 个\n$$', kinds: ['cjk-latin-space'] })).text === '$$\nE = 共 3 个\n$$',
  '',
)
check(
  '多行 HTML 注释不改',
  (await fixToolRef.execute({ text: '<!--\n第一行 共 3 个\n-->\n正文 共 3 个。', kinds: ['cjk-latin-space'] })).text ===
    '<!--\n第一行 共 3 个\n-->\n正文 共3个。',
  '',
)
check(
  '链接里的中文路径不被改成全角',
  (await fixToolRef.execute({ text: '见 [说明](常见问题.md) 这里。', kinds: ['halfwidth-paren-cn'] })).text ===
    '见 [说明](常见问题.md) 这里。',
  '',
)

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
