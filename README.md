# dsh-prose-forge（文风锻造）

让 DeepSeek Harness 说人话，并且会写文件。

一个插件，三面挂载：

1. **常驻文风契约** — 每轮进系统提示词（order 100），十几条判决性短句，管结论先行、删元话语、具体压抽象、句长交替。写文件时第十一到十三条自动生效：结构服从内容、标题写名词、交付说清假设。
2. **两个工具** — `prose_check` 一个工具两个入口（`text` 扫文本、`path` 扫文件且全文不进上下文），`prose_rules` 按需取回规则全文。
3. **两个技能** — `prose-forge-write`（写作流程六步）、`prose-forge-doc`（文件交付规范）。

## 为什么这么切

文风约束只有**每轮生效**才有意义。按需触发的 skill 要用户先说"帮我润色"，规则才想起来——那时候稿子已经写完，AI 腔已经落地。所以契约常驻，长清单后置。

代价是明确的，也随时可量（`node measure.mjs`）：契约 988 字 + 工具描述与 schema 621 字 + 技能目录 270 字 = **每轮固定 1879 字**。

刚做完一轮减法。量之前我以为该砍契约，结果工具占了 1391 字，比契约还多——两个入口各自带着一份完整描述和 schema。合并成 `text | path` 一个工具后降到 621，固定开销从 2775 掉到 1879，减 32%，功能一条没少。

真正抓"AI 味"的不是词表，是结构。每段一样长、每句一样长、每节都有小结——这些用词表抓不到。所以扫描器除了正则，还算四个指标：句长变异系数、段落长度变异系数、加粗占比、列表行占比。判定为"有模板腔"时，先看结构问题，再看命中明细。

## 安装

从 GitHub 装：

```sh
dsh plugin --profile <你的 profile> add github:<你的 GitHub 名>/dsh-prose-forge
```

本地开发用 link，改完重启即生效：

```sh
dsh plugin --profile <你的 profile> add "link:/path/to/dsh-prose-forge"
```

装完重启 DSH。注意时序差别：**装插件**时宿主会重组 profile 配置并自动挂载，新开一轮就能看到工具和技能；但**改已挂载插件的代码不会热加载**，改完必须重启，或者到插件页把开关关一次再开。

> 两个环境坑，跟插件本身无关：
>
> - `ERR_PNPM_UNEXPECTED_STORE`——profile 的 node_modules 若来自非默认 store，要带 `--store-dir=<那个 store 的路径>`。
> - Windows 下 CLI 传参会把中文路径转成乱码，插件目录放在纯 ASCII 路径下。

## 配置

`cordis.patch.yml` 里可传：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉整段注入、工具和技能 |
| `order` | `100` | 提示词段排序，默认在 persona 之后 |
| `registerTools` | `true` | 只留提示词，不注册工具 |
| `registerSkills` | `true` | 不注册两个 skill |
| `extraBanned` | `[]` | 追加到契约末尾的禁用表达 |

## 工具

### `prose_check`

一个工具，两种输入：

| 参数 | 行为 |
| --- | --- |
| `text` | 直接扫传入的文本 |
| `path` | 读盘扫文件，**全文不进上下文**，长文档只回报告 |

两者都给时以 `path` 为准；都不给直接报错。

`mode`：`auto`（按有无 markdown 标题判断）/ `chat` / `doc`。`doc` 额外查标题八股和空转表述。`limit`：最多返回多少条命中，默认 40。

判定四档：`干净` < `基本干净` < `有模板腔` < `模板腔重`。密度算法是加权严重度 ÷ 字数 × 300。

给 `path` 时再加四项结构审计：

| 审计项 | 抓什么 |
| --- | --- |
| `heading-jump` | H2 直接跳到 H4 |
| `empty-section` | 标题下面没正文 |
| `long-paragraph` | 单段超过 400 字 |
| `small-table` | 表格数据行不足 2 行 |

围栏代码块先掩成等长空格再扫，所以代码里的注释不会被当成散文命中，行列号也不会偏移。

这几项靠眼睛读不出来——20 个段落哪几段一样长、标题跳没跳级，必须靠计数。作者自己审自己的稿子，恰恰最容易漏这一层。

### `prose_rules`

`part` 取 `direct`（十条详解带改写示例）、`doc`（文件写作规范）、`slop`（AI 腔清单）、`workflow`（流程）、`checkpoints`（改稿 24 个检查点）、`all`。

## 自测

```powershell
node selftest.mjs    # 扫描器：脏/净中文、英文、文档模式、代码掩码，16 项断言
node harness.mjs     # 假宿主：61 项断言，验证三面挂载形状与端到端调用
node measure.mjs     # 每轮固定开销与字面重合度，改完代码用它对账
```

`harness.mjs` 挡住的是"注册形状写错"这类错误——它们在真宿主里是静默的：工具不出现、插件不报错。

`measure.mjs` 还顺手证伪了一个直觉：`direct` 那 1004 字看着像常驻契约的重述，实测字面重合 0 行，而且它按需加载、不占每轮成本，所以不该删。

## 目录

```
index.js          三面挂载入口：契约段 + 两个工具 + skill provider
prompt.js         常驻契约（按字付费，改这里等于改每次回复）
rules.js          五份规则全文，硬编码不读 md
analyze.js        扫描器：16 组正则、结构指标、结构审计、代码掩码
selftest.mjs      扫描器自测
harness.mjs       假宿主自测
measure.mjs       每轮成本测量
skills/
  prose-forge-write/SKILL.md
  prose-forge-doc/SKILL.md
locale/{zh,en}.json
cordis.patch.yml
```

零运行时依赖。刻意不 import `@deepseek-ai/dsh-tools`：link 安装的包没有自己的 node_modules，裸导入宿主包会抛 `ERR_MODULE_NOT_FOUND`，而且失败是静默的。

## 来源与致谢

规则文本是自行撰写的，机制和形状参照了这些项目：

- [pseudonymzjt/dsh-direct-human-style](https://github.com/pseudonymzjt/dsh-direct-human-style) — 常驻注入机制、工具构造形状、判定密度算法
- [why3316-g/why-gzh-writer](https://github.com/why3316-g/why-gzh-writer) — skill provider 形状、交稿前自检的思路
- [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) — 检查点分组思路
- [Liam0205/skills](https://github.com/Liam0205/skills) — 写作流程结构（立意先行、分节交付、返工止损）
- [anthropics/skills](https://github.com/anthropics/skills) — 文档产出的分工思路（格式交给 office 系列，不自己拼 OOXML）

前两个项目的代码派生范围与许可全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可

MIT。见 [LICENSE](LICENSE)。
