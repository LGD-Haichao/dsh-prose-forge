/**
 * audit.mjs — 规则覆盖与文档一致性检查。
 *
 * 三件事：
 *   1. 每条检查都有样本能触发（防止规则写了但永远不生效）
 *   2. 每条检查都能单独跳过（防止 skip 只对一部分生效）
 *   3. README 里列的检查项和代码里的 TYPO_KINDS 完全一致（防止文档漂移）
 *
 *   node audit.mjs
 */

import { readFile } from 'node:fs/promises'
import { TYPO_KINDS, auditTypography } from './typography.js'

/** 每种检查一份能触发的样本。新增规则必须在这里补一行。 */
const SAMPLES = {
  'halfwidth-punct': '第一,第二。',
  'halfwidth-punct-mixed': '用 Redis,然后处理。',
  'halfwidth-period': '好.然后继续。',
  ellipsis: '等一下...就好。',
  'dash-double-hyphen': '段落一 -- 段落二。',
  'dash-single': '段落一—段落二。',
  'ascii-quote-cn': '他说"走吧"。',
  'repeat-punct': '太好了。。。',
  'punct-line-start': '上一句。\n，下一句。',
  'space-before-punct': '测试 ，然后继续。',
  'fullwidth-space': '这里有\u3000全角空格。',
  'double-space': '这里有两个  空格。',
  'trailing-space': '行尾有空格   \n下一行。',
  'en-punct-cjk': 'restart the service。',
  'halfwidth-paren-cn': '(见 README)。',
  'cjk-latin-space': '放在 Redis 里。',
  'unbalanced-mark': '他说「走吧。',
  'fullwidth-alnum': '２０２４年的数据。',
  'invisible-char': '放在\u200BRedis里。',
  'cjk-space': '文件 在 目录里。',
}

let failed = 0
const check = (label, pass, detail = '') => {
  if (!pass) failed += 1
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`)
}

console.log('=== 每条检查都能被触发 ===')
for (const kind of TYPO_KINDS) {
  const sample = SAMPLES[kind]
  if (sample === undefined) {
    check(`${kind} 有样本`, false, 'SAMPLES 里缺一条')
    continue
  }
  const report = auditTypography(sample)
  check(`${kind} 能被触发`, (report.counts[kind] ?? 0) > 0, JSON.stringify(report.counts))
}

console.log('\n=== 每条检查都能单独跳过 ===')
for (const kind of TYPO_KINDS) {
  const sample = SAMPLES[kind] ?? ''
  const report = auditTypography(sample, { skip: [kind] })
  check(`${kind} 可跳过`, (report.counts[kind] ?? 0) === 0, JSON.stringify(report.counts))
}

console.log('\n=== README 与代码一致 ===')
const readme = await readFile('README.md', 'utf8')
const marker = '可关的检查项：'
const start = readme.indexOf(marker)
if (start < 0) {
  check('README 有「可关的检查项」清单', false, '找不到这一节')
} else {
  const paragraph = readme.slice(start).split('\n\n')[0]
  const listed = new Set([...paragraph.matchAll(/`([a-z][a-z0-9-]+)`/g)].map(m => m[1]))
  const known = new Set(TYPO_KINDS)

  const missingInReadme = [...known].filter(kind => !listed.has(kind))
  const extraInReadme = [...listed].filter(name => !known.has(name))
  check('README 列全了检查项', missingInReadme.length === 0, missingInReadme.join(', '))
  check('README 没有多写检查项', extraInReadme.length === 0, extraInReadme.join(', '))
  check('README 清单条数一致', listed.size === known.size, `README ${listed.size} / 代码 ${known.size}`)
}

console.log(`\n检查项 ${TYPO_KINDS.length} 个，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
