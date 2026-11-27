/**
 * dsh-prose-forge — 文风锻造。
 *
 * 三面挂载：
 *   1. 常驻系统提示词段（order 100）：每轮生效的文风契约，写文件时自动加上文件条款
 *   2. 两个 agent 工具：prose_check（扫文本或文件，给 path 时全文不进上下文）、
 *      prose_rules（按需取规则全文）
 *   3. 一个 skill provider：prose-forge-write（写作流程）、prose-forge-doc（文件交付）
 *
 * 依赖说明：工具对象在本文件里手工构造，不 import `@deepseek-ai/dsh-tools`。
 * 以 link 方式安装的包没有自己的 node_modules，裸导入宿主包会抛 ERR_MODULE_NOT_FOUND，
 * 而且是静默失败——工具不注册、插件不报错。makeTool 只做两件事：把参数规格整理成
 * JSON Schema、给 execute 包一层参数校验，两件都在下面自己做。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STYLE_PROMPT, STYLE_SECTION_NAME, STYLE_SECTION_ORDER } from './prompt.js'
import { analyze, auditStructure } from './analyze.js'
import { PARTS, lookup } from './rules.js'

/** Cordis 插件名，稳定标识。 */
export const name = 'prose-forge'

/** 挂载前需要的宿主服务。 */
export const inject = ['tools', 'systemPrompt', 'skills']

const DEFAULTS = {
  enabled: true,
  order: STYLE_SECTION_ORDER,
  registerTools: true,
  registerSkills: true,
  extraBanned: [],
}

const SKILLS_DIR = fileURLToPath(new URL('./skills/', import.meta.url))
const PROVIDER_NAME = 'prose-forge'
/** 数值越小越优先；用户放在 ~/.agents/skills 的同名 skill 会覆盖插件自带版本。 */
const BUNDLED_SKILL_RANK = 600
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ---------------------------------------------------------------- 提示词

/** 拼出注入文本：固定契约 + 用户追加的禁用表达。 */
function buildPrompt(config) {
  const extra = Array.isArray(config.extraBanned) ? config.extraBanned.filter(Boolean) : []
  if (extra.length === 0) return STYLE_PROMPT
  return `${STYLE_PROMPT}\n\n**用户追加的禁用表达**：${extra.join(' / ')}`
}

// ---------------------------------------------------------------- 工具

/** 一个文本内容块。 */
function text(value) {
  return [{ type: 'text', text: value }]
}

/**
 * 构造 ctx.tools.register 需要的形状。
 *
 * @param {object} options
 * @param {string} options.name - 模型看到的工具名
 * @param {string} options.description - 干什么、什么时候用
 * @param {object} options.parameters - 参数的 JSON Schema
 * @param {(args: object, value: unknown) => object[]} options.render - 渲染内容块
 * @param {number} [options.timeoutMs] - 单次调用预算
 * @param {(args: object) => unknown} options.execute - 实际工作
 * @returns {object} 工具定义
 */
function makeTool(options) {
  const { parameters, execute, render, timeoutMs } = options
  const required = Array.isArray(parameters.required) ? parameters.required : []

  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { schema: {}, render },
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
    async execute(args) {
      const value = args ?? {}
      const violations = []
      for (const key of required) {
        if (value[key] === undefined) violations.push(`${key} is required`)
      }
      for (const [key, schema] of Object.entries(parameters.properties ?? {})) {
        const given = value[key]
        if (given === undefined) continue
        if (schema.type === 'string' && typeof given !== 'string') violations.push(`${key} must be a string`)
        if (schema.type === 'integer' && !Number.isInteger(given)) violations.push(`${key} must be an integer`)
        if (schema.type === 'array' && !Array.isArray(given)) violations.push(`${key} must be an array`)
        if (Array.isArray(schema.enum) && !schema.enum.includes(given)) {
          violations.push(`${key} must be one of ${schema.enum.join(', ')}`)
        }
      }
      if (violations.length > 0) {
        return { ok: false, error: `invalid arguments: ${violations.join('; ')}` }
      }
      return execute(value)
    },
  }
}

/** 把扫描结果渲染成可读报告。 */
function renderScan(_args, value) {
  if (!value || value.ok === false) return text(value?.error ?? '扫描失败。')

  const s = value.stats
  const groupText = Object.entries(value.groups)
    .sort((a, b) => b[1] - a[1])
    .map(([group, count]) => `${group} ${count}`)
    .join(' · ')

  const lines = []
  if (value.path) lines.push(`文件：${value.path}（${value.bytes} 字节）`)

  lines.push(
    `判定：${value.verdictZh}（${value.verdict}，密度 ${value.score}）· ${value.chars} 字 · ` +
      `${s.sentences} 句 · 平均句长 ${s.avgSentenceChars} 字 · 模式 ${value.mode}`,
    `命中 ${value.hitCount} 处${value.truncated ? '（已截断）' : ''}：${groupText || '无'}`,
    `结构指标：句长变异 ${s.sentenceCV} · 段落变异 ${s.paraCV} · 破折号 ${s.emDashPerK}/千字 · ` +
      `加粗 ${s.boldRatio}% · 列表 ${s.listRatio}% · 标题 ${s.headingRatio}% · ` +
      `数字 ${s.numberDensity}/千字 · 代码 ${s.codeRatio}%`,
  )

  if (value.audit && value.audit.findings.length > 0) {
    lines.push('', `结构审计（${value.audit.headingCount} 个标题）：`)
    for (const finding of value.audit.findings) lines.push(`- L${finding.line} [${finding.kind}] ${finding.detail}`)
  }

  if (value.notes.length > 0) {
    lines.push('', '结构问题：')
    for (const note of value.notes) lines.push(`- ${note}`)
  }

  if (value.hits.length > 0) {
    lines.push('', '命中明细：')
    for (const hit of value.hits) {
      lines.push(`- L${hit.line}:${hit.col} [${hit.group}/${hit.severity}] ${hit.match}`)
      lines.push(`  上下文：${hit.excerpt}`)
      lines.push(`  改法：${hit.advice}`)
    }
  }

  lines.push('', '命中不等于要改：先看这句有没有独立信息、是不是在讲具体的事。学术引用、法条、代码注释不受这套规则约束。')
  return text(lines.join('\n'))
}

/** 渲染规则查询结果。 */
function renderRules(_args, value) {
  if (!value || value.ok === false) return text(value?.error ?? '未找到对应部分。')
  return text(value.markdown)
}

/** 扫描工具：给 text 扫文本，给 path 扫文件（全文不进上下文）。 */
function scanTool() {
  return makeTool({
    name: 'prose_check',
    description:
      '扫描 AI 腔并自检文风。给 path 直接读盘扫文件，全文不进上下文；给 text 扫传入的文本。' +
      '返回命中明细与结构指标；mode=doc 加做结构审计：标题层级跳跃、空节、超长段、小表格。' +
      '只报线索不改写，命中不等于要改。Triggers: 去掉AI味, 检查文风, AI腔, 审稿, 检查这个文件, 交付前自检.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要扫描的文本' },
        path: { type: 'string', description: '要扫描的文件路径，与 text 二选一' },
        mode: { type: 'string', enum: ['auto', 'chat', 'doc'] },
        limit: { type: 'integer' },
      },
    },
    render: renderScan,
    timeoutMs: 30_000,
    async execute(args) {
      const mode = args.mode ?? 'auto'
      const limit = args.limit ?? 40
      const filePath = args.path ? resolve(String(args.path)) : ''

      if (!filePath && typeof args.text !== 'string') {
        return { ok: false, error: '要么给 text（文本），要么给 path（文件路径）。' }
      }
      if (!filePath) {
        return analyze(args.text, { mode, limit })
      }

      let info
      try {
        info = await stat(filePath)
      } catch {
        return { ok: false, error: `读不到文件：${filePath}` }
      }
      if (!info.isFile()) return { ok: false, error: `不是普通文件：${filePath}` }
      if (info.size > 1_500_000) return { ok: false, error: `文件太大（${info.size} 字节），上限 1.5MB` }

      let raw
      try {
        raw = await readFile(filePath, 'utf8')
      } catch (error) {
        return { ok: false, error: `读取失败：${error instanceof Error ? error.message : String(error)}` }
      }
      if (raw.includes('\u0000')) return { ok: false, error: `看起来是二进制文件，跳过：${filePath}` }

      const report = analyze(raw, { mode, limit })
      if (report.ok === false) return report

      return { ...report, path: filePath, bytes: info.size, audit: auditStructure(raw) }
    },
  })
}

/** 规则查询工具。 */
function rulesTool() {
  return makeTool({
    name: 'prose_rules',
    description:
      '取回细则全文：direct 直白十条与改写示例、doc 文件写作规范、slop AI 腔清单、' +
      'workflow 写作流程、checkpoints 改稿检查点。不给 part 就返回全部。' +
      'Triggers: 文风规则, 怎么改写, 去AI味清单.',
    parameters: {
      type: 'object',
      properties: {
        part: { type: 'string', enum: PARTS },
      },
    },
    render: renderRules,
    timeoutMs: 15_000,
    async execute(args) {
      const part = args.part ?? 'all'
      const markdown = lookup(part)
      if (markdown === null) {
        return { ok: false, error: `未知的 part：${part}。可用：${PARTS.join(' / ')}` }
      }
      return { ok: true, part, chars: markdown.length, markdown }
    },
  })
}

/** 本插件贡献的全部工具。 */
export function proseTools() {
  return [scanTool(), rulesTool()]
}

// ---------------------------------------------------------------- 技能

/**
 * 解析 SKILL.md 顶部只含单行 `key: value` 的 frontmatter。
 *
 * @param {string} source - SKILL.md 全文
 * @returns {{ data: Record<string, string | boolean>, body: string } | undefined} 无 frontmatter 时返回 undefined
 */
export function parseSkill(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.replace(/^﻿/, ''))
  if (!match) return undefined
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    data[kv[1]] = value === 'true' ? true : value === 'false' ? false : value
  }
  return { data, body: match[2].trim() }
}

function invocationOf(data) {
  return {
    modelInvocable: data['disable-model-invocation'] !== true,
    userInvocable: data['user-invocable'] !== false,
  }
}

async function readSkill(dirName) {
  const dir = join(SKILLS_DIR, dirName)
  const parsed = parseSkill(await readFile(join(dir, 'SKILL.md'), 'utf8'))
  if (!parsed) return undefined
  const { name: skillName, description } = parsed.data
  if (typeof skillName !== 'string' || !SKILL_NAME_RE.test(skillName) || skillName !== dirName) return undefined
  if (typeof description !== 'string' || description === '') return undefined
  return {
    path: join(dir, 'SKILL.md'),
    name: skillName,
    description,
    invocation: invocationOf(parsed.data),
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dir },
    content: parsed.body,
  }
}

/** skill provider：list 只读目录和 frontmatter，get 每次重读正文。 */
export const provider = {
  name: PROVIDER_NAME,
  async list() {
    let entries = []
    try {
      entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    } catch {
      return []
    }
    const candidates = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skill = await readSkill(entry.name).catch(() => undefined)
      if (!skill) continue
      const { content: _content, ...summary } = skill
      candidates.push({ ...summary, rank: BUNDLED_SKILL_RANK, locator: entry.name })
    }
    return candidates
  },
  async get(candidate) {
    return readSkill(String(candidate?.locator)).catch(() => undefined)
  },
}

// ---------------------------------------------------------------- 挂载

const TOOL_LABEL = 'dsh-prose-forge: scanning tools'
const SKILL_LABEL = 'dsh-prose-forge: bundled skills'
const PROMPT_LABEL = 'dsh-prose-forge: style section'

/** 挂载三面。任何一面失败都不影响其余两面。 */
export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config ?? {}) }
  if (settings.enabled === false) return

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: STYLE_SECTION_NAME,
        order: Number.isFinite(settings.order) ? settings.order : STYLE_SECTION_ORDER,
        text: buildPrompt(settings),
      }),
    PROMPT_LABEL,
  )

  if (settings.registerTools !== false) {
    ctx.effect(() => {
      const disposers = proseTools().map(tool => ctx.tools.register(tool))
      return () => {
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose()
        }
      }
    }, TOOL_LABEL)
  }

  if (settings.registerSkills !== false) {
    ctx.effect(() => {
      ctx.skills.registerProvider(() => provider)
      return () => {}
    }, SKILL_LABEL)
  }
}
