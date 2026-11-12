# -*- coding: utf-8 -*-
"""Build the final (V3.0) Nestory PRD as PRD.docx."""
import datetime
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = r"D:\OneDrive\桌面\NESTORY\PRD.docx"

FOREST = RGBColor(0x30, 0x4B, 0x3B)
FOREST_DEEP = RGBColor(0x22, 0x36, 0x2A)
INK = RGBColor(0x30, 0x3B, 0x34)
INK2 = RGBColor(0x5F, 0x6D, 0x63)
INK3 = RGBColor(0x8B, 0x96, 0x8C)
CHAMPAGNE = RGBColor(0xC3, 0xAD, 0x85)
DANGER = RGBColor(0xA4, 0x55, 0x3F)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

HEX_TINT = "E7EBE4"
HEX_IVORY = "F9F7F1"
HEX_IVORY_DEEP = "F1ECE0"
HEX_CHAMPAGNE = "C3AD85"
HEX_CHAMPAGNE_TINT = "F2EBDC"
HEX_HAIR = "DDD6C7"
HEX_ALT = "FBF9F4"

BODY_FONT = "DengXian"
BODY_EA = "等线"
MONO = "Consolas"

doc = Document()

# ---------- page setup ----------
sec = doc.sections[0]
sec.page_width = Cm(21)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.2)
sec.bottom_margin = Cm(2.2)
sec.left_margin = Cm(3.0)
sec.right_margin = Cm(3.0)
sec.header_distance = Cm(1.2)
sec.footer_distance = Cm(1.2)

CONTENT_W = 21 - 3.0 - 3.0  # 15.0 cm


def style_run(run, size=10.5, bold=False, color=INK, italic=False,
              font=BODY_FONT, east=BODY_EA, mono=False):
    if mono:
        font, east = MONO, BODY_EA
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:ascii"), font)
    rFonts.set(qn("w:hAnsi"), font)
    rFonts.set(qn("w:eastAsia"), east)
    rFonts.set(qn("w:cs"), font)


def add_bottom_border(p, color=HEX_CHAMPAGNE, sz=6, space=4):
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    pBdr.append(bottom)
    pPr.append(pBdr)


def add_left_border(p, color=HEX_CHAMPAGNE, sz=18, space=8):
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), str(sz))
    left.set(qn("w:space"), str(space))
    left.set(qn("w:color"), color)
    pBdr.append(left)
    pPr.append(pBdr)


def add_top_border(p, color=HEX_HAIR, sz=4, space=6):
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    top = OxmlElement("w:top")
    top.set(qn("w:val"), "single")
    top.set(qn("w:sz"), str(sz))
    top.set(qn("w:space"), str(space))
    top.set(qn("w:color"), color)
    pBdr.append(top)
    pPr.append(pBdr)


def shade_paragraph(p, fill):
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)


def para(text="", size=10.5, bold=False, color=INK, italic=False,
         align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=0, after=4.5,
         line=1.55, left=0, first=0, keep=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = align
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.left_indent = Cm(left)
    pf.first_line_indent = Cm(first)
    pf.keep_with_next = keep
    if text:
        r = p.add_run(text)
        style_run(r, size=size, bold=bold, color=color, italic=italic)
    return p


def h1(text):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "6")
    bottom.set(qn("w:color"), HEX_CHAMPAGNE)
    pBdr.append(bottom)
    pPr.append(pBdr)
    pf = p.paragraph_format
    pf.space_before = Pt(20)
    pf.space_after = Pt(9)
    pf.line_spacing = 1.2
    pf.keep_with_next = True
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p.add_run(text)
    style_run(r, size=14.5, bold=True, color=FOREST)
    return p


def h2(text):
    p = para(text, size=11, bold=True, color=FOREST_DEEP,
             align=WD_ALIGN_PARAGRAPH.LEFT, before=12, after=4.5,
             line=1.3, keep=True)
    return p


def bullet(text, size=10.5, after=2.5):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.left_indent = Cm(0.62)
    pf.first_line_indent = Cm(-0.42)
    pf.space_before = Pt(0)
    pf.space_after = Pt(after)
    pf.line_spacing = 1.5
    dot = p.add_run("•  ")
    style_run(dot, size=size, bold=True, color=CHAMPAGNE)
    body = p.add_run(text)
    style_run(body, size=size, color=INK)
    return p


def numbered(items):
    for i, text in enumerate(items, 1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        pf.left_indent = Cm(0.75)
        pf.first_line_indent = Cm(-0.55)
        pf.space_before = Pt(0)
        pf.space_after = Pt(3)
        pf.line_spacing = 1.5
        n = p.add_run(f"{i}.  ")
        style_run(n, size=10.5, bold=True, color=CHAMPAGNE)
        b = p.add_run(text)
        style_run(b, size=10.5, color=INK)


def callout(text, lead=None):
    p = doc.add_paragraph()
    add_left_border(p)
    shade_paragraph(p, HEX_CHAMPAGNE_TINT)
    pf = p.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.left_indent = Cm(0.35)
    pf.right_indent = Cm(0.2)
    pf.space_before = Pt(8)
    pf.space_after = Pt(10)
    pf.line_spacing = 1.5
    if lead:
        r = p.add_run(lead + "  ")
        style_run(r, size=10, bold=True, color=FOREST)
    r2 = p.add_run(text)
    style_run(r2, size=10, color=INK2)
    return p


def quote(text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
    pf.left_indent = Cm(0.5)
    pf.space_before = Pt(4)
    pf.space_after = Pt(8)
    pf.line_spacing = 1.4
    r = p.add_run(text)
    style_run(r, size=11.5, bold=True, color=FOREST)
    return p


def add_cell_borders(tbl, color=HEX_HAIR, sz=4):
    tblPr = tbl._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tblPr.insert_element_before(
        borders,
        "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook",
        "w:tblCaption", "w:tblDescription", "w:tblPrChange",
    )


def set_cell_shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcPr.insert_element_before(
        shd,
        "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText",
        "w:vAlign", "w:hideMark", "w:headers", "w:cellIns",
        "w:cellDel", "w:cellMerge", "w:tcPrChange",
    )


def set_cell_margins(tbl, top=55, start=80, bottom=55, end=80):
    tblPr = tbl._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for tag, val in (("top", top), ("left", start), ("bottom", bottom), ("right", end)):
        el = OxmlElement(f"w:{tag}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblPr.insert_element_before(
        mar,
        "w:tblLook", "w:tblCaption", "w:tblDescription", "w:tblPrChange",
    )


def table(headers, rows, widths, first_bold=False, size=8.8, keep_all=False):
    tbl = doc.add_table(rows=1, cols=len(headers))
    tbl.style = "Table Grid"
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl.autofit = False
    add_cell_borders(tbl)
    set_cell_margins(tbl)

    # fixed layout (autofit=False already writes w:tblLayout)
    tblPr = tbl._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is not None:
        tblW.set(qn("w:type"), "dxa")
        tblW.set(qn("w:w"), str(int(round(sum(widths) * 567))))

    hdr = tbl.rows[0]
    trPr = hdr._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)
    cant = OxmlElement("w:cantSplit")
    trPr.append(cant)

    for i, text in enumerate(headers):
        cell = hdr.cells[i]
        cell.width = Cm(widths[i])
        set_cell_shade(cell, HEX_TINT)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.2
        r = p.add_run(text)
        style_run(r, size=size, bold=True, color=FOREST)

    for ri, row in enumerate(rows):
        cells = tbl.add_row().cells
        tr = tbl.rows[-1]._tr
        trPr = tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)
        for ci, text in enumerate(row):
            cell = cells[ci]
            cell.width = Cm(widths[ci])
            if ri % 2 == 1:
                set_cell_shade(cell, HEX_ALT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.25
            r = p.add_run(str(text))
            style_run(r, size=size, bold=(first_bold and ci == 0), color=INK)

    for col, w in zip(tbl.columns, widths):
        col.width = Cm(w)

    # only very short tables are kept on one page
    if len(rows) <= 4 or keep_all:
        for row in list(tbl.rows)[:-1]:
            for cell in row.cells:
                for cp in cell.paragraphs:
                    cp.paragraph_format.keep_with_next = True

    # avoid a table starting at the bottom of a page with only one or two rows
    for row in list(tbl.rows)[:3]:
        for cell in row.cells:
            for cp in cell.paragraphs:
                cp.paragraph_format.keep_with_next = True

    gap = doc.add_paragraph()
    gap.paragraph_format.space_before = Pt(0)
    gap.paragraph_format.space_after = Pt(0)
    gap.paragraph_format.line_spacing = 1.0
    gr = gap.add_run("")
    style_run(gr, size=4)
    return tbl


# ---------- header / footer ----------
sec.different_first_page_header_footer = True

hp = sec.header.paragraphs[0]
add_bottom_border(hp, color=HEX_HAIR, sz=4, space=2)
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
hr = hp.add_run("Nestory · 产品需求文档 V3.0")
style_run(hr, size=8, color=INK3)

fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

def add_field(paragraph, instr):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = f" {instr} "
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    txt = OxmlElement("w:t")
    txt.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr_el)
    run._r.append(fld_sep)
    run._r.append(txt)
    run._r.append(fld_end)
    style_run(run, size=8.5, color=INK3)

dash = fp.add_run("—  ")
style_run(dash, size=8.5, color=INK3)
add_field(fp, "PAGE")
dash2 = fp.add_run("  —")
style_run(dash2, size=8.5, color=INK3)

# first-page footer: quiet brand line at the bottom of the cover
fp1 = sec.first_page_footer.paragraphs[0]
add_top_border(fp1, color=HEX_HAIR, sz=4, space=8)
fp1.alignment = WD_ALIGN_PARAGRAPH.LEFT
r1 = fp1.add_run("NESTORY   ·   家庭成长记录   ·   2026")
style_run(r1, size=7.5, color=INK3)

# ---------- cover ----------
for _ in range(3):
    para("", size=10, after=0, line=1.0)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("PRODUCT REQUIREMENTS DOCUMENT")
style_run(r, size=9.5, bold=True, color=CHAMPAGNE)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.line_spacing = 1.15
r = p.add_run("Nestory 产品需求文档")
style_run(r, size=27, bold=True, color=FOREST)

p = doc.add_paragraph()
add_bottom_border(p, color=HEX_CHAMPAGNE, sz=12, space=10)
p.paragraph_format.space_after = Pt(14)
r = p.add_run("小宝成长记 · V3.0 最终交付版")
style_run(r, size=12, bold=True, color=INK2)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("A little nest. A lifetime of stories.")
style_run(r, size=14, italic=True, color=CHAMPAGNE)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(30)
r = p.add_run("为每一个家庭，珍藏成长的每一天。")
style_run(r, size=10.5, color=INK3)

meta = [
    ("产品名称", "Nestory（小宝成长记）"),
    ("文档版本", "V3.0 · 最终交付版"),
    ("更新日期", "2026-11-12"),
    ("产品类型", "家庭成长记录 · 电子相册"),
    ("交付形态", "移动优先 Web 应用（本机部署）"),
    ("前端技术", "React 19 · TypeScript 5 · Vite 7"),
    ("后端技术", "Python 标准库 HTTP · MySQL 8"),
    ("AI 能力", "OpenAI 兼容模型 · 本地规则兜底"),
    ("文档状态", "与当前代码一致，取代 V1.0"),
]
tbl = doc.add_table(rows=0, cols=2)
tbl.autofit = False
add_cell_borders(tbl, color="E3DCCB", sz=4)
set_cell_margins(tbl, top=65, start=110, bottom=65, end=110)
for k, v in meta:
    cells = tbl.add_row().cells
    cells[0].width = Cm(3.4)
    cells[1].width = Cm(11.1)
    set_cell_shade(cells[0], HEX_IVORY)
    p0 = cells[0].paragraphs[0]
    p0.paragraph_format.space_after = Pt(0)
    p0.paragraph_format.line_spacing = 1.25
    r0 = p0.add_run(k)
    style_run(r0, size=9, bold=True, color=INK2)
    p1 = cells[1].paragraphs[0]
    p1.paragraph_format.space_after = Pt(0)
    p1.paragraph_format.line_spacing = 1.25
    r1 = p1.add_run(v)
    style_run(r1, size=9, color=INK)
for col, w in zip(tbl.columns, (3.4, 11.1)):
    col.width = Cm(w)

para("", size=8, after=0, line=1.0)
note = para(
    "阅读说明：本文档是交付对齐版 PRD，需求描述与仓库实现一一对应。"
    "标注「已实现」的能力都能在当前运行版本与自动化测试中复现；"
    "V1.0 中规划但本版未交付的能力，集中标注在第十三、十五、十六章。",
    size=8.5, color=INK3, line=1.6, before=6, after=0,
)

doc.add_page_break()

# ---------- reading guide ----------
callout(
    "产品与设计重点读第一、三至六、十二章；工程重点读第八至十一章；"
    "验收与交接重点读第十三至十六章。文中所有数值取自 2026-11-12 的实际构建与测试结果。",
    lead="阅读指引",
)

# ---------- 1 ----------
h1("一、产品概述")

h2("1.1 产品背景")
para(
    "新生儿的头一年，家庭每天要处理喂养、睡眠、尿布、生长测量、照片与纪念日。"
    "这些信息通常散落在备忘录、聊天记录、相册和纸质表格里：记得下次数，记不住间隔；"
    "拍得到照片，串不成时间线；换一部手机，前面的记录就断了。"
)
para(
    "Nestory 把这些内容收进同一个安静的空间：一次记录只解决一件事，统计与月龄自动计算，"
    "照片和里程碑落在同一条时间线上，家庭成员看到同一份档案。"
)

h2("1.2 产品目标")
bullet("快：从首页进入一次喂养记录不超过 3 次点击，保存即回首页。")
bullet("准：亲喂与奶量严格分开；间隔按开始时间计算；月龄按真实日历月计算。")
bullet("稳：登录后先取 MySQL 中的数据再渲染，刷新、换浏览器、重新登录都不丢记录。")
bullet("清楚：今日摘要、近 7 天趋势、最近测量与下次提醒都在一屏内可读。")
bullet("有温度：AI 只把已经发生的事实写成一句话，不评判、不诊断、不制造焦虑。")
bullet("可维护：配置、业务规则、页面与后端分层，替换数据库或模型不影响页面。")

h2("1.3 核心产品理念")
quote("记录简单、统计自动、提醒及时、成长可视、回忆永久。")
para(
    "Nestory 不是育儿仪表盘。它不评分、不排名、不用红色数字催促喂养；"
    "它只负责把已经发生的日子收好，让父母在很久以后还能翻到某一天的光。"
)

h2("1.4 本版范围与明确不做")
para("以下边界是 V3.0 的验收前提，也是与 V1.0 规划的主要差异：")
bullet("不做医疗诊断、发育评估或喂养处方；生长数据只作家庭记录。")
bullet("不做强制提醒：V3.0 只有应用内提示与下次时间预览，没有系统通知调度。")
bullet("不做公网云同步：后端只监听 127.0.0.1，数据在本机 MySQL；多设备同时使用未实现。")
bullet("不做多宝宝、会员体系与社交分享。")
bullet("不交付 Android APK / iOS 安装包；V3.0 的交付形态是移动优先 Web。")
callout(
    "V3.0 是一个可以真实使用的单机家庭成长记录应用，而不是只能看的网页演示；"
    "它也还不是一个可以上架的商业 App。",
    lead="一句话",
)

# ---------- 2 ----------
h1("二、用户角色与权限")

h2("2.1 家庭管理员（admin）")
para("通常是爸爸或妈妈，拥有完整能力：")
bullet("编辑宝宝档案与头像，管理家庭成员和权限。")
bullet("添加、修改、删除全部喂养、睡眠、尿布与成长记录。")
bullet("上传照片、视频与 Live；导出数据、恢复示例数据。")

h2("2.2 可记录与编辑（edit）")
bullet("查看全部内容，添加和修改记录，上传照片。")
bullet("不能修改成员权限，也不能移出成员。")

h2("2.3 仅可查看（read）")
bullet("只读浏览，界面不出现保存类操作入口，避免误改。")

h2("2.4 当前实现边界")
para(
    "账号是数据隔离单位，家庭是账号内的一组成员档案。权限影响界面上的操作入口，"
    "服务端目前没有按成员粒度做资源级鉴权；「邀请另一个账号共同编辑同一个宝宝」尚未实现。"
    "唯一被强制的规则是：最后一位管理员不能被移出或降级。"
)
para(
    "每条喂养记录保存 author（记录人显示名）与 updatedAt；viewerId 由会话返回，"
    "决定新记录的作者，客户端不能伪造 user id。"
)

# ---------- 3 ----------
h1("三、功能架构与导航")

h2("3.1 信息架构")
table(
    ["层级", "入口", "页面", "职责"],
    [
        ["一级", "底部 Tab", "首页", "品牌主视觉、今日摘要、快捷记录、AI 小结、时间轴"],
        ["一级", "底部 Tab", "成长", "生长测量、体重趋势、五列表格；睡眠与尿布分段"],
        ["一级", "底部 Tab", "相册", "封面、月份筛选、全屏查看、六种添加方式、AI 相册故事"],
        ["一级", "底部 Tab", "我的", "宝宝档案、家庭成员、通用设置入口"],
        ["二级", "首页 / 成长", "喂养中心", "统计、趋势、提醒与完整记录，不显示录入表单"],
        ["二级", "首页摘要卡", "快速记录", "一张表单 + 最近 5 条，保存后回首页"],
        ["二级", "首页 / 设置", "提醒中心", "开关、间隔、夜间安静、下次提醒预览"],
        ["二级", "我的", "通用设置", "字体、动效、通知权限、存储、导出、隐私与协议"],
        ["二级", "我的", "关于 Nestory", "名字由来、品牌信念、写给未来的信"],
    ],
    [1.5, 3.2, 3.2, 7.1],
    first_bold=True,
)

h2("3.2 模块与状态")
table(
    ["模块", "主要能力", "状态"],
    [
        ["宝宝档案", "昵称 / 生日 / 性别 / 出生信息 / 头像；真实月龄", "已实现"],
        ["喂养", "三种方式、左右计时、统计、间隔、编辑删除", "已实现"],
        ["睡眠", "开始 / 结束、跨夜、统计", "已实现"],
        ["尿布", "湿 / 脏 / 混合、次数、最近更换", "已实现"],
        ["成长", "体重 / 身长 / 头围、趋势、队列表格", "已实现"],
        ["提醒", "间隔、夜间安静、下次预览", "已实现（应用内）"],
        ["相册", "照片 / 视频 / Live、月份、全屏、AI 故事", "已实现"],
        ["家庭", "三档权限、移出成员、最后管理员保护", "已实现（账号内）"],
        ["账号", "注册、登录、退出、30 天会话", "已实现"],
        ["AI", "每日一句、小结、成长分析、相册故事", "已实现"],
        ["疫苗 / 体检", "接种记录与预约提醒", "未交付（V3.3）"],
        ["系统通知", "本地通知调度", "未交付（V3.2）"],
        ["云同步", "多设备、多账号共享", "未交付（V3.1）"],
    ],
    [3.4, 8.7, 2.9],
    first_bold=True,
)

h2("3.3 关键旅程")
numbered([
    "打开应用 → GET /api/auth/me：未登录显示登录 / 注册；已登录直接拿到 AppState。",
    "首页看到主视觉、今日摘要与四个快捷圆钮。",
    "点「喂奶」进入喂养中心，或从摘要卡「记录这次喂养」进入快速记录。",
    "选择方式、确认时间与奶量 / 计时，保存后回到首页，摘要即时更新。",
    "800ms 后整份 AppState 自动写入 MySQL；刷新或重新登录仍在。",
    "晚上在成长页补充睡眠与尿布；在相册添加照片，标题进入 AI 相册故事。",
])

# ---------- 4 ----------
h1("四、核心模块一：成长管家")

h2("4.1 宝宝档案")
para("注册时创建，之后在「我的」中编辑。档案是月龄、纪念日与首页主视觉的数据源。")
table(
    ["字段", "必填", "说明"],
    [
        ["昵称", "是", "首页与所有文案的称呼"],
        ["出生日期", "是", "YYYY-MM-DD；不能晚于今天"],
        ["性别", "是", "girl / boy，影响头像与文案"],
        ["出生时间", "否", "HH:mm"],
        ["出生体重", "否", "kg，保留一位小数"],
        ["出生身长", "否", "cm"],
        ["出生头围", "否", "cm"],
        ["出生地", "否", "文本"],
        ["头像", "否", "相册选择或拍照；压缩到最长边 1200px、JPEG 0.82"],
    ],
    [3.0, 1.6, 10.4],
    first_bold=True,
)
para("自动计算：")
bullet("月龄：按真实日历月（addMonths 月末 clamp），不按 30 天近似。例：7 月 31 日出生，11 月 11 日显示「3 个月 11 天 · 第 103 天」。")
bullet("出生天数、周龄、下一个纪念日。")
bullet("未来生日被拦截；已保存的档案不会因时区变化跳日。")
para("昵称、生日与头像同时写回 users 表，方便账号列表与重置时重建初始状态。")

h2("4.2 喂养记录（P0）")
para("喂养是使用频率最高的功能，分成两个入口，界面不重复：")
bullet("快速记录：从首页摘要卡进入，只有一张表单与最近 5 条，保存后直接回首页。")
bullet("喂养中心：从首页快捷圆钮进入，展示统计、近 7 天趋势、提醒与完整记录，不显示录入表单。")
para("三种方式独立记录，允许同一次喂养同时有亲喂与瓶喂数据：")
bullet("母乳亲喂：只记录左侧 / 右侧秒数；提供开始、暂停、继续、结束。")
bullet("瓶喂母乳：记录 bottleMl；预设 60 / 90 / 120 / 150 ml，默认 120。")
bullet("配方奶：记录 formulaMl；默认 90。")
bullet("方式默认不预选，必须由用户明确选择；再点一次取消，避免误触进入计时。")
table(
    ["字段", "类型", "说明"],
    [
        ["开始时间", "日期时间", "自动填入当前时间，可修改"],
        ["结束时间", "日期时间", "亲喂计时结束时写入"],
        ["方式", "多选", "亲喂 / 瓶喂母乳 / 配方奶"],
        ["左侧时长", "秒", "亲喂计时累计"],
        ["右侧时长", "秒", "亲喂计时累计"],
        ["瓶喂母乳量", "ml", "仅瓶喂方式"],
        ["配方奶量", "ml", "仅配方奶方式"],
        ["备注", "文本", "可选"],
        ["记录人", "文本", "由 viewerId 解析"],
        ["更新时间", "时间戳", "编辑时刷新"],
    ],
    [3.4, 2.6, 9.0],
    first_bold=True,
)
callout(
    "亲喂分钟数绝不换算成毫升。统计中的总奶量只由 bottleMl 与 formulaMl 相加，"
    "亲喂只贡献次数与时长。",
    lead="铁律",
)
para(
    "支持修改与删除历史记录，也支持补录过去的时间。删除有二次确认，并明确提示"
    "「今日次数、瓶喂量与间隔会立即重新计算」。"
)
para(
    "主页面保留最近 3 条作为上下文，点「查看全部 N 条记录」进入全屏列表；"
    "按天分组，编辑、删除与主页面一致，返回后回到喂养中心。"
)

h2("4.3 喂养统计")
para("今日统计全部由当前记录派生，不存冗余字段：")
bullet("今日喂奶总次数 / 亲喂次数 / 瓶喂次数 / 配方奶次数。")
bullet("今日瓶喂母乳总量、配方奶总量、有明确摄入量的总毫升数。")
bullet("最近一次喂养时间与距今时长、今日平均间隔、最近 24 小时次数。")
bullet("近 7 天柱状趋势与每日时间分布。")
para("间隔公式：")
quote("喂养间隔 = 本次喂养开始时间 − 上次喂养开始时间")
para(
    "以开始时间而非结束时间为准；跨午夜、深夜补记按真实时间计算。"
    "新增、修改、删除任一记录后，次数、奶量、平均间隔、趋势与首页摘要立即重算。"
)

h2("4.4 喂养提醒")
bullet("开关；间隔档位 2 / 2.5 / 3 / 3.5 / 4 小时（120–240 分钟）。")
bullet("夜间安静；轻触反馈（保存时一次很轻的振动，受系统支持影响）。")
bullet("下次提醒时间以上一次喂养开始时间推算；首页摘要显示倒计时与进度条。")
bullet("通知权限状态区分：尚未开启 / 已开启 / 已拒绝 / 不可用，并可发起浏览器授权请求。")
para(
    "V3.0 的提醒只在应用内呈现，不会在后台弹出系统通知，关闭页面后不会主动唤醒。"
    "因此它是记录辅助，不是喂养时钟。"
)
callout(
    "提醒只是家长自己设置的记录辅助，不替代宝宝的饥饿信号、儿科医生的喂养建议与"
    "个体化喂养方案。宝宝想吃的时候，随时都可以喂。",
    lead="说明",
)

h2("4.5 睡眠记录")
bullet("开始与结束各填日期 + 时间；跨夜时把结束日期选为次日。")
bullet("结束早于开始、单次超过 24 小时、时间晚于现在都会被拦下。")
bullet("已有未结束的睡眠时，快捷面板转为「补充结束时间」，不会产生重叠记录。")
bullet("今日睡眠总时长、段数、平均单次时长；成长页提供睡眠分段视图。")
bullet("记录抽屉为六格摘要：开始日期 / 时间、结束日期 / 时间、时长与提示。")

h2("4.6 尿布记录")
bullet("类型：小便（wet）/ 大便（dirty）/ 同时（both）。")
bullet("发生时间与备注；大便性状只作为自由文本备注。")
bullet("今日湿 / 脏次数、最近更换时间；不根据颜色或性状做任何疾病判断。")

h2("4.7 体重、身长与头围")
bullet("每次测量记录日期、体重 kg、身长 cm、头围 cm，任一项可留空。")
bullet("「最新测量」深绿卡：体重为主，身长 / 头围为辅，并对照出生值。")
bullet("体重趋势支持近 1 月 / 近 3 月 / 全部；少于两次记录时提示先积累数据。")
bullet("测量记录为五列表格：日期 / 体重 / 身长 / 头围 / 较上次；按时间倒序。")
para(
    "成长数据只作家庭记录；页面固定提示「生长评估请以儿保医生的判断为准」，"
    "不提供百分位诊断。"
)

h2("4.8 纪念日与时间轴")
bullet("里程碑：标题、日期、备注；AI 小结会追加为一条 milestone。")
bullet("自动纪念日：满月、百天、半岁、周岁，以及春节、中秋、母亲节、父亲节等节日。")
bullet("首页成长时间轴展示最近里程碑；相册按月份回看照片。")
bullet("特殊日子会作为「每日一句」的上下文，生成一行标签与祝福。")
para(
    "V1.0 规划的疫苗接种、体检预约与提醒未纳入 V3.0；数据结构与页面入口都未交付，"
    "列入 V3.3。"
)

# ---------- 5 ----------
h1("五、核心模块二：电子相册")

h2("5.1 添加入口（六种）")
para(
    "相册面板按 PHOTO / VIDEO / LIVE 三组提供六个入口，全部使用系统文件选择或相机 capture："
)
table(
    ["分组", "入口", "说明"],
    [
        ["照片", "从相册选择", "JPG / PNG / HEIC；压缩到最长边 1200px、JPEG 0.82"],
        ["照片", "拍一张照片", "直接打开相机"],
        ["视频", "从相册选择视频", "MP4 / MOV；单个上限 120 MB"],
        ["视频", "录制视频", "用相机记录一段"],
        ["Live", "导入 Live 照片", "选择 Live Photo 导出的短片"],
        ["Live", "拍一段 Live", "录 3 秒，成为会动的照片"],
    ],
    [2.2, 4.4, 8.4],
    first_bold=True,
)
para(
    "照片写入 AppState（src / thumb），视频与 Live 短片写入 IndexedDB，"
    "只在状态里保存海报与 videoId；否则一段短片就会撑爆浏览器存储。"
)

h2("5.2 拍摄时间与标题")
para(
    "本版不解析 EXIF，拍摄时间取文件修改时间，用户可手动修改；标题即 caption，"
    "可在添加时填写，也会被 AI 相册故事引用。"
)

h2("5.3 分类、封面与全屏")
bullet("最近一张照片升为 4:3 封面；封面之后是月份筛选与按月分组。")
bullet("在月份筛选下添加照片后自动回到「全部」，确保新照片可见。")
bullet("全屏查看支持左右滑动、两侧箭头、键盘方向键；底部显示「2 / 6」计数，首尾循环。")
bullet("视频使用系统播放控件；Live 静音循环播放；Esc 或点空白关闭并恢复滚动。")
bullet("删除照片二次确认；本版不做批量选择、批量移动、收藏与多相册。")

h2("5.4 AI 相册故事")
para(
    "读取照片数量、时间跨度、前几张标题与最近里程碑，生成 2–3 句故事；"
    "明确禁止编造照片里没有的衣物、天气与对白。模型不可用时用本地模板兜底。"
)

# ---------- 6 ----------
h1("六、首页")
para(
    "首页是品牌与数据的第一屏，顺序固定为：主视觉 → 快捷区 → 今日摘要 → AI 小结 → "
    "最近照片 → 成长时间轴 → 纪念日。"
)

h2("6.1 品牌主视觉")
bullet("最多 4 张照片，只从成长相册已有内容中选择，不提供第二个上传通道。")
bullet("6 秒自动轮播；真实手指左右滑动；手动操作后暂停 10 秒再恢复。")
bullet("四宫格 + 同尺寸加号格；可更换、清空、恢复默认；失效照片回退到相册现有照片。")
bullet("照片下方显示宝宝名字、月龄与一句品牌文案（AI 每日一句或静态兜底）。")

h2("6.2 快捷区与今日摘要")
bullet("四个同色快捷圆钮：喂奶 / 睡眠 / 尿布 / 成长数据；旁边是「记录这次喂养」。")
bullet("快捷区压在照片下沿，是独立圆角卡片；在 320×568 到 430×932 的首屏都完整位于 TabBar 之上。")
bullet("今日摘要六格：今日喂养次数、瓶喂记录量、最近喂养与时间、最近体重（含较上次）、今日睡眠（段数）、今日尿布（湿 / 脏）。")
bullet("开启提醒时，摘要下方显示下次提醒倒计时与进度条。")

h2("6.3 AI 小结与最近内容")
bullet("「生成今日小结」把当天喂养 / 睡眠 / 尿布 / 体重写成一条小结，追加为 milestone，并返回完整 AppState。")
bullet("最近照片 4 张；成长时间轴 3 条；纪念日卡展示下一个重要日子。")

h2("6.4 桌面端")
para(
    "≥720px 时保持 460px 手机画布居中，带柔和环境光背景；不拉伸成后台布局。"
)

# ---------- 7 ----------
h1("七、提醒中心")
bullet("统一管理喂养提醒：总开关、间隔档位、夜间安静、轻触反馈。")
bullet("展示「下次提醒」的绝对时间与剩余时长，基于最近一次喂养开始时间。")
bullet("从首页或设置进入时携带 from，返回对应入口，而不是固定跳一个页面。")
bullet("通知权限状态与系统授权入口集中在通用设置。")
para(
    "V3.0 没有提醒历史、延后提醒、睡眠 / 疫苗 / 纪念日提醒与系统通知恢复；"
    "这些属于 V3.2。"
)

# ---------- 8 ----------
h1("八、账号、会话与家庭")

h2("8.1 注册与登录")
bullet("注册字段：邮箱、密码（至少 8 位）、你的昵称、宝宝昵称、宝宝生日；注册成功直接进入首页。")
bullet("登录失败不区分「邮箱不存在」与「密码错误」，统一提示，避免枚举账号。")
bullet("会话 Cookie 有效期 30 天；退出登录删除当前会话并回到登录页。")
bullet("同一账号在不同浏览器登录，拿到的是同一份 MySQL 数据。")

h2("8.2 安全实现")
bullet("密码 PBKDF2-HMAC-SHA256，260000 次迭代、16 字节随机盐；数据库不存明文。")
bullet("会话令牌 secrets.token_urlsafe(32)，数据库只存 SHA-256；Cookie 为 HttpOnly、SameSite=Lax、Path=/。")
bullet("所有读写都从会话解析 user_id，不接受客户端传 user id；接口之间互不越权。")

h2("8.3 家庭成员")
bullet("成员包含姓名、角色、颜色与三档权限；可修改权限、移出成员。")
bullet("最后一位管理员不能被移出或降级。")
bullet("成员头像与记录作者使用同一套 viewerId 解析。")
para(
    "边界：V3.0 的家庭是「一个账号内的成员列表」，不是「多个账号共享一个宝宝」。"
    "邀请链接、跨账号授权与实时协同未实现，见 V3.1。"
)

# ---------- 9 ----------
h1("九、数据与后端")

h2("9.1 数据模型")
para(
    "前端与后端共用一份 AppState（version = 3），时间统一为 epoch 毫秒，"
    "宝宝生日为 YYYY-MM-DD 字符串。"
)
table(
    ["字段", "类型", "说明"],
    [
        ["baby", "object", "昵称、生日、性别、出生信息、头像"],
        ["feeds", "array", "喂养：开始 / 结束、左右秒数、瓶喂与配方奶 ml、备注、作者"],
        ["sleeps", "array", "睡眠：开始、结束、备注"],
        ["diapers", "array", "尿布：时间、类型、备注"],
        ["growths", "array", "生长：时间、体重、身长、头围"],
        ["milestones", "array", "里程碑与纪念日"],
        ["photos", "array", "照片 / 视频 / Live：地址、缩略图、时间、标题、类型、时长"],
        ["heroPhotoIds", "array", "首页主视觉选中的照片 id"],
        ["reminder", "object", "开关、间隔、夜间安静、振动"],
        ["family", "array", "家庭成员与权限"],
        ["viewerId", "string", "当前操作者"],
        ["lastSyncedAt", "number", "最近一次保存时间"],
    ],
    [3.2, 2.2, 9.6],
    first_bold=True,
)

h2("9.2 MySQL 表")
table(
    ["表", "内容", "关键字段"],
    [
        ["users", "账号与宝宝基础信息", "id、email、password_hash、nickname、baby_name、baby_birthday"],
        ["sessions", "会话", "token_hash（主键）、user_id、expires_at"],
        ["user_state", "每个账号一整份 AppState", "user_id（主键）、state_json（MEDIUMTEXT）、updated_at"],
    ],
    [2.6, 5.2, 7.2],
    first_bold=True,
)
para(
    "三张表均使用 InnoDB / utf8mb4；sessions 与 user_state 对 users 设 ON DELETE CASCADE。"
    "schema 由启动时 init_schema() 幂等创建，首次可用 setup_mysql.py 建库建账号。"
)

h2("9.3 接口")
table(
    ["方法", "路径", "说明"],
    [
        ["POST", "/api/auth/register", "注册并种 Cookie"],
        ["POST", "/api/auth/login", "登录，返回 { user, state }"],
        ["POST", "/api/auth/logout", "退出"],
        ["GET", "/api/auth/me", "当前会话 → { user, state }；未登录 401"],
        ["GET", "/api/state", "当前用户状态（source = mysql）"],
        ["PUT", "/api/state", "保存整份 AppState"],
        ["POST", "/api/state/reset", "用示例数据重置当前账号"],
        ["POST", "/api/ai/summary", "今日小结，追加 milestone"],
        ["POST", "/api/ai/analysis", "近 7 天成长分析"],
        ["POST", "/api/ai/story", "相册故事"],
        ["POST", "/api/daily-quote", "首页每日一句"],
        ["GET", "/api/health", "健康检查（db / ai）"],
        ["GET", "/api/test-config", "原始模板，便于核对 fixtures"],
    ],
    [1.7, 5.2, 8.1],
    first_bold=True,
)

h2("9.4 保存与一致性")
bullet("每次状态变化后 800ms 防抖 PUT /api/state，整份 JSON 覆盖；AI 小结 hydrate 回来的新里程碑同样落库。")
bullet("启动时先 GET /api/auth/me，成功拿到 state 才渲染业务页面，不会先闪一帧假数据。")
bullet("保存失败每 8 秒最多提示一次，避免离线时刷屏。")
bullet("当前是「最后写入获胜」，没有记录级版本号或冲突合并；同一账号串行使用是前提。")

h2("9.5 错误与日志")
bullet("400 参数不合法；401 未登录 / 密码错误；409 邮箱已注册；503 db_unavailable（MySQL 未启动）。")
bullet("每个请求带 8 位 rid；控制台与 backend/logs/nestory.log 同时记录，按天切分保留 14 天。")
bullet("日志每 2 秒 flush + fsync；≥1500ms 标 slow；4xx WARNING、5xx ERROR；未捕获异常写完整 traceback。")
bullet("不记录密码、会话令牌、Cookie 与 AppState 内容；失败登录的邮箱打码。")

h2("9.6 部署形态")
para(
    "前端 Vite dev / preview（5178 / 5179），/api 代理到 127.0.0.1:8000；"
    "后端为 Python 标准库 HTTP 服务 + 本机 MySQL。Windows 可双击 backend/start_server.bat，"
    "脚本会确保 3306 在监听并打印模型探测结果。"
)

h2("9.7 与 V1.0 技术方案的差异")
table(
    ["V1.0 规划", "V3.0 实际", "原因"],
    [
        ["Supabase PostgreSQL", "本机 MySQL 8 + 三张表", "单机即可交付，不依赖外部账号与网络"],
        ["Supabase Auth", "自建 Cookie 会话 + PBKDF2", "完全可控，便于审计与本地演示"],
        ["Supabase Storage", "浏览器 IndexedDB + 静态资源", "照片不离开本机，降低隐私与成本风险"],
        ["Capacitor Android", "移动优先 Web", "先把产品与交互做实，原生壳延后"],
        ["localStorage", "MySQL + IndexedDB", "换浏览器 / 重新登录不丢记录"],
        ["四 Tab：首页 / 成长记录 / 相册 / 我的", "首页 / 成长 / 相册 / 我的 + 5 个二级页", "顶部 Tab 只放长期入口，录入与设置下沉"],
    ],
    [4.0, 5.6, 5.4],
)

# ---------- 10 ----------
h1("十、AI 能力")
para(
    "AI 的定位是「把已经发生的事实写得好一点」，不是预测、评估或建议。"
    "四个入口都把当前整份 AppState POST 给后端，后端只提取需要的统计事实。"
)
table(
    ["页面", "入口", "端点", "返回"],
    [
        ["首页", "每日一句", "POST /api/daily-quote", "{ text, occasion, label }"],
        ["首页", "AI 小结", "POST /api/ai/summary", "追加 milestone 后的完整 AppState"],
        ["成长", "AI 成长分析", "POST /api/ai/analysis", "{ headline, points[3], tips[2] }"],
        ["相册", "AI 相册故事", "POST /api/ai/story", "{ title, body }"],
    ],
    [1.6, 3.0, 4.8, 5.6],
    first_bold=True,
)
bullet("每日一句：22 字内、只写一个画面；生日 / 满月 / 百天 / 半岁 / 节日带 label；前端按「宝宝 + 日期」缓存，后端再按天缓存。")
bullet("小结：把当天喂养 / 睡眠 / 尿布 / 体重压成几行事实，要求模型返回 { title, note }，再追加为里程碑。")
bullet("成长分析：统计近 7 天喂养次数、瓶喂量、睡眠段与夜觉、尿布、体重变化与里程碑，要求「说趋势、不报数字」。")
bullet("相册故事：照片数量、跨度与标题写成 2–3 句，禁止编造照片里没有的细节。")
para(
    "输入边界：只发送派生事实（次数、时长、毫升、体重、标题），"
    "不发送照片像素、邮箱、密码或会话令牌。"
)
para(
    "兜底：公网不通、限流（402 / 429）、超时或返回非 JSON 时，后端自动用本地规则生成，"
    "provider 标 local，请求一定成功；前端等待 3–40 秒期间播放呼吸动画，页面不阻塞。"
)
para(
    "配置：backend/llm.env 支持任意 OpenAI 兼容服务；默认使用 Pollinations 免费接口，"
    "无需 Key；改完需重启后端。"
)

# ---------- 11 ----------
h1("十一、非功能要求")

h2("11.1 性能")
table(
    ["指标", "结果"],
    [
        ["生产构建", "约 1.6s；JS 366.3 kB / gzip 111.4 kB；CSS 256.6 kB / gzip 77.3 kB"],
        ["运行时依赖", "React + ReactDOM，无 UI 框架、无图标库、无 CSS 框架"],
        ["首屏", "460px 手机画布；主视觉 clamp(340px, 52dvh, 500px)；快捷区不被 TabBar 遮挡"],
        ["动效", "轮播 6s；按钮按下 96.5%、松手回弹；减少动效时不播放"],
        ["横向溢出", "320 / 360 / 375 / 390 / 430 宽均无横向滚动"],
    ],
    [3.2, 11.8],
    first_bold=True,
)

h2("11.2 兼容性")
bullet("目标浏览器：Chrome / Edge 最新版；Safari 需支持 IndexedDB 与 MediaRecorder。")
bullet("HEVC 视频在 Chrome 不可播放；Live 依赖浏览器对短视频的编解码能力。")
bullet("桌面端 ≥720px 居中画布，移动端全宽；未做平板与横屏专项适配。")

h2("11.3 离线与可用性（未达 V1.0 目标）")
bullet("本版是在线优先：后端未启动时停在引导层，提示运行 backend/server.py 并提供重试；不能离线写入。")
bullet("已缓存内容：字体、静态示例图与本地偏好（localStorage）；业务数据必须连 MySQL。")
bullet("V1.0 规划的「离线记录 + 恢复网络自动同步 + 冲突处理」未实现，列入 V3.1。")

h2("11.4 安全")
bullet("本机监听 127.0.0.1；开发直接使用 HTTP，未配置 TLS。")
bullet("无限流、无验证码、无登录锁定；不得直接暴露到公网。")
bullet("依赖 PyMySQL 连接 MySQL；所有 SQL 使用参数化查询。")
bullet("重要操作二次确认：删除记录、删除照片、恢复示例数据、移出成员。")

h2("11.5 隐私")
bullet("默认不公开：没有公开分享链接、没有社交 feed、没有第三方统计 SDK。")
bullet("照片与视频默认只在本机浏览器与账号状态中；导出 JSON 含照片索引与标题，不含视频二进制。")
bullet("AI 只接收统计事实与照片标题，不接收照片像素；隐私政策需说明第三方模型服务。")
bullet("未实现账号注销 / 数据删除入口；当前可通过「恢复示例数据」清空记录，或直接删除数据库中的账号行。")

h2("11.6 可访问性与可读性")
bullet("支持 prefers-reduced-motion、焦点样式、aria-label 与键盘操作（抽屉 Esc、全屏方向键）。")
bullet("字号四档（小 / 标准 / 大 / 特大），通过 --type-scale 放大文字，不缩放布局。")
bullet("触控目标不小于 44px；底部操作条预留安全区。")
bullet("尚未跑完整 axe 审计与低端设备专项测试。")

h2("11.7 备份与迁移")
bullet("设置页导出 JSON（记录、成长、照片索引），文件名 nestory-<时间>.json。")
bullet("恢复示例数据会用 fixtures 重建当前账号，操作前提示先导出。")
bullet("数据库迁移：改 backend/db.py 与 accounts.py；前端契约不变。")

# ---------- 12 ----------
h1("十二、视觉与体验规范")

h2("12.1 品牌内核")
para(
    "Nest + Story：巢是家最朴素的样子，故事是成长留下的形状。四个关键词：温暖但不幼稚、"
    "精致但不浮夸、现代有品质感、可以长期使用。"
)

h2("12.2 颜色")
table(
    ["Token", "色值", "用途"],
    [
        ["--forest", "#304B3B", "主色：CTA、标题、Tab 激活"],
        ["--champagne", "#D7C6A4", "强调：纪念日、关键数字"],
        ["--ivory", "#F9F7F1", "页面底色"],
        ["--ivory-raised", "#FFFDF8", "卡片、抽屉"],
        ["--sage", "#B8C3B1", "图表、面积、叶"],
        ["--ink", "#303B34", "正文"],
        ["--ink-2", "#5F6D63", "次级正文"],
        ["--danger", "#A4553F", "删除、警示"],
    ],
    [4.0, 3.0, 8.0],
    first_bold=True,
)
para(
    "页面约 80% 是象牙白与留白，15% 森林绿承载结构，5% 香槟金只做强调；"
    "不用纯黑纯白，不用大面积渐变。"
)

h2("12.3 字体与图标")
bullet("品牌字标与数据：Fraunces；中文标题：Noto Serif SC；正文：Inter + Noto Sans SC。")
bullet("38 枚实心双色图标，24×24 网格，主体 currentColor，最多一处香槟强调；禁止线稿、Emoji 与混用。")
bullet("数字使用衬线体，让次数、毫升、体重与计时有仪式感。")

h2("12.4 版式与语气")
bullet("460px 手机画布；左右留白 22px；卡片圆角 8–28px；阴影只用于浮层。")
bullet("顶级 Tab 页不放返回箭头；二级页返回按来源决定。")
bullet("称呼用「你」；数字与单位之间留空格（120 ml、5.6 kg、3 个月 11 天）；不用感叹号堆叠与营销词。")
bullet("提醒文案明确「只是辅助」；删除文案说明影响，而不是只问「确定吗」。")

h2("12.5 动效与反馈")
bullet("轮播 6 秒；手动操作暂停 10 秒。")
bullet("按钮 pointerdown 缩到 96.5%，松手回弹；主按钮散开一圈淡香槟描边。")
bullet("拖动超过 10px 或系统开启减少动效时不播放。")

# ---------- 13 ----------
h1("十三、版本规划")

h2("13.1 已交付：V3.0（2026-11-12）")
bullet("移动优先 Web + MySQL 持久化 + 注册登录 + 整份状态自动保存。")
bullet("喂养 / 睡眠 / 尿布 / 生长 / 相册 / 首页 / 提醒 / 设置 / 关于完整页面。")
bullet("四个 AI 入口与本地兜底。")
bullet("品牌 V3.0、38 枚图标、自托管字体、响应式画布。")
bullet("220 项端到端检查 + 34 条单元断言。")

h2("13.2 后续版本")
table(
    ["版本", "主题", "主要内容"],
    [
        ["V3.1", "云与协同", "公网部署、HTTPS、限流；多设备同步；邀请成员加入同一宝宝；记录级 API 与幂等；冲突合并"],
        ["V3.2", "原生与通知", "Capacitor 壳、APK / AAB；本地通知调度与重启恢复；相册写入权限；EXIF 拍摄时间"],
        ["V3.3", "成长与内容", "疫苗 / 体检记录与提醒；WHO 百分位参考（标注来源）；月度报告；多宝宝"],
        ["V4.0", "商业化", "会员、云端照片扩容、高级报告、iOS 上架、长期归档"],
    ],
    [1.8, 3.2, 10.0],
    first_bold=True,
)

h2("13.3 与 V1.0 规划的关系")
para(
    "V1.0 的 P0 功能（档案、喂养、统计、间隔、提醒、睡眠、尿布、生长、相册、时间轴、"
    "本地保存）已在 V3.0 实现；Supabase 云端同步、Capacitor APK 与系统通知调整到 "
    "V3.1 / V3.2；疫苗提醒、WHO 曲线、多宝宝与会员仍在路线图中。"
)

# ---------- 14 ----------
h1("十四、验收标准与结果")

h2("14.1 自动化验收")
table(
    ["检查", "结果"],
    [
        ["TypeScript tsc --noEmit", "通过，无类型错误"],
        ["生产构建 npm run build", "通过（约 1.6s，体积见 11.1）"],
        ["单元测试 npm test", "7 个用例 / 34 条断言通过：月龄、跨午夜间隔、统计、编辑删除重算、睡眠裁剪、纪念日"],
        ["首页轮播", "27/27：自动轮播、指示点、点击切换、真实左滑、竖滑不锁页、无横向溢出、四宫格与恢复默认"],
        ["多尺寸首屏", "15/15：320×568、360×640、375×667、390×844、430×932"],
        ["按钮动效", "11/11：按下压缩、松手回弹、键盘触发、拖动不回弹、减少动效、禁用"],
        ["睡眠记录", "13/13：六格摘要、跨夜 8 小时、同日顺序、未来时间拦截"],
        ["主流程", "42/42：两种喂奶入口、快速记录回首页、喂养中心无表单、计时保存、刷新持久化、编辑、删除确认"],
        ["登录注册", "7/7：注册进入首页、刷新保持、退出、错误密码、再次登录恢复数据"],
        ["自动保存", "5/5：修改 2 秒内写库、刷新与重新登录仍是新值"],
        ["我的家庭", "19/19：编辑资料、刷新持久化、移出成员、返回路径"],
        ["设置与权限", "26/26：字体档位、减少动效、存储数值、权限修改、最后管理员保护、头像上传"],
        ["成长 / 相册布局", "22/22：无返回箭头、左对齐标题、最新测量卡、五列表格、睡眠 / 尿布切换、月份筛选"],
        ["相册媒体", "20/20：Live 封面、六种入口、capture、视频海报与时长、IndexedDB、刷新后播放"],
        ["相册全屏", "13/13：从 2/6 开始、左右滑动、视频切换、方向键、Esc、首尾循环"],
    ],
    [4.6, 10.4],
    first_bold=True,
)

h2("14.2 核心验收清单")
table(
    ["验收项", "通过条件", "结果"],
    [
        ["宝宝档案", "能创建、修改、查看，月龄按真实日历", "通过"],
        ["喂养记录", "三种方式均可记录，字段独立", "通过"],
        ["喂养计时", "左右侧计时、暂停、继续、结束", "通过"],
        ["喂养统计", "次数、毫升数、平均间隔正确", "通过"],
        ["喂养间隔", "跨午夜与补录计算正确", "通过"],
        ["历史修改", "修改 / 删除后统计立即重算", "通过"],
        ["喂养提醒", "新记录后下次时间重算，应用内可见", "通过"],
        ["睡眠记录", "开始、结束、跨夜、统计正常", "通过"],
        ["尿布记录", "类型与次数统计正常", "通过"],
        ["成长记录", "体重、身长、头围可追溯", "通过"],
        ["电子相册", "照片、视频、Live 可添加与查看", "通过"],
        ["时间轴", "按时间正确排序，纪念日可见", "通过"],
        ["离线记录", "无网络可暂存并恢复同步", "未通过（在线优先）"],
        ["数据同步", "刷新 / 重新登录 / 换浏览器不丢", "部分通过（单机服务端）"],
        ["家庭数据隔离", "不同账号不能互相访问", "通过"],
        ["安全测试", "未授权用户不能访问私有数据", "部分通过（限本机、无限流）"],
        ["Android APK", "能生成 APK 并在真机安装", "未交付"],
        ["回归测试", "核心功能修改后仍通过", "通过（220 项 e2e）"],
    ],
    [3.2, 8.8, 3.0],
    first_bold=True,
)

h2("14.3 判定口径")
para(
    "「通过」= 自动化脚本或可复现手动步骤已覆盖；「部分通过」= 实现了目标能力但边界不同"
    "（如隔离到账号而非家庭空间）；「未通过 / 未交付」= 不计入 V3.0 验收，列入后续版本。"
)

# ---------- 15 ----------
h1("十五、交付物")
table(
    ["交付物", "位置", "状态"],
    [
        ["前端源代码", "src/", "已交付"],
        ["本地后端", "backend/", "已交付"],
        ["打包源码", "Nestory-V3.0-source.zip", "已交付"],
        ["产品文档", "README.md、BRAND.md、AUDIT.md、本文档", "已交付"],
        ["后端说明", "backend/README.md", "已交付"],
        ["建库脚本", "backend/setup_mysql.py", "已交付"],
        ["单元测试", "src/lib/*.test.ts（Vitest）", "已交付"],
        ["端到端脚本", "_e2e*.mjs、_shot*.mjs", "已交付"],
        ["截图", "shots/", "已交付"],
        ["品牌资产", "public/brand/、_brand/", "已交付"],
        ["数据库迁移 / RLS", "—", "不适用（方案改为 MySQL）"],
        ["Android APK / AAB", "—", "未交付"],
        ["iOS 构建配置", "—", "未交付"],
        ["隐私政策 / 用户协议", "应用内初稿", "已交付（初稿）"],
        ["GitHub 仓库", "—", "未初始化 / 未推送"],
    ],
    [4.0, 7.4, 3.6],
    first_bold=True,
)

# ---------- 16 ----------
h1("十六、已知限制与风险")

h2("16.1 已知限制")
numbered([
    "单机：只监听 127.0.0.1，无 TLS、无限流、无验证码，不能直接公网部署。",
    "整体读写：AppState 以整份 JSON 保存，记录变多后体积线性增长；没有记录级写接口与幂等。",
    "在线优先：后端停机时不能离线记录；网络恢复后也没有本地队列可同步。",
    "提醒不触发：只有应用内提示与时间预览，没有系统通知调度。",
    "媒体在本机：照片 / 视频存浏览器 IndexedDB，清理站点数据会丢失；导出 JSON 不含视频。",
    "Live 不是系统级 Live Photo：需要选择导出的短片，网页截首帧作封面。",
    "无 EXIF：拍摄时间取文件修改时间，可手动改。",
    "单家庭：家庭是账号内成员列表，多账号共享未实现；多人同时编辑会最后写入获胜。",
    "仅中文：英文只出现在品牌词与眉标，没有 i18n。",
    "无障碍未审计：有焦点样式、aria 与减少动效，但未跑完整 axe 与低端设备测试。",
    "无账号注销：没有删除账号与关联数据的入口 / 接口。",
])

h2("16.2 风险与对策")
table(
    ["风险", "影响", "当前对策"],
    [
        ["浏览器清缓存 / 换设备", "照片与视频丢失", "提示导出 JSON；媒体迁移列入 V3.1"],
        ["公网暴露", "会话与数据泄露", "只监听本机；公网部署前必须补 TLS、限流与审计"],
        ["AI 第三方", "事实数据离开本机", "只发统计与标题；提供本地兜底；隐私政策说明"],
        ["整份 JSON 增长", "保存变慢、请求体变大", "记录上千条后拆记录表；接口契约保持"],
        ["单文件维护", "页面逻辑集中", "配置 / 业务 / 页面分层；后续按记录拆模块"],
    ],
    [3.6, 5.2, 6.2],
    first_bold=True,
)

# ---------- appendix ----------
h1("附录 A　术语")
table(
    ["术语", "说明"],
    [
        ["AppState", "前端与后端共用的整份家庭状态，版本 3"],
        ["viewerId", "当前登录家庭成员 id，用于解析记录作者"],
        ["亲喂", "母乳直接喂养，只计时长，不换算毫升"],
        ["瓶喂", "母乳装瓶喂养，记录 bottleMl"],
        ["配方奶", "配方奶粉喂养，记录 formulaMl"],
        ["月龄", "按真实日历月计算的年龄，月末 clamp"],
        ["rid", "每个 HTTP 请求的 8 位追踪 id"],
        ["fixtures", "新账号的初始示例数据"],
    ],
    [3.4, 11.6],
    first_bold=True,
)

h1("附录 B　常用命令")
cmds = [
    "npm install                 # 安装前端依赖",
    "npm run dev                 # 前端 http://localhost:5178",
    "npm test                    # Vitest 单元测试",
    "npm run build               # tsc -b + vite build",
    "",
    "python -m pip install PyMySQL",
    "python backend/setup_mysql.py   # 首次：建库、账号、三张表",
    "python backend/server.py        # 后端 http://127.0.0.1:8000",
    "backend\\start_server.bat       # Windows 一键启动（含 MySQL 检查）",
]
for line in cmds:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.55
    p.paragraph_format.left_indent = Cm(0.3)
    if line:
        r = p.add_run(line)
        style_run(r, size=8.8, mono=True, color=INK)
    else:
        r = p.add_run(" ")
        style_run(r, size=4, mono=True)
para("", size=3, after=2)

h1("附录 C　章节与代码索引")
table(
    ["章节", "代码位置"],
    [
        ["4.1 宝宝档案", "src/pages/Profile.tsx、src/lib/date.ts"],
        ["4.2–4.3 喂养", "src/pages/Feed.tsx、src/lib/stats.ts"],
        ["4.5–4.6 睡眠 / 尿布", "src/components/QuickSheets.tsx、src/pages/Growth.tsx"],
        ["4.7 生长", "src/pages/Growth.tsx"],
        ["4.8 纪念日", "src/lib/date.ts、backend/quote.py"],
        ["五 相册", "src/pages/Album.tsx、src/lib/media.ts"],
        ["六 首页", "src/pages/Home.tsx"],
        ["八 账号", "backend/accounts.py、backend/auth.py、src/components/AuthScreen.tsx"],
        ["九 数据", "src/data/types.ts、backend/db.py、backend/server.py"],
        ["十 AI", "backend/llm.py、backend/ai_insights.py、backend/quote.py"],
        ["十一 非功能", "vite.config.ts、src/styles/tokens.css"],
    ],
    [4.4, 10.6],
    first_bold=True,
)

h1("附录 D　文档变更记录")
table(
    ["版本", "日期", "变更"],
    [
        ["V1.0", "2026-11-11", "初稿：Supabase + Capacitor 方案，四 Tab，P0 功能与验收标准"],
        ["V3.0", "2026-11-12", "交付对齐：技术架构改为 React + Vite + Python + MySQL；导航与页面按实现更新；新增 AI 四入口、账号会话、品牌规范、自动化验收与已知限制；未交付能力明确标注"],
    ],
    [2.2, 3.0, 9.8],
    first_bold=True,
)


# ---------- colophon ----------
para("", size=10, after=0)
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(300)
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.line_spacing = 1.2
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("N E S T O R Y")
style_run(r, size=9, bold=True, color=CHAMPAGNE)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(10)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("把日子收好，把故事留下。")
style_run(r, size=15, bold=True, color=FOREST)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(4)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Nestory 产品需求文档 · V3.0 · 2026-11-12")
style_run(r, size=8.5, color=INK3)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("— 全文完 —")
style_run(r, size=8.5, color=INK3)

# ---------- properties ----------
cp = doc.core_properties
cp.title = "Nestory 产品需求文档 V3.0"
cp.subject = "Nestory（小宝成长记）最终交付版产品需求文档"
cp.author = "Nestory 产品组"
cp.last_modified_by = "Nestory 产品组"
cp.category = "PRD"
cp.comments = "V3.0 交付对齐版，取代 V1.0。"
cp.created = datetime.datetime(2026, 11, 12, 9, 0, 0)
cp.modified = datetime.datetime(2026, 11, 12, 13, 40, 0)
cp.revision = 3

# page fields are recalculated by Word / LibreOffice on render
doc.save(OUT)
print("saved", OUT)
