/**
 * selftest.mjs — 不随包发布的开发自测。
 *
 * 跑三组样本 + 文档模式 + 规则章节长度检查：
 *   node selftest.mjs
 */

import { analyze, auditStructure } from './analyze.js'
import { auditTypography, fixTypography } from './typography.js'
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

const NUMBERED_DOC = `项目说明

一、背景

这套服务上线三个月，日请求从两万涨到六十万，单机扛不住了。

二、方案

拆成三层：接入、逻辑、存储。接入层只做鉴权和限流。

三、结果

P99 从 1.2 秒降到 220 毫秒。`

const CLICHE_DOC = `项目总结

一、底层逻辑与范式探析

值得注意的是，这个方案在一定程度上具有重要意义。团队在过去三个月里做了大量尝试，
包括重构数据链路、调整部署方式以及引入新的一致性校验。

二、未来展望

后续会继续推进相关工作。`

const ONE_HIT_EN = 'The parser is robust. We leverage a streaming decoder to keep memory flat. Each record is validated before it reaches the sink, so bad data fails fast.'

const THREE_HITS_EN = 'We leverage a streaming decoder. It is important to note that this keeps memory flat. We delve into the realm of validation before the sink.'

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
  [
    '英文段落不报句长偏长',
    !analyze(
      'In practice the trade-off is rarely clean. Teams often pick the faster path and pay for it later, which is why the migration took three releases instead of one.',
    ).notes.some(note => note.includes('偏长')),
  ],
  [
    '中文带长英文术语不误报英中混用',
    (auditTypography('我们使用 PostgreSQL，然后把索引重建。').counts['en-punct-cjk'] ?? 0) === 0,
  ],
  [
    '中文句子里的半角逗号被抓',
    (auditTypography('用 Postgres, 然后重建索引。').counts['halfwidth-punct-mixed'] ?? 0) === 1,
  ],
  ['英文逗号后面接英文不误报', auditTypography('Hello, world. Nothing here.').total === 0],
  ['带空格的单个 — 不算破折号错', auditTypography('**标签** — 说明文字').total === 0],
  ['紧贴文字的单个 — 仍报错', (auditTypography('段落一—段落二。').counts['dash-single'] ?? 0) === 1],
  ['半角括号包中文被抓', (auditTypography('(见 README) 这一节。').counts['halfwidth-paren-cn'] ?? 0) === 1],
  [
    '半角括号的修法正确',
    auditTypography('(见 README)').findings.some(item => item.kind === 'halfwidth-paren-cn' && item.fix === '（见 README）'),
  ],
  ['全角括号不误报', auditTypography('（见README）这一节。').total === 0],
  ['markdown 链接不误报', auditTypography('[文档](https://example.com/a) 在这里。').total === 0],
  ['版本号算一个词', analyze('升级到 v2.3.1 就好了。').stats.units === 8],
  ['缩写不切句', analyze('This is fine, e.g. the config. Next one is here.').stats.sentences === 2],
  ['正常英文照常切句', analyze('First sentence. Second one. Third.').stats.sentences === 3],
  [
    '中文后半角句号被抓',
    (auditTypography('这句话结束了. 下一句开始。').counts['halfwidth-period'] ?? 0) === 1,
  ],
  [
    '英文句号后接中文不误报',
    (auditTypography('The config. 然后配置。').counts['halfwidth-period'] ?? 0) === 0,
  ],
  [
    '无空格混排的半角逗号被抓',
    (auditTypography('用 Redis,然后处理。').counts['halfwidth-punct-mixed'] ?? 0) === 1,
  ],
  ['中文编号标题识别为文档', analyze(NUMBERED_DOC).mode === 'doc'],
  [
    '短文档不判标题过密',
    analyze('# 标题\n\n短句。\n', { mode: 'doc' }).notes.every(note => !note.includes('标题过密')),
  ],
  [
    '标题密集的长文档会提示',
    analyze(
      Array.from({ length: 10 }, (_, i) => `## 小${i}\n\n一句。\n`).join('\n'),
      { mode: 'doc' },
    ).notes.some(note => note.includes('标题过密')),
  ],
  ['结构审计数出中文标题', auditStructure(NUMBERED_DOC).headingCount === 3],
  [
    '代码块不算长段落',
    auditStructure('# 标题\n\n\`\`\`\n' + 'const a = 1; '.repeat(80) + '\n\`\`\`\n').findings.every(
      f => f.kind !== 'long-paragraph',
    ),
  ],
  [
    '真的长段落仍然报',
    auditStructure('# 标题\n\n' + '这是一段很长的文字。'.repeat(60) + '\n').findings.some(
      f => f.kind === 'long-paragraph',
    ),
  ],
  ['中文编号的八股标题被抓', (analyze(CLICHE_DOC).groups['标题八股'] ?? 0) > 0],
  ['单个命中不判模板腔', analyze(ONE_HIT_EN).verdict === 'mostly clean'],
  ['两处命中仍压在同一档', analyze(ONE_HIT_EN).hitCount === 1],
  ['三处命中照常判模板腔', analyze(THREE_HITS_EN).verdict !== 'clean'],
  [
    'YAML frontmatter 不计入排版',
    analyze('---\nname: x\ndescription: 写成文件, 出个文档, 交付\n---\n\n正文。').typography.total === 0,
  ],
  [
    'URL 不干扰中文语境判定',
    analyze('[名](https://example.com/a)（MIT，Copyright 2026）').typography.total === 0,
  ],
  ['短引文里的禁用词不算命中', analyze('不要写“值得注意的是”这种话。').hitCount === 0],
  [
    '长引文照常扫描',
    (analyze(`引文：“值得注意的是${'还有很长的一段内容'.repeat(6)}”结束。`).hitCount ?? 0) > 0,
  ],
  ['数字与汉字之间的空格被抓', (auditTypography('共 3 个文件。').counts['cjk-latin-space'] ?? 0) === 1],
  ['行首数字后接汉字被抓', (auditTypography('2024 年的数据。').counts['cjk-latin-space'] ?? 0) === 1],
  [
    '数字空格的修法正确',
    auditTypography('共 3 个文件。').findings.some(f => f.kind === 'cjk-latin-space' && f.fix === '共3'),
  ],
  [
    '英文词两侧的空格也清（版本号）',
    auditTypography('升级到 v2.3.1 版本。').findings.some(f => f.fix === '到v2.3.1'),
  ],
  ['纯英文词两侧空格也清', auditTypography('放在 Redis 里。').findings.some(f => f.fix === '在Redis')],
  ['英文句子内部不动', auditTypography('The parser is robust.').total === 0],
  ['符号两侧的空格也清', auditTypography('改配置 + 触发重载').findings.some(f => f.fix === '置+')],
  ['英文之间的加号不动', auditTypography('A + B 的组合').total === 0],
  ['相邻的几处都能修到', fixTypography('用 macOS 和 Windows 都行。', { kinds: ['cjk-latin-space'] }).text === '用macOS和Windows都行。'],
  ['连续符号也能全修', fixTypography('甲 + 乙 + 丙。', { kinds: ['cjk-latin-space'] }).text === '甲+乙+丙。'],
  ['C++ 带尾巴能识别', fixTypography('用 C++ 写。', { kinds: ['cjk-latin-space'] }).text === '用C++写。'],
  ['C# 带尾巴能识别', fixTypography('用 C# 写的。', { kinds: ['cjk-latin-space'] }).text === '用C#写的。'],
  ['邮箱整体算一个词', fixTypography('写 a@b.com 收。', { kinds: ['cjk-latin-space'] }).text === '写a@b.com收。'],
  ['温度单位算一个词', fixTypography('值 36.5℃ 正常。', { kinds: ['cjk-latin-space'] }).text === '值36.5℃正常。'],
  ['破折号两侧空格一起收', fixTypography('段落一 -- 段落二。', { kinds: ['dash-double-hyphen'] }).text === '段落一——段落二。'],
  ['已写破折号带空格也收', fixTypography('甲 —— 乙。', { kinds: ['dash-double-hyphen'] }).text === '甲——乙。'],
  ['命令行参数不误伤', (auditTypography('用 --store-dir 参数。').counts['dash-double-hyphen'] ?? 0) === 0],
  ['中文句里英文开头不误报', (auditTypography('Redis，是一个内存数据库。').counts['en-punct-cjk'] ?? 0) === 0],
  ['整句英文用中文标点仍报', (auditTypography('restart the service。').counts['en-punct-cjk'] ?? 0) === 1],
  ['判断英文语境不跨句', (auditTypography('中间一句。restart the service。').counts['en-punct-cjk'] ?? 0) === 1],
  ['省略号不跨句误报', (auditTypography('中文一句。wait... what').counts['ellipsis'] ?? 0) === 0],
  ['单破折号不跨句误报', (auditTypography('中文一句。a—b').counts['dash-single'] ?? 0) === 0],
  ['省略号在中文句里仍报', (auditTypography('他说了一句话...然后走了。').counts['ellipsis'] ?? 0) === 1],
  ['落单的英文引号被抓', (auditTypography('他说"走吧。').counts['ascii-quote-cn'] ?? 0) === 1],
  ['成对英文引号只报一次', (auditTypography('他说"走吧"。').counts['ascii-quote-cn'] ?? 0) === 1],
  ['英文句子里的引号不动', auditTypography('the "spec" file is here').total === 0],
  ['一行三个引号报两处', (auditTypography('前面 "甲" 中间 "乙').counts['ascii-quote-cn'] ?? 0) === 2],
  ['全角数字被标出', (auditTypography('２０２４年的数据。').counts['fullwidth-alnum'] ?? 0) === 1],
  ['全角数字能修成半角', fixTypography('２０２４年。', { kinds: ['fullwidth-alnum'] }).text === '2024年。'],
  ['全角字母能修', fixTypography('用Ｒｅｄｉｓ缓存。', { kinds: ['fullwidth-alnum'] }).text === '用Redis缓存。'],
  ['斜杠两侧空格也收', auditTypography('和 / 或').findings.some(f => f.fix === '和/')],
  ['型号两侧空格都清', (auditTypography('跑在 5G 网络上。').counts['cjk-latin-space'] ?? 0) === 1],
  [
    '型号的修法去掉两侧空格',
    auditTypography('跑在 5G 网络上。').findings.some(f => f.fix === '在5G'),
  ],
  ['数字后接英文只删前置', (auditTypography('共 3 files。').counts['cjk-latin-space'] ?? 0) === 1],
  [
    '数字后接英文的修法保留后置空格',
    auditTypography('共 3 files。').findings.some(f => f.fix === '共3'),
  ],
  ['单侧空格也抓', (auditTypography('把 300行拆成 3个文件。').counts['cjk-latin-space'] ?? 0) === 2],
  [
    '单侧空格的修法正确',
    auditTypography('把 300行拆成 3个文件。').findings.every(f => f.fix === '把300' || f.fix === '成3'),
  ],
  [
    '掩码不吃换行，行号不偏移',
    analyze('# 标题\n\n```js\nvar a = 1\nvar b = 2\n```\n\n共 3 个文件。').typography.findings.some(
      f => f.kind === 'cjk-latin-space' && f.line === 8,
    ),
  ],
  ['标点前空格被抓', (auditTypography('测试 ，然后继续。').counts['space-before-punct'] ?? 0) === 1],
  [
    '标点前空格的修法正确',
    auditTypography('测试 ，然后继续。').findings.some(f => f.kind === 'space-before-punct' && f.fix === '，'),
  ],
  [
    '百分号前空格一并压掉',
    auditTypography('完成率 50 %，比上月高。').findings.some(f => f.fix === '率50%'),
  ],
  ['未闭合的引号被抓', (auditTypography('他说「走吧，明天见。').counts['unbalanced-mark'] ?? 0) === 1],
  ['未闭合的括号被抓', (auditTypography('（未闭合的括号').counts['unbalanced-mark'] ?? 0) === 1],
  ['多余的闭号被抓', (auditTypography('走吧」，明天见。').counts['unbalanced-mark'] ?? 0) === 1],
  ['配对正常不误报', auditTypography('他说「走吧」，明天见（真的）。').total === 0],
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
