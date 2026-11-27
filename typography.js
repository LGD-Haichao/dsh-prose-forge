/**
 * typography.js — 中文排版体检。
 *
 * 和 analyze.js 分工不同：那边查"像不像 AI 写的"，这边查"合不合中文排版规范"。
 * 两者不混算分数——排版错是硬伤，文风是口味，混在一起会互相淹没。
 *
 * 全部规则是确定性的，同输入同输出，可以当 CI 门禁用。
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
  'en-punct-cjk': m => ASCII_MAP[m] ?? m,
  'halfwidth-paren-cn': m => `（${m.slice(1, -1)}）`,
  'fullwidth-space': () => ' ',
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
    re: new RegExp(`[${CJK}]\\.(?=[${CJK}])`, 'g'),
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
    // 只在两侧都是空白或汉字时才算破折号，不然 --store-dir 这种命令行参数会被误判。
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
    // 窗口给到 30 是因为中文句子常带长英文术语（"我们使用 PostgreSQL，然后"），
    // 10 个字不够用，会被术语占满而误判成英文句子。
    asciiBefore: 30,
    re: /(?<=[A-Za-z]{3})[，。；：！？]/g,
    advice: '前半是英文，标点却用了中文的。英文句子用英文标点。',
  },
  {
    kind: 'halfwidth-paren-cn',
    group: '括号',
    severity: 1,
    // 括号里出现汉字才算。markdown 链接的圆括号里只有 URL，不会中。
    re: new RegExp(`\\([^()\\n]{0,60}[${CJK}][^()\\n]{0,60}\\)`, 'g'),
    advice: '中文内容用全角括号（）。',
  },
  {
    kind: 'cjk-latin-gap',
    group: '中英混排',
    severity: 1,
    re: new RegExp(`(?:[${CJK}][A-Za-z]|[A-Za-z][${CJK}])`, 'g'),
    advice: '中文和英文、数字之间加一个空格，读起来不挤。这条是风格项，团队不统一可以关掉。',
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
 * 字符下标换成行列，都是 1 基。
 * @param {number[]} starts - lineStarts 的结果
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
 * 排版体检。
 *
 * @param {string} text - 已掩掉代码块的正文
 * @param {object} [options]
 * @param {number} [options.limit] - 最多返回多少条，默认 30
 * @param {string[]} [options.skip] - 要跳过的 kind
 * @returns {object} 报告
 */
export function auditTypography(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: true, total: 0, counts: {}, findings: [], truncated: false }
  }

  try {
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 30))
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
        const inAsciiContext = !rule.asciiBefore || !cjkRe.test(before)
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
            match: match[0].length > 40 ? `${match[0].slice(0, 40)}…` : match[0],
            advice: rule.advice,
            ...(fixer ? { fix: fixer(match[0]) } : {}),
          })
          perRule += 1
        }
        if (re.lastIndex === match.index) re.lastIndex += 1
        match = re.exec(text)
      }
    }

    findings.sort((a, b) => a.index - b.index)
    const counts = {}
    for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1
    const truncated = findings.length > limit

    return {
      ok: true,
      total: findings.length,
      counts,
      fixable: findings.filter(item => item.fix !== undefined).length,
      truncated,
      findings: (truncated ? findings.slice(0, limit) : findings).map(({ index: _index, ...rest }) => rest),
    }
  } catch (error) {
    return { ok: false, error: `排版体检失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 供测试与外部复用：规则清单的形状。 */
export const TYPO_KINDS = RULES.map(rule => rule.kind)
