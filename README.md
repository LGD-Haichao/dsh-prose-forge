# dsh-prose-forge（文风锻造）

让 DeepSeek Harness 说人话，并且会写文件。

一个插件，三面挂载：

1. **常驻文风契约** — 每轮进系统提示词（order 100），十几条判决性短句，管结论先行、删元话语、具体压抽象、句长交替。写文件时第十一到十三条自动生效：结构服从内容、标题写名词、交付说清假设。
2. **两个工具** — `prose_check` 一个工具两个入口（`text` 扫文本、`path` 扫文件且全文不进上下文），一次返回文风命中、结构审计、中文排版体检；`prose_rules` 按需取回规则全文。
3. **两个技能** — `prose-forge-write`（写作流程六步）、`prose-forge-doc`（文件交付规范）。

## 为什么这么切

文风约束只有**每轮生效**才有意义。按需触发的 skill 要用户先说“帮我润色”，规则才想起来——那时候稿子已经写完，AI 腔已经落地。所以契约常驻，长清单后置。

代价是明确的，也随时可量（`node measure.mjs`）：契约 988 字 + 工具描述与 schema 656 字 + 技能目录 270 字 = **每轮固定 1914 字**。

做过一轮减法。量之前我以为该砍契约，结果工具占了 1391 字，比契约还多——两个入口各自带着完整描述和 schema。合并成 `text | path` 一个工具后降到 621；这一轮加排版体检和示例库，又回到 656。功能多了两样，每轮成本基本没动。

真正抓“AI 味”的不是词表，是结构。每段一样长、每句一样长、每节都有小结——这些用词表抓不到。所以扫描器除了正则，还算四个指标：句长变异系数、段落长度变异系数、加粗占比、列表行占比。判定为“有模板腔”时，先看结构问题，再看命中明细。

句长和密度都按**折算单位**算：汉字算 1，连续的英文词算 2。按字符数算的话，一句英文 80 个字符必然被判“偏长”，中英混排的密度也会系统性偏低——同一个毛病，中英文各挨一半。

## 安装

从 GitHub 装：

```sh
dsh plugin --profile <你的 profile> add github:LGD-Haichao/dsh-prose-forge
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
| `customRules` | `[]` | 追加扫描规则，正则字符串，见下 |

`customRules` 给团队加家规，不用改代码：

```yaml
- insert:
    - id: prose-forge
      name: dsh-prose-forge
      config:
        customRules:
          - pattern: '本公司|集团'
            group: 品牌用语
            severity: 2
            advice: 对外文案统一用"我们"。
```

正则写错不会把整次扫描带崩，那一条会被跳过并列在报告的「自定义规则有错误」里。

## 工具

### `prose_check`

一个工具，两种输入：

| 参数 | 行为 |
| --- | --- |
| `text` | 直接扫传入的文本 |
| `path` | 读盘扫文件，**全文不进上下文**，长文档只回报告 |

两者都给时以 `path` 为准；都不给直接报错。

编码按 BOM 判断：UTF-8、UTF-8 BOM、UTF-16LE、UTF-16BE 都能读——Windows 上「另存为 Unicode」存的是 UTF-16LE，按 UTF-8 硬读会全是乱码，还会被误判成二进制。真二进制（含 `\u0000`）直接拒绝，不瞎猜。

`mode`：`auto`（按有无 markdown 标题判断）/ `chat` / `doc`。`doc` 额外查标题八股和空转表述。`limit`：最多返回多少条命中，默认 40。

判定四档：`干净` < `基本干净` < `有模板腔` < `模板腔重`。密度算法是加权严重度 ÷ 字数 × 300。

同时返回中文排版体检，和文风**分开算分**——排版错是硬伤，文风是口味，混在一起会互相淹没。15 条规则：半角标点（含中文句子里夹英文词的情况）、半角括号包中文、省略号写成三个点、破折号单个或两个连字符、英文引号包中文、英文句子混中文标点、重复标点、标点出现在行首、全角空格、连续空格、行尾空白、中英混排缺空格。

判定看上下文，不做语种识别：`Wait... let me check` 里的三个点不报（英文省略号合法），`用 --store-dir 装` 也不报（那是命令行参数），但 `等一下...就好`、`段落一 -- 段落二`、`Hello，world` 都会报。

能机械修的直接给改法：`"一,"` → `"一，"`、`"..."` → `"……"`、`"Hello，"` → `"Hello,"`。最后这条只换标点，不补空格。

代码先掩掉再扫，围栏块、行内 `` `代码` ``、双反引号 `` `` `套一层` `` `` 三种都算——所以 `foo(a,b)` 不会被当成排版错误，正文里引用 `` `值得注意的是` `` 也不会被当成套话。掩码用的是不换行空格，避免把代码替换成一长串空格、反过来触发“连续空格”规则。

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

`part` 取 `direct`（十条详解带改写示例）、`doc`（文件写作规范）、`slop`（AI 腔清单）、`workflow`（流程）、`checkpoints`（改稿 24 个检查点）、`examples`（14 组原文/改写对照）、`all`。

`examples` 是这一轮加的。规则说“删元话语”，改好的样子还得靠例子——模型对着 14 组对照比对着 12 条禁令更容易对齐。它按需加载，不占每轮成本。

## 自测

```powershell
node selftest.mjs    # 扫描器：脏/净中文、英文、文档模式、代码掩码、排版、自定义规则，49 项断言
node harness.mjs     # 假宿主：72 项断言，验证三面挂载形状、编码、端到端调用
node measure.mjs     # 每轮固定开销与字面重合度，改完代码用它对账
```

`harness.mjs` 挡住的是“注册形状写错”这类错误——它们在真宿主里是静默的：工具不出现、插件不报错。

`measure.mjs` 还顺手证伪了一个直觉：`direct` 那 1004 字看着像常驻契约的重述，实测字面重合 0 行，而且它按需加载、不占每轮成本，所以不该删。

## 目录

```
index.js          三面挂载入口：契约段 + 两个工具 + skill provider
prompt.js         常驻契约（按字付费，改这里等于改每次回复）
rules.js          六份规则全文，硬编码不读 md
analyze.js        扫描器：16 组正则、结构指标、结构审计、代码掩码、自定义规则
typography.js     中文排版体检：15 条规则 + 机械修正建议
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
