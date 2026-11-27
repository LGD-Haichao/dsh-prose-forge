# 第三方声明

本项目的机制和代码形状派生自下列MIT项目；规则文本（`prompt.js`、`rules.js` 里的散文部分）为自行撰写。

## 一、包含派生代码

### dsh-direct-human-style

- 来源：https://github.com/pseudonymzjt/dsh-direct-human-style
- 许可：MIT
- 派生部分：
  - `index.js` 的 `makeTool()`——参数规格转JSON Schema、`execute` 外层参数校验、`output: { schema, render }` 形状
  - `apply()` 里 `ctx.effect` 包 `ctx.systemPrompt.section` 的挂载方式
  - `analyze.js` 的判定密度算法（加权严重度÷字数 × 300，四档判定）

### why-gzh-writer

- 来源：https://github.com/why3316-g/why-gzh-writer
- 许可：MIT
- 派生部分：
  - `index.js` 的 `parseSkill()`——SKILL.md frontmatter 的单行 `key: value` 解析
  - skill provider 的 `list()` / `get()` 形状，以及 `BUNDLED_SKILL_RANK = 600` 的取值

## 二、仅思路参考，未复制代码

- [Humanizer-zh](https://github.com/op7418/Humanizer-zh)（MIT，Copyright (c) 2026 歸藏）——检查点的分组方式
- [Liam0205/skills](https://github.com/Liam0205/skills)（MIT，Copyright (c) Liam0205）——写作流程结构：立意先行、分节交付、返工止损
- [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0）——文档产出与格式处理的分工思路

## 三、上游许可全文

### dsh-direct-human-style

```
MIT License

Copyright (c) pseudonymzjt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### why-gzh-writer

```
MIT License

Copyright (c) why3316-g

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Humanizer-zh

```
MIT License

Copyright (c) 2026 歸藏

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
