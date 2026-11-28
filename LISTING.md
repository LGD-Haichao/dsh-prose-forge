# 上架材料

想把它挂到技能市场时，从这里取文案和素材。**先读 [REQUIRES.md](REQUIRES.md)**——它是插件，只传 SKILL.md 装的人会得到一份「让你调用不存在的工具」的说明。

## 中文描述

**标题**

文风锻造：20 项排版检查 + 写作流程，专治中文 AI 腔

**一句话**

扫描中文稿子的 AI 腔和排版硬伤，给出位置和改法；能机械修的直接修，修不了的告诉你为什么。

**正文**

中文稿子的问题分两层。词层面的好办：套话、平行否定、伪严谨、拔高、借权威，正则就能抓。难的是结构层面：每段一样长、每句一样长、每节都有小结——这些用词表抓不到，得算变异系数。

这个工具两层都查，一共 20 项：

- **文风层**：17 组规则，中英混排都认。命中给位置、上下文、改法，而不是丢一句「建议优化」。
- **结构层**：句长和段落的变异系数、加粗占比、列表占比、标题占比。全篇均匀是机器痕迹，统计指标比词表更早发现它。
- **排版层**：半角标点、数字与汉字之间的空格、引号括号是否配对、标点跑到行首。能机械修的直接给替换结果。

几个具体设计：

- **判定带下限**。命中不足 3 处时最高只判「基本干净」，一个词不该给整段定性。
- **中英混排分开算**。汉字算 1、英文词算 2，一句英文 80 个字符不会被误判成「句子太长」。
- **代码不算散文**。围栏块、行内代码、URL、二十字以内的引文都跳过，讲规则时引用被禁的词不会被当成违规。
- **长文档不进上下文**。给一个路径，只回报告，五千字的稿子也不占对话额度。

**适合**

写中文文档、报告、公众号、技术文章，交付前想自查一遍的人；审别人稿子想快速定位问题的人。

**不适合**

想一键把整篇文章重写的人——它只诊断和做机械修正，不改写。

**依赖**

需要 DeepSeek Harness 并安装配套插件，见 [REQUIRES.md](REQUIRES.md)。

**许可**

MIT，代码和 skill 在 https://github.com/LGD-Haichao/dsh-prose-forge 免费取用。

## Description (English)

**Title**

Prose Forge: 17 typography checks for Chinese-and-English mixed writing

**Body**

Chinese drafts fail in two layers. Word-level clichés are easy to catch with regex. Structural tells — every paragraph the same length, every sentence the same length — are not, because they are distributions, not phrases. This tool checks both: 16 rule groups across Chinese and English, plus variance metrics for sentence and paragraph length, bold ratio, list ratio and heading density.

Every hit comes with a line/column, surrounding context and a concrete fix. Mechanical problems (half-width punctuation, spaces between Chinese and Latin, unbalanced quotes) can be repaired in place, with the file's original encoding preserved.

It scans a file without pulling it into the conversation, so a 5,000-word draft costs one tool call and a report.

**Requires** DeepSeek Harness with the companion plugin installed — see [REQUIRES.md](REQUIRES.md). The SKILL.md alone will not work.

**License** MIT. Source at https://github.com/LGD-Haichao/dsh-prose-forge

## 素材

| 文件 | 用途 |
| --- | --- |
| `assets/cover-wide.png` | 封面横版，1200×630，适合仓库社交预览和文章头图 |
| `assets/cover-square.png` | 封面方版，880×880，适合市场列表缩略图 |
| `assets/scan-report.png` | 实际扫描输出渲染图，1180×1354，适合放详情页当证据 |
| `dist/prose-forge-write.zip` | 写作流程 skill 的打包，含 SKILL.md、REQUIRES.md、LICENSE |
| `dist/prose-forge-doc.zip` | 文件交付 skill 的打包，同上 |

## 定价

GitHub 上这份是免费的，付费版唯一的合理卖点是「省去安装和配置」。如果要收费，务必在描述里保留依赖说明——买家付钱之后发现要先装一个 DSH 插件，才是真麻烦。

## 上传前自查

- [ ] 描述里写明了「需要先装 DSH 插件」
- [ ] zip 里带了 REQUIRES.md
- [ ] 截图是最新版本（报告末尾的版本号要对得上）
- [ ] 定价和许可不冲突：MIT 允许你卖，但买家随时能从 GitHub 免费拿
