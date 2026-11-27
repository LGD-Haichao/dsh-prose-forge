/**
 * typography.js — 中文排版体检。
 *
 * 和analyze.js分工不同：那边查"像不像AI写的"，这边查"合不合中文排版规范"。
 * 两者不混算分数——排版错是硬伤，文风是口味，混在一起会互相淹没。
 *
 * 全部规则是确定性的，同输入同输出，可以当CI门禁用。
 */

/** 汉字范围，拼进正则用。 */
const CJK = '\\u4e00-\\u9fa5'

/** 半角标点 → 全角。 */
const PUNCT_MAP = {
  ',': '，',
  ';': '；',
  ':': '：',
  '?': '？',
  '!': '！',
}

/** 全角标点 → 半角，反过来用。 */
const ASCII_MAP = {
  '，': ',',
  '。': '.',
  '；': ';',
  '：': ':',
  '！': '!',
  '？': '?',
}

/** 每条规则的替换建议；没有就是"要改但没法机械替换"。 */
const FIXES = {
  // 匹配是"汉字+半角标点"，只换最后一个字符，前面的汉字要留着。
  'halfwidth-punct': m => m.slice(0, -1) + (PUNCT_MAP[m.slice(-1)] ?? ''),
  'halfwidth-punct-mixed': m => m.slice(0, -1) + (PUNCT_MAP[m.slice(-1)] ?? ''),
  'halfwidth-period': m => m.slice(0, -1) + '。',
  ellipsis: () => '……',
  'dash-double-hyphen': () => '——',
  'dash-single': () => '——',
  'repeat-punct': m => m[1],
  'space-before-punct': m => m[1],
  'en-punct-cjk': m => ASCII_MAP[m] ?? m,
  'halfwidth-paren-cn': m => `（${m.slice(1, -1)}）`,
  'fullwidth-space': () => ' ',
  'fullwidth-alnum': m =>
    m.replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)),
  'trailing-space': () => '',
}

const RULES = [
  {
    kind: 'halfwidth-punct',
    group: '半角标点',
    severity: 2,
    re: new RegExp(`([${CJK}])[,;:?!]`, 'g'),
    advice: '中文句子里的逗号、分号、冒号、问号、叹号用全角。',
  },
  {
    kind: 'halfwidth-punct-mixed',
    group: '半角标点',
    severity: 2,
    cjkContext: true,
    // 英文词后面跟半角逗号、但逗号后面接的是中文——说明整句是中文，该用全角。
    re: new RegExp(`[A-Za-z][,;](?=\\s*[${CJK}])`, 'g'),
    advice: '中文句子里的逗号、分号用全角，即使前面紧挨着英文词。',
  },
  {
    kind: 'halfwidth-period',
    group: '半角标点',
    severity: 2,
    // 句号后面跟空格再接汉字也算——中文句子写完常顺手打个空格，不该因此漏检。
    re: new RegExp(`[${CJK}]\\.(?=\\s*[${CJK}])`, 'g'),
    advice: '句号用全角「。」。小数点、版本号里的点不算。',
  },
  {
    kind: 'ellipsis',
    group: '省略号',
    severity: 1,
    cjkContext: true,
    re: /\.{3,}|。{2,}/g,
    advice: '省略号是「……」（两个三连点，六个点），不是「...」也不是「。。」。',
  },
  {
    kind: 'dash-double-hyphen',
    group: '破折号',
    severity: 1,
    cjkContext: true,
    // 只在两侧都是空白或汉字时才算破折号，不然 --store-dir这种命令行参数会被误判。
    re: new RegExp(`(?<=[\\s，。、])--(?=[\\s，。、])|(?<=[${CJK}])--(?=[${CJK}])`, 'g'),
    advice: '破折号用「——」（两个），不是两个连字符。',
  },
  {
    kind: 'dash-single',
    group: '破折号',
    severity: 1,
    cjkContext: true,
    // 两侧紧贴文字的单个 — 才是错写的破折号。"标签 — 说明" 这种带空格的
    // 分隔符是从英文借来的写法，不算中文破折号错误。
    re: /(?<![—\d\s])—(?![—\d\s])/g,
    advice: '破折号要成对：「——」。单个 — 是连接号或范围号；数字之间的年份区间不算错。',
  },
  {
    kind: 'ascii-quote-cn',
    group: '引号',
    severity: 2,
    re: new RegExp(`"[${CJK}][^"\\n]{0,60}"`, 'g'),
    advice: '中文内容用中文引号「」或“”，不要用英文直引号。',
  },
  {
    kind: 'fullwidth-alnum',
    group: '全角字母数字',
    severity: 1,
    re: /[０-９Ａ-Ｚａ-ｚ]+/g,
    advice: '全角字母和数字在中文里像排版事故，换半角：２０２４→2024、Ｒｅｄｉｓ→Redis。',
  },
  {
    kind: 'repeat-punct',
    group: '重复标点',
    severity: 1,
    re: /([，。；：、！？])\1+/g,
    advice: '同一个标点连打多次，留一个。强调靠内容，不靠标点。',
  },
  {
    kind: 'punct-line-start',
    group: '行首标点',
    severity: 1,
    re: /^[，。；：、！？]/gm,
    advice: '标点不能出现在行首，这是中文排版的硬规矩。',
  },
  {
    kind: 'space-before-punct',
    group: '标点前空格',
    severity: 1,
    re: /[ \t]+([，。、；：！？])/g,
    advice: '中文标点前面不留空格，直接贴住上一个字。',
  },
  {
    kind: 'fullwidth-space',
    group: '空格',
    severity: 1,
    re: /\u3000/g,
    advice: '用普通空格，不要用全角空格。',
  },
  {
    kind: 'double-space',
    group: '空格',
    severity: 1,
    cjkContext: true,
    re: /[^\s] {2,}[^\s]/g,
    advice: '正文里连续两个以上空格，收成一个。缩进用样式控制，不靠敲空格。',
  },
  {
    kind: 'trailing-space',
    group: '空格',
    severity: 1,
    re: /[ \t]+(?=\r?\n|$)/g,
    advice: '行尾空白删掉，版本对比时会变成噪音。',
  },
  {
    kind: 'en-punct-cjk',
    group: '英中混用标点',
    severity: 2,
    // 标点前必须是三个以上拉丁字母，且前面三十个字符里不能有汉字——
    // 窗口给到30是因为中文句子常带长英文术语（"我们使用PostgreSQL，然后"），
    // 10个字不够用，会被术语占满而误判成英文句子。
    asciiBefore: 30,
    re: /(?<=[A-Za-z]{3})[，。；：！？]/g,
    advice: '前半是英文，标点却用了中文的。英文句子用英文标点。',
  },
  {
    kind: 'halfwidth-paren-cn',
    group: '括号',
    severity: 1,
    // 括号里出现汉字才算。markdown链接的圆括号里只有URL，不会中。
    re: new RegExp(`\\([^()\\n]{0,60}[${CJK}][^()\\n]{0,60}\\)`, 'g'),
    advice: '中文内容用全角括号（）。',
  },
]

/**
 * 每行起始下标。
 * @param {string} text - 文本
 * @returns {number[]} 每行开头在原文里的下标
 */
function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/**
 * 字符下标换成行列，都是1基。
 * @param {number[]} starts - lineStarts的结果
 * @param {number} index - 字符下标
 * @returns {{ line: number, col: number }} 行列
 */
function locate(starts, index) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: index - starts[lo] + 1 }
}

/**
 * 汉字与拉丁标记之间的空格。
 *
 * 规则：只要英文（或数字）前后不是英文，就不留空格。
 * `放在Redis里`、`v2.3.1版本`、`共3个`、`写请求超过一半`。
 * 英文句子内部的空格照旧——`The parser is robust` 不动。
 *
 * @param {string} text - 已掩码的正文
 * @param {number[]} starts - 每行起始下标
 * @returns {object[]} 命中列表
 */
function latinSpacingFindings(text, starts) {
  const out = []
  const covered = []
  const overlaps = (from, to) => covered.some(([a, b]) => from < b && to > a)

  const push = (index, matched, fix) => {
    if (overlaps(index, index + matched.length)) return
    covered.push([index, index + matched.length])
    const { line, col } = locate(starts, index)
    out.push({
      kind: 'cjk-latin-space',
      group: '中英混排',
      severity: 1,
      line,
      col,
      index,
      match: matched,
      advice: '汉字和英文、数字之间不留空格；英文内部、以及英文与英文之间的空格照旧。',
      fix,
    })
  }

  // 一个拉丁标记：Redis、v2.3.1、5G、50%、config.yaml都算一个整体。
  // 末尾允许「空格 + 百分号」，好让50 % 和前面的空格一起收掉。
  // 结尾不许是点或连字符，否则会把句号、范围号一并吞进来。
  const MID = String.raw`A-Za-z0-9._#+%‰'’/@°℃-`
  const END = String.raw`A-Za-z0-9_+#%‰°℃`
  const token = String.raw`[A-Za-z0-9](?:[${MID}]*[${END}])?(?:[ \t]*[%‰％])?`
  const compact = value => value.replace(/[ \t]+/g, '')

  // 一、汉字 标记 汉字：任一侧有空格就压掉。
  // 右边那个汉字用前瞻，不吞进匹配——吞了它，「A 和 B 和 C」里的 B 就没法
  // 再跟后面的 C 组队，一条句子里相邻的几处只会修到一半。
  for (const match of text.matchAll(new RegExp(`([一-龥])([ \\t]*)(${token})([ \\t]*)(?=[一-龥])`, 'g'))) {
    const [, left, gapBefore, core, gapAfter] = match
    if (gapBefore === '' && gapAfter === '') continue
    push(match.index, match[0], `${left}${compact(core)}`)
  }

  // 二、汉字 空格 标记，标记后面不是汉字：共3 files。前置空格删掉，后面留给英文。
  for (const match of text.matchAll(new RegExp(`([一-龥])([ \\t]+)(${token})(?![ \\t]*[一-龥])`, 'g'))) {
    push(match.index, match[0], `${match[1]}${compact(match[3])}`)
  }

  // 三、行首或标点之后的标记 + 空格 + 汉字：v2.3.1版本、2024年的数据。
  for (const match of text.matchAll(new RegExp(`(^|[，。、；：！？）】」”])[ \\t]*(${token})([ \\t]+)(?=[一-龥])`, 'gm'))) {
    push(match.index, match[0], `${match[1]}${compact(match[2])}`)
  }

  // 四、汉字 空格 符号 空格 汉字：改配置 + 触发重载 → 改配置+触发重载。
  // 同样用前瞻，好让「甲 + 乙 + 丙」里的乙能继续往后组队。
  for (const match of text.matchAll(/([一-龥])([ \t]*)([+&×÷=~·/])([ \t]*)(?=[一-龥])/g)) {
    const [, left, gapBefore, symbol, gapAfter] = match
    if (gapBefore === '' && gapAfter === '') continue
    push(match.index, match[0], `${left}${symbol}`)
  }

  return out
}

/** 成对的中文标点。ASCII引号交给ascii-quote-cn，不在这里查。 */
const BALANCE_PAIRS = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['（', '）'],
  ['【', '】'],
]

/** 配对一个命中。 */
function balanceHit(starts, index, detail) {
  const { line, col } = locate(starts, index)
  return {
    kind: 'unbalanced-mark',
    group: '配对',
    severity: 2,
    line,
    col,
    index,
    match: detail,
    advice: '引号和括号要成对。漏一个开合符号，长文档里肉眼几乎发现不了。',
  }
}

/**
 * 引号与括号配对检查。
 *
 * 同类配对用栈扫一遍：遇到开号压栈，遇到闭号弹栈；闭号时栈空说明多了一个，
 * 扫完栈不空说明漏了闭号。位置取那个没配上的符号本身，方便直接跳过去改。
 *
 * @param {string} text - 已掩码的正文
 * @param {number[]} starts - 每行起始下标
 * @returns {object[]} 命中列表
 */
/**
 * 落单的英文直引号。
 *
 * 按行数引号：偶数正常，奇数说明少了一个。成对的由前面的规则报，
 * 这条只补落单的，同一行不重复报。行内没有汉字就不算——那是英文原文。
 *
 * @param {string} text - 已掩码的正文
 * @param {number[]} starts - 每行起始下标
 * @param {object[]} existing - 已有命中
 * @param {boolean} raw - 是否原始模式（不截断）
 * @returns {object[]} 命中列表
 */
function quoteParityFindings(text, starts, raw) {
  const out = []
  const cjkRe = new RegExp(`[${CJK}]`)

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : text.length
    const line = text.slice(start, end)
    const quotes = line.split('"').length - 1
    if (quotes === 0 || quotes % 2 === 0) continue
    if (!cjkRe.test(line)) continue

    const col = line.indexOf('"') + 1
    out.push({
      kind: 'ascii-quote-cn',
      group: '引号',
      severity: 2,
      line: i + 1,
      col,
      index: start + col - 1,
      match: !raw && line.length > 40 ? `${line.slice(0, 40)}…` : line,
      advice: '这一行的英文直引号配对丢了。中文内容用中文引号「」或“”，成对写。',
    })
  }
  return out
}

function balanceFindings(text, starts) {
  const out = []
  for (const [open, close] of BALANCE_PAIRS) {
    const stack = []
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]
      if (char === open) {
        stack.push(i)
        continue
      }
      if (char !== close) continue
      if (stack.length > 0) stack.pop()
      else out.push(balanceHit(starts, i, `多余的${close}`))
    }
    for (const index of stack) out.push(balanceHit(starts, index, `未闭合的${open}`))
  }
  return out
}

/**
 * 排版体检。
 *
 * @param {string} text - 已掩掉代码块的正文
 * @param {object} [options]
 * @param {number} [options.limit] - 最多返回多少条，默认30
 * @param {string[]} [options.skip] - 要跳过的kind
 * @returns {object} 报告
 */
export function auditTypography(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: true, total: 0, counts: {}, findings: [], truncated: false }
  }

  try {
    const raw = options.raw === true
    const limit = raw ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.min(200, Number(options.limit) || 30))
    const skip = Array.isArray(options.skip) ? new Set(options.skip) : new Set()
    const starts = lineStarts(text)
    const findings = []

    const cjkRe = new RegExp(`[${CJK}]`)

    for (const rule of RULES) {
      if (skip.has(rule.kind)) continue
      const re = new RegExp(rule.re.source, rule.re.flags)
      let match = re.exec(text)
      let perRule = 0
      while (match !== null && perRule < 20) {
        // 英文语境里的 ... 和单个 — 是合法用法，只在附近有汉字时才判为错误。
        const nearby = text.slice(
          Math.max(0, match.index - 15),
          Math.min(text.length, match.index + match[0].length + 15),
        )
        const inCjkContext = !rule.cjkContext || cjkRe.test(nearby)
        const before = text.slice(Math.max(0, match.index - (rule.asciiBefore ?? 0)), match.index)
        // 前面有汉字，或者有中文的开括号、开引号，都算中文语境。
        // 只认汉字会误伤「（MIT，Copyright 2026）」这种括号里起头的英文词；
        // 但句末标点不算信号，否则同一句里第二个错标点会被第一个压掉。
        const inAsciiContext = !rule.asciiBefore || !/[一-龥（【「“]/.test(before)
        if (match[0].length > 0 && inCjkContext && inAsciiContext) {
          const { line, col } = locate(starts, match.index)
          const fixer = FIXES[rule.kind]
          findings.push({
            kind: rule.kind,
            group: rule.group,
            severity: rule.severity,
            line,
            col,
            index: match.index,
            match: !raw && match[0].length > 40 ? `${match[0].slice(0, 40)}…` : match[0],
            advice: rule.advice,
            ...(fixer ? { fix: fixer(match[0]) } : {}),
          })
          perRule += 1
        }
        if (re.lastIndex === match.index) re.lastIndex += 1
        match = re.exec(text)
      }
    }

    findings.push(...latinSpacingFindings(text, starts))
    findings.push(...balanceFindings(text, starts))
    findings.push(...quoteParityFindings(text, starts, raw))

    // skip 要作用到全部检查，不只是正则那批。数字空格和配对检查是后加的，
    // 如果只在规则循环里判 skip，它们会绕过去。
    const kept = skip.size > 0 ? findings.filter(finding => !skip.has(finding.kind)) : findings

    kept.sort((a, b) => a.index - b.index)
    const counts = {}
    for (const finding of kept) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1
    const truncated = kept.length > limit

    return {
      ok: true,
      total: kept.length,
      counts,
      fixable: kept.filter(item => item.fix !== undefined).length,
      truncated,
      findings: raw
        ? kept
        : (truncated ? kept.slice(0, limit) : kept).map(({ index: _index, ...rest }) => rest),
    }
  } catch (error) {
    return { ok: false, error: `排版体检失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 已知的检查项，写进文档和配置校验用。 */
export const TYPO_KINDS = [
  ...new Set([...RULES.map(rule => rule.kind), 'cjk-latin-space', 'unbalanced-mark']),
]

/**
 * 按检查结果改写文本。
 *
 * 默认只清汉字与英文/数字之间的空格——那条约定没定死，所以做成按需调用：
 * 平时扫描不报，想清的时候调这个。
 *
 * @param {string} text - 原文
 * @param {object} [options]
 * @param {string[]} [options.kinds] - 要修的检查项，默认 ['cjk-latin-space']
 * @returns {{ ok: boolean, applied?: number, text?: string, error?: string }} 结果
 */
export function fixTypography(text, options = {}) {
  if (typeof text !== 'string') return { ok: false, error: '没有可修的文本。' }
  const kinds = new Set(
    Array.isArray(options.kinds) && options.kinds.length > 0 ? options.kinds : ['cjk-latin-space'],
  )

  const report = auditTypography(text, { raw: true, skip: [] })
  if (report.ok === false) return { ok: false, error: report.error }

  const targets = report.findings
    .filter(finding => typeof finding.fix === 'string' && kinds.has(finding.kind))
    .sort((a, b) => b.index - a.index)

  let out = text
  for (const finding of targets) {
    out = out.slice(0, finding.index) + finding.fix + out.slice(finding.index + finding.match.length)
  }
  return { ok: true, applied: targets.length, text: out }
}
