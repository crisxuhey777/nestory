import io, subprocess, os, time

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
base = os.path.abspath("_brand")

def page(name, w, h, body, bg="#F9F7F1"):
    html = f'''<!doctype html><html><head><meta charset="utf-8">
<style>
@font-face {{ font-family: 'Fraunces'; font-style: normal; font-weight: 300 700;
  src: url('../public/fonts/Fraunces/39ce2001bb7c.woff2') format('woff2'); }}
@font-face {{ font-family: 'Inter'; font-style: normal; font-weight: 400 700;
  src: url('../public/fonts/Inter/395290514d97.woff2') format('woff2'); }}
html, body {{ margin: 0; padding: 0; }}
body {{ width: {w}px; height: {h}px; background: {bg}; overflow: hidden; }}
</style></head><body>{body}</body></html>'''
    p = os.path.join(base, name + ".html")
    io.open(p, "w", encoding="utf-8").write(html)
    return p

def mark_img(tone, size):
    return f'<img src="../public/brand/mark{"" if tone=="forest" else "-light"}.svg" width="{size}" height="{size}" style="display:block">'

# App icon
p = page("icon", 1024, 1024, '<img src="../public/brand/app-icon.svg" width="1024" height="1024" style="display:block">', "#304B3B")

# 横向 Logo（浅底）
def lockup(bg, word_color, desc_color, mark_tone):
    return f'''
<div style="height:100%;display:flex;align-items:center;justify-content:center;gap:34px">
  {mark_img(mark_tone, 118)}
  <div>
    <div style="font-family:Fraunces;font-weight:500;font-size:104px;line-height:.92;letter-spacing:-.015em;color:{word_color}">Nestory</div>
    <div style="font-family:Inter;font-weight:500;font-size:12px;letter-spacing:.44em;color:{desc_color};margin-top:16px">FAMILY&nbsp;STORIES</div>
  </div>
</div>'''

page("logo-light", 1200, 460, lockup("#F9F7F1", "#304B3B", "#8B968C", "forest"))
page("logo-dark", 1200, 460, lockup("#304B3B", "#F9F7F1", "#D7C6A4", "light"), "#304B3B")

# 纯字标
page("wordmark", 1200, 420, '''<div style="height:100%;display:flex;align-items:center;justify-content:center">
<div style="font-family:Fraunces;font-weight:500;font-size:190px;line-height:1;letter-spacing:-.02em;color:#304B3B">Nestory</div></div>''')

# 竖版标记预览（浅/深）
page("mark-forest", 420, 420, '<div style="height:100%;display:flex;align-items:center;justify-content:center"><img src="../public/brand/mark.svg" width="260" height="260"></div>')
page("mark-ivory", 420, 420, '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#304B3B"><img src="../public/brand/mark-light.svg" width="260" height="260"></div>', "#304B3B")

jobs = [
    ("icon.html", "public/brand/app-icon-1024.png", 1024, 1024),
    ("logo-light.html", "public/brand/logo-horizontal-light.png", 1200, 460),
    ("logo-dark.html", "public/brand/logo-horizontal-dark.png", 1200, 460),
    ("wordmark.html", "public/brand/wordmark.png", 1200, 420),
    ("mark-forest.html", "public/brand/mark-forest.png", 420, 420),
    ("mark-ivory.html", "public/brand/mark-ivory.png", 420, 420),
]
for html, out, w, h in jobs:
    url = "file:///" + os.path.join(base, html).replace("\\", "/")
    dest = os.path.abspath(out)
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size={w},{h}",
        f"--screenshot={dest}", "--virtual-time-budget=2500", url,
    ], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(out, os.path.getsize(dest) if os.path.exists(dest) else "MISSING")

