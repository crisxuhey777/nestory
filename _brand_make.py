import io, os, subprocess

FOREST = "#304B3B"; IVORY = "#F9F7F1"; CHAMP = "#D7C6A4"; SAGE = "#B8C3B1"; SHADE = "#C3AD85"

def mark(bowl, egg, leaf, vein):
    return f'''<g>
  <path d="M32 9.6c6.4 0 13.2 7.4 13.2 17.6 0 7.4-5.9 13-13.2 13s-13.2-5.6-13.2-13C18.8 17 25.6 9.6 32 9.6Z" fill="{egg}"/>
  <path d="M19.6 29.8c1.4 6 6.4 10.4 12.4 10.4s11-4.4 12.4-10.4c0 4-4.6 7.4-12.4 7.4s-12.4-3.4-12.4-7.4Z" fill="{SHADE}" opacity=".42"/>
  <path d="M6.2 31.2c0-1.5 1.4-2.2 2.8-1.7C16.4 32.2 24 33.8 32 33.8s15.6-1.6 23-4.3c1.4-.5 2.8.2 2.8 1.7 0 0-1.2 11.2-9.8 18-4.4 3.5-10 5.8-16 5.8s-11.6-2.3-16-5.8C7.4 42.4 6.2 31.2 6.2 31.2Z" fill="{bowl}"/>
  <circle cx="6.6" cy="30.9" r="1.6" fill="{bowl}"/>
  <circle cx="57.4" cy="30.9" r="1.6" fill="{bowl}"/>
  <path d="M47.5 31.6C47 24 50.6 16.2 57.4 12.4c1.4-.8 2.8.2 2.4 2-1.4 9-5.8 15.4-12.3 17.2Z" fill="{leaf}"/>
  <path d="M50.2 29.2c2-4.2 4.4-7.4 7.6-10.2" stroke="{vein}" stroke-width=".9" stroke-linecap="round" opacity=".45" fill="none"/>
</g>'''

def svg(w,h,body,bg=None,size=None):
    b=f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{size or w}" height="{size or h}">{b}{body}</svg>'

light = mark(FOREST, CHAMP, SAGE, FOREST)
dark = mark(IVORY, CHAMP, SAGE, FOREST)
io.open("public/brand/mark.svg","w",encoding="utf-8").write(svg(64,64,light))
io.open("public/brand/mark-light.svg","w",encoding="utf-8").write(svg(64,64,dark))
inner=dark
io.open("public/brand/app-icon.svg","w",encoding="utf-8").write(svg(1024,1024,f'<g transform="translate(205 200) scale(9.6)">{inner}</g>',FOREST))
io.open("public/brand/favicon.svg","w",encoding="utf-8").write(svg(64,64,f'<g transform="translate(10 9) scale(0.69)">{inner}</g>',FOREST))

# 预览页：小尺寸测试
os.makedirs("_brand", exist_ok=True)
chart = f'''
<div style="display:flex;align-items:center;gap:40px;padding:60px;background:#F9F7F1">
  <img src="../public/brand/app-icon.svg" width="240" height="240">
  <div style="width:120px;height:120px;border-radius:26px;overflow:hidden"><img src="../public/brand/app-icon.svg" width="120" height="120"></div>
  <div style="width:64px;height:64px;border-radius:15px;overflow:hidden"><img src="../public/brand/app-icon.svg" width="64" height="64"></div>
  <div style="width:32px;height:32px;border-radius:8px;overflow:hidden"><img src="../public/brand/app-icon.svg" width="32" height="32"></div>
</div>'''
html = f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0}}</style></head><body>{chart}</body></html>'
p="_brand/preview.html"
io.open(p,"w",encoding="utf-8").write(html)
subprocess.run([r"C:\Program Files\Google\Chrome\Application\chrome.exe","--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=1","--window-size=860,380","--screenshot="+os.path.abspath("shots/_logo-preview.png"),"--virtual-time-budget=1500","file:///"+os.path.abspath(p).replace("\\","/")],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print("done")
