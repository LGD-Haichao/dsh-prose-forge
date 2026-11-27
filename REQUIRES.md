# 装之前必读：这是插件，不是纯提示词

这里的 SKILL.md 只是流程说明，真正干活的是 DeepSeek Harness 插件的两个工具：

- `prose_check` —— 扫描文本或文件，返回文风命中、结构指标、排版问题
- `prose_fix` —— 把可机械修正的排版问题改掉

**只装 SKILL.md 不能工作。** 里面的指令会让你去调用上面这两个工具，而它们属于插件，不属于这个 skill 包。没有插件时，你会看到一份「让我调用一个不存在的工具」的说明。

## 正确顺序

1. 先装插件：

```sh
dsh plugin --profile desktop add github:LGD-Haichao/dsh-prose-forge
```

2. 重启 DSH，或者到插件页把「文风锻造」关一次再开。
3. 确认报告末尾带版本号（形如 `· v0.7.0`），说明插件在跑。
4. 再把 skill 放进 `~/.agents/skills/`（DSH）、`~/.claude/skills/`（Claude Code）或 `~/.codex/skills/`（Codex）。

## 只用 SKILL.md 也能用的部分

不装插件的情况下，这两份 SKILL.md 里的写作流程仍然有用：立意先行、先摸材料再动笔、分节交付、交稿前自检。只是「自检」那一步要你自己看，或者靠模型自己判断，没有工具兜底。

## 环境

- DeepSeek Harness，能装插件
- Node ≥ 20
- 插件目录放纯 ASCII 路径（Windows 下 CLI 会把中文路径转成乱码）

## 许可

MIT。插件和 skill 都在 https://github.com/LGD-Haichao/dsh-prose-forge，可以免费取用。
