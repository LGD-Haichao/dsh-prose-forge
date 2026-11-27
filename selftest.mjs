/**
 * selftest.mjs — 不随包发布的开发自测。
 *
 * 跑三组样本 + 文档模式 + 规则章节长度检查：
 *   node selftest.mjs
 */

import { analyze } from './analyze.js'
import { PARTS, lookup } from './rules.js'
import { STYLE_PROMPT } from './prompt.js'

const DIRTY_ZH = `在当今数字化转型的背景下，如何提升开发效率成为了一个值得深入探讨的重要议题。值得注意的是，很多团队在这方面都进行了大量的尝试，取得了一定的成效。

首先，工具链的完善是至关重要的。其次，流程的规范同样不可忽视。最后，团队文化的建设也起到了关键的作用。不是工具不够好，而是方法不对。

综上所述，该方案具有一定的可行性和推广价值，但仍需在实践中不断完善。希望对你有帮助。`

const CLEAN_ZH = `装插件只要一行命令。

dsh plugin --profile desktop add github:pseudonymzjt/dsh-direct-human-style

装完重载 profile，插件页能看到条目就是成功了。如果看不到，先看 pnpm 的报错，再看 cordis.patch.yml 里的 id 对不对得上。

这一步最容易卡住的地方是网络。github: 走的是 git clone，公司网络常常只放行 https 的 zip 下载，不放行 git 协议。这时候换成下载 tarball 再 link 本地目录。

目前只在 Windows 上验证过。macOS 没测。`

const DIRTY_EN = `In today's fast-paced world, it is important to note that developers must delve into the realm of performance optimization. This is not only a technical challenge but also a cultural one.

Leveraging cutting-edge tooling, teams can seamlessly unlock significant improvements. The results are a testament to the power of robust engineering practices.`

const DOC_SAMPLE = `# 插件安装实践探析

本节将介绍插件的安装流程。随着生态的不断发展，插件已经成为赋能开发者的重要抓手。

## 一、底层逻辑与范式

值得注意的是，安装插件需要在一定程度上理解其颗粒度。不是配置难，而是文档缺失。

## 二、结语

综上所述，该方案具有重要的里程碑意义，希望对你有帮助。`

function header(title) {
  console.log(`\n=== ${title} ===`)
}

function show(label, report) {
  if (report.ok === false) {
    console.log(`${label}: ERROR ${report.error}`)
    return
  }
  console.log(
    `${label}: ${report.verdictZh}(${report.verdict}) score=${report.score} chars=${report.chars} ` +
      `hits=${report.hitCount} mode=${report.mode}`,
  )
  const groups = Object.entries(report.groups)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g}:${n}`)
    .join(' ')
  if (groups) console.log(`  groups: ${groups}`)
  if (report.notes.length > 0) report.notes.forEach(n => console.log(`  note: ${n}`))
}

header('样本')
const dirty = analyze(DIRTY_ZH)
const clean = analyze(CLEAN_ZH)
const en = analyze(DIRTY_EN)
const doc = analyze(DOC_SAMPLE, { mode: 'doc' })
show('脏中文', dirty)
show('净中文', clean)
show('脏英文', en)
show('文档模式', doc)

header('断言')
const checks = [
  ['脏中文被判模板腔', ['some templating', 'heavily templated'].includes(dirty.verdict)],
  ['脏中文命中平行否定', (dirty.groups['平行否定'] ?? 0) > 0],
  ['脏中文命中套话收尾', (dirty.groups['套话收尾'] ?? 0) > 0],
  ['净中文判干净', ['clean', 'mostly clean'].includes(clean.verdict)],
  ['净中文命中数为 0', clean.hitCount === 0],
  ['净中文识别为 chat 模式', clean.mode === 'chat'],
  ['脏英文有命中', en.hitCount > 0],
  ['文档样本识别为 doc 模式', doc.mode === 'doc'],
  ['文档样本命中标题八股', (doc.groups['标题八股'] ?? 0) > 0],
  ['文档样本命中空转表述', (doc.groups['空转表述'] ?? 0) > 0],
  ['空文本返回错误', analyze('   ').ok === false],
  ['非法 mode 不崩', typeof analyze('测试。', { mode: 'bogus' }).ok === 'boolean'],
  ['limit 生效', analyze(DIRTY_ZH, { limit: 2 }).hits.length <= 2],
  [
    '无数字的长文提示数字密度',
    analyze('这是一段没有任何数字的说明文字。'.repeat(30), { mode: 'doc' }).notes.some(n => n.includes('数字')),
  ],
  [
    '围栏代码块里的套话不计入命中',
    (analyze('正文。\n\n```js\n// 值得注意的是\n```\n\n结尾。').groups['元话语'] ?? 0) === 0,
  ],
  [
    '代码块被掩掉且下标不偏移',
    analyze('正文。\n\n```js\nconst a = 1\n```\n\n综上所述。').hits.some(h => h.line === 7 && h.group === '套话收尾'),
  ],
  ['排版：中文里的半角逗号被抓住', (analyze('第一，第二,第三。').typography.counts['halfwidth-punct'] ?? 0) > 0],
  [
    '排版：半角标点的修法保留汉字',
    analyze('第一,第二。').typography.findings.some(item => item.kind === 'halfwidth-punct' && item.fix === '一，'),
  ],
  [
    '排版：半角句号的修法保留汉字',
    analyze('好.然后。').typography.findings.some(item => item.kind === 'halfwidth-period' && item.fix === '好。'),
  ],
  ['排版：省略号写成三个点被抓住', (analyze('等一下...再说。').typography.counts.ellipsis ?? 0) > 0],
  ['排版：英文省略号不误报', analyze('Wait... let me check the logs.').typography.total === 0],
  ['排版：英文单破折号不误报', analyze('The fix — if it works — ships today.').typography.total === 0],
  [
    '排版：命令行参数不算破折号',
    (analyze('用 --store-dir 参数装。').typography.counts['dash-double-hyphen'] ?? 0) === 0,
  ],
  [
    '排版：中文里的 -- 仍会被抓',
    (analyze('段落一 -- 段落二。').typography.counts['dash-double-hyphen'] ?? 0) > 0,
  ],
  ['排版：英文句子混中文标点被抓', (analyze('Hello，world。').typography.counts['en-punct-cjk'] ?? 0) === 2],
  [
    '排版：中文句子里的英文词不算错',
    (analyze('我们用了 Vim。').typography.counts['en-punct-cjk'] ?? 0) === 0,
  ],
  [
    '排版：年份区间不算破折号错误',
    (analyze('2020—2021 年的数据。').typography.counts['dash-single'] ?? 0) === 0,
  ],
  ['行内代码里的套话不计入命中', analyze('不要写 `值得注意的是` 这种话。').hitCount === 0],
  ['行内代码里的标点不算排版错', analyze('调用 `foo(a,b)` 就行。').typography.total === 0],
  ['排版：行尾空格被抓住', (analyze('这行有空格   \n下一行。').typography.counts['trailing-space'] ?? 0) > 0],
  [
    '排版：代码块里的半角标点不算',
    (analyze('正文。\n\n```js\nfoo(a,b)\n```\n').typography.counts['halfwidth-punct'] ?? 0) === 0,
  ],
  [
    '自定义规则能命中',
    (analyze('这里有个 ZZ 标记。', { customRules: [{ pattern: 'ZZ', group: '测试' }] }).groups['测试'] ?? 0) === 1,
  ],
  [
    '无效正则不崩且被记录',
    (() => {
      const report = analyze('测试。', { customRules: [{ pattern: '([' }] })
      return report.ok === true && report.invalidRules?.length === 1
    })(),
  ],
]

let failed = 0
for (const [label, pass] of checks) {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!pass) failed += 1
}

header('规则与契约长度')
console.log(`契约 ${STYLE_PROMPT.length} 字`)
for (const part of PARTS.filter(p => p !== 'all')) {
  const body = lookup(part)
  console.log(`  ${part}: ${body === null ? 'MISSING' : `${body.length} 字`}`)
}
const all = lookup('all')
console.log(`  all: ${all === null ? 'MISSING' : `${all.length} 字`}`)

if (failed > 0) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log(`\n全部通过（${checks.length} 项断言）`)
