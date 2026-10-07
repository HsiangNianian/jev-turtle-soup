from pathlib import Path
from html import escape
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[2]
serif = TTFont(root / 'ios/TurtleSoup/Fonts/NotoSerifSC-Regular.otf')
bold = TTFont(root / 'ios/TurtleSoup/Fonts/NotoSerifSC-SemiBold.otf')
mono = TTFont(root / 'ios/TurtleSoup/Fonts/JetBrainsMono-Regular.ttf')

def lettering(content, x, y, size, color, font=serif, tracking=0):
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    pen = SVGPathPen(glyphs, ntos=lambda n: format(n, ".2f").rstrip("0").rstrip(".") if n else "0")
    for char in content:
        glyph = glyphs[cmap[ord(char)]]
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, y)))
        x += glyph.width * scale + tracking
    return f'<path fill="{color}" d="{pen.getCommands()}"/><!-- {escape(content)} -->'

out = root / 'docs/readme'
out.mkdir(exist_ok=True)
for dark in (False, True):
    bg, sheet, ink, muted, red, rule = ('#14130f','#1f1d18','#ece7db','#a8a191','#e0736a','#49453b') if dark else ('#f2efe6','#fbf9f3','#17150f','#716b5d','#b5342a','#cdc6b6')
    pieces = [f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" role="img" aria-labelledby="title desc">
<title id="title">海龟汤调查局 · Turtle Soup Investigation Bureau</title>
<desc id="desc">每一碗怪事，都等你来问。原创故事、单人推理与朋友同桌。右侧是一张等待解答的纸面案卷。</desc>
<!-- Static artwork. Lettering outlined from the project's OFL-licensed Noto Serif SC and JetBrains Mono fonts. -->
<rect width="1200" height="420" fill="{bg}"/>
<path d="M56 37h44M56 342h1088" stroke="{red}" stroke-width="2"/>
<path d="M653 62v237" stroke="{rule}"/>
''']
    pieces += [lettering('TURTLE SOUP / INVESTIGATION BUREAU',56,73,13,muted,mono,0.5), lettering('海龟汤调查局',51,186,82,ink,bold), lettering('每一碗怪事，都等你来问。',56,245,26,ink), lettering('STORIES BY PEOPLE. CLUES WITH FRIENDS.',56,286,12,muted,mono,0.2)]
    pieces += [f'<g transform="rotate(2 899 185)"><path d="M707 73h115l13 17h296v231H707z" fill="none" stroke="{rule}"/></g>',f'<path d="M704 66h119l14 17h300v231H704z" fill="{sheet}" stroke="{rule}"/>',f'<path d="M704 135h433M734 211h246M734 246h221" stroke="{rule}"/>']
    pieces += [lettering('案卷 / 待解',734,118,17,red), lettering('她每天都收到一封没有字的信。',734,177,19,ink), lettering('直到某天，信不再来了。',734,200,16,muted)]
    for i,(label,color) in enumerate([('是', '#7fb98f' if dark else '#2f6b4f'),('否',red),('半','#d8ae62' if dark else '#a8791f')]):
        x=734+i*61
        pieces += [f'<rect x="{x}" y="265" width="40" height="30" fill="none" stroke="{color}"/>',lettering(label,x+12,287,17,color)]
    pieces += [f'<g transform="rotate(-10 1040 266)"><rect x="988" y="228" width="111" height="70" fill="{sheet}" stroke="{red}" stroke-width="3"/><rect x="994" y="234" width="99" height="58" fill="none" stroke="{red}"/>',lettering('等你来问',1002,270,20,red,bold),'</g>']
    pieces += [lettering('原创故事',56,381,17,muted),lettering('单人推理',240,381,17,muted),lettering('2–6 人同桌',424,381,17,muted),lettering('WEB / iOS / ANDROID',947,381,13,muted,mono)]
    pieces += [f'<path d="M198 366v17M382 366v17" stroke="{rule}"/>','</svg>']
    (out / ('banner-dark.svg' if dark else 'banner.svg')).write_text('\n'.join(pieces))
print('Generated light and dark README banners')
