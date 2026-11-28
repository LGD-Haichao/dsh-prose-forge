"""检查 docx 里的中文引号是不是落在了西文字体上。

Word 给每个 run 两个字体槽：w:ascii（西文）和 w:eastAsia（中文）。
中文引号“”「」是边界字符，Word 按上下文挑槽。当两个槽不是同一个字体时，
引号很容易被渲染成西文字体的字形——宋体正文里冒出 Times New Roman 的弯引号，
就是这么来的。

用法：
    python check_quotes_font.py 文件.docx [--fix]

--fix 会把引号所在 run 的西文槽也改成中文槽的字体。
"""

import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

QUOTES = "“”‘’「」『』＂＇"
PUNCT = "，。；：、！？（）【】《》"


def run_fonts(run):
    """取 run 的 ascii 与 eastAsia 字体；没设置就返回 None。"""
    rPr = run._element.find(qn("w:rPr"))
    ascii_font = east_asia = None
    if rPr is not None:
        rFonts = rPr.find(qn("w:rFonts"))
        if rFonts is not None:
            ascii_font = rFonts.get(qn("w:ascii")) or rFonts.get(qn("w:hAnsi"))
            east_asia = rFonts.get(qn("w:eastAsia"))
    if ascii_font is None and run.font.name:
        ascii_font = run.font.name
    return ascii_font, east_asia


def check(path, fix=False):
    doc = Document(path)
    issues = []
    for p_index, paragraph in enumerate(doc.paragraphs, 1):
        for r_index, run in enumerate(paragraph.runs, 1):
            text = run.text
            if not text or not any(ch in QUOTES for ch in text):
                continue
            ascii_font, east_asia = run_fonts(run)
            # 两个槽都存在且不同，才有挑错字体的空间
            if ascii_font and east_asia and ascii_font != east_asia:
                issues.append((p_index, r_index, text[:40], ascii_font, east_asia, run))
    print(f"文件：{path}")
    print(f"含引号的 run 里，西文槽与中文槽不一致的：{len(issues)} 处")
    for p_index, r_index, text, ascii_font, east_asia, _ in issues[:20]:
        print(f"  段{p_index} run{r_index}: 西文={ascii_font} 中文={east_asia}  {text!r}")
    if fix and issues:
        for *_, run in issues:
            rPr = run._element.get_or_add_rPr()
            rFonts = rPr.find(qn("w:rFonts"))
            _, east_asia = run_fonts(run)
            rFonts.set(qn("w:ascii"), east_asia)
            rFonts.set(qn("w:hAnsi"), east_asia)
        doc.save(path)
        print(f"已修正 {len(issues)} 处并保存")
    return len(issues)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    target = Path(sys.argv[1])
    count = check(target, fix="--fix" in sys.argv)
    sys.exit(1 if count else 0)
