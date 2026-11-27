/**
 * analyze.js — 文风扫描器。
 *
 * 两件事：
 *   1. 正则规则：命中中文与英文的 AI 腔表达，给出位置、类别、严重度、改法
 *   2. 统计指标：破折号密度、加粗占比、列表行占比、句长与段落长度的变异系数
 *
 * 统计指标比正则更能抓住"结构上的 AI 味"：每段差不多长、每句差不多长，
 * 这两件事用词表抓不到。
 *
 * 命中是线索，不是判决书。调用方应当在报告里保留这个状语。
 */

import { auditTypography } from './typography.js'

/** 严重度权重：3 重 / 2 中 / 1 轻。 */
const WEIGHT = { 3: 3, 2: 2, 1: 1 }

/**
 * 规则表。
 * - `modes` 省略表示两种模式都跑
 * - `re` 在每次分析时重新构造，避免 global 状态的 lastIndex 污染
 */
const RULES = [
  {
    id: 'parallel-negation',
    group: '平行否定',
    severity: 2,
    re: /不是[^。！？；\n]{1,20}[，,]?\s*而是|并非[^。！？；\n]{1,20}[，,]?\s*而是|与其说[^。！？；\n]{1,20}[，,]?\s*不如说/g,
    advice: '只留正面那句。先否定再肯定只是把话说长了一圈。',
  },
  {
    id: 'meta-talk',
    group: '元话语',
    severity: 2,
    re: /值得注意的是|需要指出的是|值得一提的是|不难发现|众所周知|毋庸置疑|不言而喻/g,
    advice: '删掉，直接说那件事。这类词不携带信息。',
  },
  {
    id: 'transition-filler',
    group: '过渡废话',
    severity: 1,
    re: /接下来我们|下面我们|让我们来|首先来看|如前所述/g,
    advice: '删掉过渡句，让下一段直接开始。',
  },
  {
    id: 'pseudo-rigor',
    group: '伪严谨',
    severity: 1,
    re: /在一定程度上|某种程度上|一定的可行性|可以说[，,]|相对而言|具有一定的/g,
    advice: '要么给范围（在 X 场景下），要么删掉限定词直接下判断。',
  },
  {
    id: 'closing-cliche',
    group: '套话收尾',
    severity: 2,
    re: /综上所述|总的来说|总而言之|由此可见|可以看出|希望对你有帮助|希望这能帮到你|以上就是/g,
    advice: '结尾停在最后一条实质信息上，或给下一步。不要复述开头。',
  },
  {
    id: 'buzzword',
    group: '抽象大词',
    severity: 2,
    re: /赋能|抓手|闭环|生态位|底层逻辑|顶层设计|颗粒度|范式|势能/g,
    advice: '换成一个具体动作或具体名词。说不出具体是什么，就是这个词在替你思考。',
  },
  {
    id: 'inflation',
    group: '拔高',
    severity: 2,
    re: /深刻|深远|里程碑|划时代|颠覆性|革命性|不可估量|至关重要|举足轻重/g,
    advice: '删掉后句子还成立，就说明它本来可以删。要让读者感到重要，给数字。',
  },
  {
    id: 'borrowed-authority',
    group: '借权威',
    severity: 1,
    re: /研究表明|数据显示|业内普遍认为|专家指出|据统计/g,
    advice: '补出处，或改成自己的判断（"我实测下来"）。无出处的权威是编造的。',
  },
  {
    id: 'redundant-nominalization',
    group: '中文冗余',
    severity: 1,
    re: /(?:进行|实现|开展|完成|予以|加以)(?:了)?[^。！？\n]{0,10}(?:的分析|的检查|的研究|的讨论|的处理|的评估|的梳理|的工作)|起到了[^。！？\n]{0,12}的作用|具有[^。！？\n]{0,12}的意义|通过[^。！？\n]{0,12}的方式|所谓的/g,
    advice: '压成一个动词。"进行了检查" → "检查了"。',
  },
  {
    id: 'triple-parallel',
    group: '三连排比',
    severity: 2,
    re: /既要[^。！？\n]{1,30}又要[^。！？\n]{1,30}还要|不仅[^。！？\n]{1,25}而且[^。！？\n]{1,25}还/g,
    advice: '三连排比是 AI 的节奏习惯。改成一句直陈，或真的分成三条。',
  },
  {
    id: 'firstly-secondly',
    group: '八股序列',
    severity: 2,
    // 允许跨句：AI 常写成"首先，……。其次，……。最后，……。"，每句都独立成立。
    re: /首先[\s\S]{0,80}?其次[\s\S]{0,80}?(?:最后|再次)/g,
    advice: '内容真有先后顺序才用序列词，否则删掉直接并列。',
  },
  {
    id: 'heading-cliche',
    group: '标题八股',
    severity: 2,
    modes: ['doc'],
    re: /^(?:#{1,6}[ \t]|[一二三四五六七八九十百]+[、.．][ \t]*|[（(][一二三四五六七八九十百]+[）)][ \t]*).*(?:浅谈|浅析|探析|刍议|管窥|视域|实践与思考|赋能|驱动)/gm,
    advice: '标题写名词或动宾短语。"插件安装实践探析" → "怎么装插件"。',
  },
  {
    id: 'doc-filler',
    group: '空转表述',
    severity: 1,
    modes: ['doc'],
    re: /本节将|本文将介绍|本文将从|旨在探讨|以期|下面将从/g,
    advice: '删掉"本节将……"，直接开始写这一节。',
  },
  {
    id: 'en-hedging',
    group: '英文AI腔',
    severity: 2,
    re: /\b(?:delve into|it is important to note|it is worth noting|in the realm of|at the end of the day|a testament to|a tapestry of|navigate the landscape)\b/gi,
    advice: 'Delete the scaffolding; state the point.',
  },
  {
    id: 'en-buzzword',
    group: '英文大词',
    severity: 1,
    re: /\b(?:leverage|leverages|leveraging|seamless|unlock|elevate|empower|game-changer|cutting-edge)\b/gi,
    advice: 'Name the mechanism instead. "leverage X" → "use X to do Y".',
  },
  {
    id: 'en-not-only',
    group: '英文AI腔',
    severity: 1,
    re: /\bnot only\b[^.]{0,60}\bbut also\b|\bit'?s not just\b[^.]{0,60}\bit'?s\b/gi,
    advice: 'One clause. The second half rarely adds information.',
  },
]

/** 判定档位：阈值是每 300 字的加权密度。 */
const VERDICTS = [
  { max: 2, en: 'clean', zh: '干净' },
  { max: 4, en: 'mostly clean', zh: '基本干净' },
  { max: 9, en: 'some templating', zh: '有模板腔' },
  { max: Infinity, en: 'heavily templated', zh: '模板腔重' },
]

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 是否有文档特征：markdown 标题、中文编号标题，或编号章节。 */
function looksLikeDocument(text) {
  if (/^#{1,6}[ \t]+\S/m.test(text)) return true
  // 中文编号标题（一、二、）在纯文本报告里很常见，markdown 里一个 # 都没有。
  const chineseHeadings = (text.match(/^[一二三四五六七八九十百]+[、.．][ \t]*\S/gm) ?? []).length
  if (chineseHeadings >= 2 && text.length > 60) return true
  return /^\s*\d+[.、][ \t]*\S/m.test(text) && text.length > 400
}

/** 每行的起始下标，用于把字符下标换算成行列。 */
function buildLineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** 字符下标 → 行列（都是 1 基）。 */
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

/** 命中处前后各取一点，压成一行，方便在报告里读。 */
function excerptAt(text, index, length) {
  const from = Math.max(0, index - 18)
  const to = Math.min(text.length, index + length + 18)
  return text.slice(from, to).replace(/\s+/g, ' ').trim()
}

/** 变异系数：标准差 / 均值。用来量"均匀"。 */
function coefficientOfVariation(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

/**
 * 掩码字符。
 *
 * 不用普通空格：代码被替换成一长串空格后，会自己触发"连续空格"这类规则。
 * 用不换行空格（\u00A0）——它在 JS 里算空白（\s），但不会被字面量 ` {2,}` 匹配，
 * 也不会被 `[^\s]` 当成非空字符，正好隔开两侧。
 */
const MASK = '\u00A0'

/** 这个位置是不是已经被掩掉了。 */
function isMasked(char) {
  return char === MASK || char === ' ' || char === '\t'
}

/**
 * 把围栏代码块整块替换成等长掩码，保留换行。
 *
 * 目的有两个：代码不该按散文规则扫描（契约里写明代码例外），
 * 而用等长替换而不是删除，是为了让字符下标完全不变——行列号仍然对得上原文。
 *
 * @param {string} text - 原文
 * @returns {{ masked: string, codeChars: number }} 掩码文本与代码字符数
 */
function maskCodeFences(text) {
  const buf = text.split('')
  let inFence = false
  let codeChars = 0
  let cursor = 0

  while (cursor <= text.length) {
    const newline = text.indexOf('\n', cursor)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(cursor, end)
    const isFence = /^\s*(?:```|~~~)/.test(line)

    if (isFence || inFence) {
      for (let i = cursor; i < end; i += 1) {
        if (!isMasked(buf[i])) codeChars += 1
        buf[i] = MASK
      }
    }
    if (isFence) inFence = !inFence
    if (newline === -1) break
    cursor = newline + 1
  }

  // 双反引号包住的片段要先处理：markdown 里 `` `代码` `` 靠外层双反引号转义，
  // 只按单反引号匹配的话，内层正文会被漏掉。
  for (const match of text.matchAll(/``[\s\S]{0,180}?``/g)) {
    for (let i = match.index; i < match.index + match[0].length; i += 1) {
      if (!isMasked(buf[i])) codeChars += 1
      buf[i] = MASK
    }
  }

  // 行内代码：单个反引号包住的内容同样是代码，不该按散文规则扫。
  // 围栏行已经被上面掩成掩码，这里再掩一次不会重复计数。
  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    for (let i = match.index; i < match.index + match[0].length; i += 1) {
      if (!isMasked(buf[i])) codeChars += 1
      buf[i] = MASK
    }
  }

  return { masked: buf.join(''), codeChars }
}

/**
 * 结构审计：读得出"读起来别扭"，但正则抓不到的那几件事。
 *
 * 四项：标题层级跳跃、空节、单段过长、表格太小。
 * 这些在长文档里比词层面的 AI 腔更显眼，而且作者自己读不出来——必须靠计数。
 *
 * @param {string} text - 原文
 * @returns {{ findings: object[], headingCount: number }} 发现的问题与标题数
 */
export function auditStructure(text) {
  const findings = []
  const lines = text.split(/\r?\n/)

  const headings = []
  lines.forEach((line, idx) => {
    const markdown = /^(#{1,6})[ \t]+(\S.*)$/.exec(line)
    if (markdown) {
      headings.push({ level: markdown[1].length, title: markdown[2].trim(), line: idx + 1, index: idx })
      return
    }
    // 中文编号标题：一、二、按二级算，（）里的编号按三级算。纯文本报告全靠这个撑结构。
    const numbered = /^[一二三四五六七八九十百]+[、.．][ \t]*(\S.*)$/.exec(line)
    if (numbered) {
      headings.push({ level: 2, title: numbered[1].trim(), line: idx + 1, index: idx })
      return
    }
    const nested = /^[（(][一二三四五六七八九十百]+[）)][ \t]*(\S.*)$/.exec(line)
    if (nested) {
      headings.push({ level: 3, title: nested[1].trim(), line: idx + 1, index: idx })
    }
  })

  // 层级跳跃：H2 直接到 H4
  for (let i = 1; i < headings.length; i += 1) {
    const prev = headings[i - 1]
    const cur = headings[i]
    if (cur.level > prev.level + 1) {
      findings.push({
        kind: 'heading-jump',
        line: cur.line,
        detail: `H${prev.level} 直接跳到 H${cur.level}：「${cur.title}」中间少了一级`,
      })
    }
  }

  // 空节：标题下面没有正文。容器节不算——下一级标题比它深，说明正文在子节里。
  for (let i = 0; i < headings.length; i += 1) {
    if (i + 1 < headings.length && headings[i + 1].level > headings[i].level) continue
    const start = headings[i].index + 1
    const end = i + 1 < headings.length ? headings[i + 1].index : lines.length
    const body = lines.slice(start, end).filter(line => line.trim() !== '' && !/^\s*(?:```|~~~)/.test(line))
    if (body.length === 0) {
      findings.push({ kind: 'empty-section', line: headings[i].line, detail: `「${headings[i].title}」下面没有正文` })
    }
  }

  // 单段过长：连续非空行算一段。列表项、表格行各自成立，不并进段落长度。
  let buffer = []
  let bufferStart = 1
  const flushParagraph = () => {
    if (buffer.length > 0) {
      const chars = buffer.join('').replace(/\s/g, '').length
      if (chars > 400) {
        findings.push({
          kind: 'long-paragraph',
          line: bufferStart,
          detail: `第 ${bufferStart} 行起这一段 ${chars} 字，读者找不到落点。拆成两段，或切出短句。`,
        })
      }
    }
    buffer = []
  }
  lines.forEach((line, idx) => {
    const breaksParagraph =
      line.trim() === '' ||
      /^#{1,6}[ \t]+/.test(line) ||
      /^\s*(?:[-*+]|\d+[.)、])\s+/.test(line) ||
      /^\s*\|/.test(line)
    if (breaksParagraph) {
      flushParagraph()
      return
    }
    if (buffer.length === 0) bufferStart = idx + 1
    buffer.push(line)
  })
  flushParagraph()

  // 小表格：连续以 | 开头的行，去掉表头与分隔线后数据行不足 2
  let tableRows = 0
  let tableStart = 1
  const flushTable = () => {
    if (tableRows > 0 && tableRows <= 3) {
      findings.push({
        kind: 'small-table',
        line: tableStart,
        detail: `第 ${tableStart} 行的表格只有 ${Math.max(tableRows - 2, 0)} 行数据。少于 2 行改成句子。`,
      })
    }
    tableRows = 0
  }
  lines.forEach((line, idx) => {
    if (/^\s*\|/.test(line)) {
      if (tableRows === 0) tableStart = idx + 1
      tableRows += 1
    } else {
      flushTable()
    }
  })
  flushTable()

  return { findings: findings.slice(0, 12), headingCount: headings.length }
}

/**
 * 有效长度，单位叫"字"但不等于字符数。
 *
 * 汉字按 1 计；连续的拉丁字母/数字算一个词，一个词折 2。
 * 原因是字符数不可跨语种比较：一句英文 80 个字符，信息量大约等于 35 个汉字。
 * 不做折算的话，纯英文段落必定被判定为"句长偏长"，中英混排的密度也会系统性偏低。
 *
 * @param {string} text - 文本
 * @returns {number} 折算后的长度
 */
function measureUnits(text) {
  let units = 0
  for (const char of text) {
    if (char >= '\u4e00' && char <= '\u9fa5') units += 1
  }
  // 版本号 v2.3.1、小数 2024.10 要算一个词，不能按点拆成三个。
  const latinRuns = text.match(/[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/g)
  if (latinRuns) units += latinRuns.length * 2
  return units
}

/** 统计指标。 */
function computeStats(text, codeChars = 0) {
  const chars = text.replace(/\s/g, '').length
  const units = measureUnits(text)

  // 句末标点切句。
  // - 英文的 `.` 后面必须跟空白才算句末，否则会把 0.10.3 这种版本号切开。
  // - 单个字母加点的缩写（e.g. / i.e. / U.S.）不算句末：点在词中间时前面不是词边界。
  const sentences = text
    .split(/[。！？]+|[!?]+(?=\s)|\n{2,}|(?<!\b[A-Za-z]\.)(?<=[.!?])\s+/)
    .map(s => s.replace(/\s/g, ''))
    .filter(s => s.length > 0)
  const sentenceUnits = sentences.map(measureUnits)
  const avgSentenceUnits = sentenceUnits.length
    ? sentenceUnits.reduce((a, b) => a + b, 0) / sentenceUnits.length
    : 0

  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s/g, ''))
    .filter(p => p.length > 0)
  const paraUnits = paragraphs.map(measureUnits)

  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  const listLines = lines.filter(line => /^\s*(?:[-*+]|\d+[.)、])\s+\S/.test(line)).length
  const headingLines = lines.filter(line => /^#{1,6}[ \t]+\S/.test(line)).length

  let boldChars = 0
  for (const match of text.matchAll(/(\*\*|__)([^*_]+?)\1/g)) boldChars += match[2].length

  const emDashCount = (text.match(/——/g) ?? []).length

  // 数字密度：没有数字的说明文，通常是判断多于事实。
  const numberCount = (text.match(/\d+(?:[.,]\d+)*/g) ?? []).length

  return {
    chars,
    units,
    sentences: sentences.length,
    avgSentenceUnits: Math.round(avgSentenceUnits * 10) / 10,
    sentenceCV: Math.round(coefficientOfVariation(sentenceUnits) * 100) / 100,
    paragraphs: paragraphs.length,
    paraCV: Math.round(coefficientOfVariation(paraUnits) * 100) / 100,
    lines: lines.length,
    emDashPerK: chars > 0 ? Math.round((emDashCount / chars) * 1000 * 10) / 10 : 0,
    boldRatio: chars > 0 ? Math.round((boldChars / chars) * 1000) / 10 : 0,
    listRatio: lines.length > 0 ? Math.round((listLines / lines.length) * 1000) / 10 : 0,
    headingRatio: lines.length > 0 ? Math.round((headingLines / lines.length) * 1000) / 10 : 0,
    numberCount,
    numberDensity: units > 0 ? Math.round((numberCount / units) * 1000 * 10) / 10 : 0,
    codeRatio: chars + codeChars > 0 ? Math.round((codeChars / (chars + codeChars)) * 1000) / 10 : 0,
  }
}

/** 结构层提示：正则抓不到，但读起来最像 AI 的那几件事。 */
function structuralNotes(stats, mode) {
  const notes = []
  if (stats.sentences >= 8 && stats.sentenceCV < 0.28) {
    notes.push(`句长过于均匀（变异系数 ${stats.sentenceCV}）。人写东西会有长句夹短句，这里每句都差不多长。`)
  }
  if (stats.paragraphs >= 4 && stats.paraCV < 0.25) {
    notes.push(`各段长度过于均匀（变异系数 ${stats.paraCV}）。重要处长、次要处短，才对得上内容。`)
  }
  if (stats.avgSentenceUnits > 45) {
    notes.push(`平均句长折合 ${stats.avgSentenceUnits}（汉字算 1、英文词算 2），偏长。至少每三句切出一个短句。`)
  }
  if (stats.boldRatio > 4) {
    notes.push(`加粗占正文 ${stats.boldRatio}%，偏多。每段都有加粗，等于没有重点。`)
  }
  if (stats.listRatio > 35) {
    notes.push(`列表行占 ${stats.listRatio}%，列表化过度。三件以内用句子连起来。`)
  }
  if (mode === 'doc' && stats.headingRatio > 25) {
    notes.push(`标题行占 ${stats.headingRatio}%，标题过密。层级多到读者读标题就够了，说明正文没信息。`)
  }
  if (stats.emDashPerK > 3) {
    notes.push(`破折号密度 ${stats.emDashPerK}/千字，偏高。一句话里两个"——"通常是硬凑转折。`)
  }
  if (stats.chars > 400 && stats.numberDensity < 2) {
    notes.push(
      `全文只有 ${stats.numberCount} 处数字（每千字 ${stats.numberDensity}），偏低：判断多于事实。` +
        `能换成数字、版本号、命令、路径的地方换掉。`,
    )
  }
  return notes.slice(0, 7)
}

/**
 * 把配置里的自定义规则编译成内部规则。
 *
 * 正则编译失败不能把整次扫描带崩——跳过这一条，记下来，继续扫。
 *
 * @param {unknown} customRules - 配置传入的规则数组
 * @returns {{ rules: object[], invalid: string[] }} 可用规则与错误说明
 */
function compileCustomRules(customRules) {
  const rules = []
  const invalid = []
  if (!Array.isArray(customRules)) return { rules, invalid }

  customRules.forEach((raw, index) => {
    if (!raw || typeof raw.pattern !== 'string' || raw.pattern === '') {
      invalid.push(`第 ${index + 1} 条缺 pattern`)
      return
    }
    try {
      rules.push({
        id: String(raw.id ?? `custom-${index + 1}`),
        group: String(raw.group ?? '自定义'),
        severity: [1, 2, 3].includes(raw.severity) ? raw.severity : 2,
        re: new RegExp(raw.pattern, 'g'),
        advice: String(raw.advice ?? '命中自定义规则。'),
      })
    } catch (error) {
      invalid.push(`第 ${index + 1} 条正则无效：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return { rules, invalid }
}

/**
 * 扫描一段文本。
 *
 * @param {string} text - 待扫描文本
 * @param {object} [options]
 * @param {'auto'|'chat'|'doc'} [options.mode] - 扫描模式，auto 按标题特征判断
 * @param {number} [options.limit] - 最多返回多少条命中，1-200，默认 40
 * @returns {object} 报告对象
 */
export function analyze(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: '文本为空，没有可扫描的内容。' }
  }

  // 去 BOM：带 BOM 的文件里，第一行的标题会被 \uFEFF 顶掉，检测不到。
  const source = text.replace(/^\uFEFF/, '')

  try {
    const requested = options.mode ?? 'auto'
    const mode = !['auto', 'chat', 'doc'].includes(requested)
      ? (looksLikeDocument(source) ? 'doc' : 'chat')
      : requested === 'auto'
        ? (looksLikeDocument(source) ? 'doc' : 'chat')
        : requested
    const limit = clamp(options.limit ?? 40, 1, 200)

    // 代码块先掩成等长掩码：代码不受散文规则约束，但下标不能动，行列号才对得上。
    const { masked, codeChars } = maskCodeFences(source)

    const starts = buildLineStarts(source)
    const hits = []
    const custom = compileCustomRules(options.customRules)
    const allRules = custom.rules.length > 0 ? [...RULES, ...custom.rules] : RULES

    for (const rule of allRules) {
      if (rule.modes && !rule.modes.includes(mode)) continue
      const re = new RegExp(rule.re.source, rule.re.flags)
      let match = re.exec(masked)
      let perRule = 0
      while (match !== null && perRule < 25) {
        const matched = match[0]
        if (matched.length > 0) {
          const { line, col } = locate(starts, match.index)
          hits.push({
            rule: rule.id,
            group: rule.group,
            severity: rule.severity,
            line,
            col,
            index: match.index,
            match: matched.length > 60 ? `${matched.slice(0, 60)}…` : matched,
            excerpt: excerptAt(masked, match.index, matched.length),
            advice: rule.advice,
          })
          perRule += 1
        }
        // 零宽匹配保护
        if (re.lastIndex === match.index) re.lastIndex += 1
        match = re.exec(masked)
      }
    }

    hits.sort((a, b) => a.index - b.index)
    const stats = computeStats(masked, codeChars)
    const weighted = hits.reduce((sum, hit) => sum + (WEIGHT[hit.severity] ?? 1), 0)
    const score = stats.units > 0 ? Math.round((weighted / stats.units) * 300 * 10) / 10 : 0
    // 命中不足 3 处时把判定压到「基本干净」为止。
    // 密度是"每 300 单位"的强度，短文本里一个词就能跨过阈值；单个命中不足以给整段定性。
    const tierIndex = VERDICTS.findIndex(v => score < v.max)
    const safeIndex = tierIndex < 0 ? VERDICTS.length - 1 : tierIndex
    const tier = VERDICTS[hits.length < 3 ? Math.min(safeIndex, 1) : safeIndex]

    const groups = {}
    for (const hit of hits) groups[hit.group] = (groups[hit.group] ?? 0) + 1

    const truncated = hits.length > limit
    const kept = truncated ? hits.slice(0, limit) : hits

    return {
      ok: true,
      mode,
      verdict: tier.en,
      verdictZh: tier.zh,
      score,
      chars: stats.chars,
      hitCount: hits.length,
      truncated,
      groups,
      hits: kept.map(({ index: _index, rule: _rule, ...rest }) => rest),
      stats,
      notes: structuralNotes(stats, mode),
      typography: auditTypography(masked),
      ...(custom.invalid.length > 0 ? { invalidRules: custom.invalid } : {}),
    }
  } catch (error) {
    return { ok: false, error: `扫描失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
