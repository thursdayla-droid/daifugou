"""カードの絵を作る（依頼者の絵 design/cards/ から）。
- A・裏：そのまま縮小 ＋ 隅の数字
- 2〜10：土台(base) に Aの紋章を 並べる ＋ 隅の数字
- J・Q・K：絵が届くまで【仮】土台 ＋ 大きな文字と紋章
使い方: python3 tools/make_cards.py フォントファイル(ttf)
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage

SRC = 'design/cards'
OUT = 'src/assets/cards'
W, H = 1024, 1536
OUT_W = 320
FONT = sys.argv[1]
RED = (178, 18, 38)
BLACK = (22, 18, 14)
SUITS = {'S': BLACK, 'H': RED, 'D': RED, 'C': BLACK}
LABEL = {1: 'A', 11: 'J', 12: 'Q', 13: 'K'}


def emblem(suit):
    im = Image.open(f'{SRC}/{suit}1.png').convert('RGB')
    a = np.asarray(im).astype(int)
    bg = np.array([251, 228, 185])
    # 枠の装飾を避けて 真ん中だけ見る
    region = np.zeros(a.shape[:2], bool)
    region[180:1330, 100:924] = True
    diff = np.sqrt(((a - bg) ** 2).sum(-1))
    m = (diff > 55) & region
    m = ndimage.binary_closing(m, iterations=3)
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    m = lab == (1 + int(np.argmax(sizes)))
    m = ndimage.binary_fill_holes(m)
    ys, xs = np.where(m)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    rgba = im.copy()
    rgba.putalpha(alpha)
    return rgba.crop(box)


EMB = {s: emblem(s) for s in SUITS}

# 2〜10 の 紋章の位置（カードの中の 0〜1）
COLS = {1: [0.5], 2: [0.33, 0.67]}
L, C, R = 0.365, 0.5, 0.635
T, B = 0.235, 0.765


def rows(n):
    y = lambda k, m: T + (B - T) * k / (m - 1)
    if n == 2: return [(C, T), (C, B)]
    if n == 3: return [(C, T), (C, 0.5), (C, B)]
    if n == 4: return [(L, T), (R, T), (L, B), (R, B)]
    if n == 5: return rows(4) + [(C, 0.5)]
    if n == 6: return rows(4) + [(L, 0.5), (R, 0.5)]
    if n == 7: return rows(6) + [(C, (T + 0.5) / 2)]
    if n == 8: return rows(6) + [(C, (T + 0.5) / 2), (C, (B + 0.5) / 2)]
    if n == 9: return [(x, y(k, 4)) for x in (L, R) for k in range(4)] + [(C, 0.5)]
    if n == 10: return [(x, y(k, 4)) for x in (L, R) for k in range(4)] + [(C, T + (B - T) / 6), (C, B - (B - T) / 6)]


def paste_emblem(card, suit, cx, cy, h):
    e = EMB[suit]
    w = int(e.width * h / e.height)
    e2 = e.resize((w, int(h)), Image.LANCZOS)
    if cy > 0.5 * H + 1:
        e2 = e2.rotate(180)
    card.alpha_composite(e2, (int(cx - w / 2), int(cy - h / 2)))


def index(card, rank, suit):
    """隅の数字とマーク（左上・右下）"""
    d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    txt = LABEL.get(rank, str(rank))
    size = 300 if len(txt) == 1 else 220
    f = ImageFont.truetype(FONT, size)
    x0, y0 = 158, 62
    bb = dr.textbbox((0, 0), txt, font=f)
    tw = bb[2] - bb[0]
    dr.text((x0 - tw / 2 - bb[0], y0 - bb[1]), txt, font=f, fill=SUITS[suit] + (255,), stroke_width=4, stroke_fill=(120, 86, 20, 255))
    th = bb[3] - bb[1]
    corner = d
    e = EMB[suit]
    eh = 150
    ew = int(e.width * eh / e.height)
    corner.alpha_composite(e.resize((ew, eh), Image.LANCZOS), (int(x0 - ew / 2), int(y0 + max(th, 210) + 28)))
    card.alpha_composite(corner)
    card.alpha_composite(corner.rotate(180))


def save(card, name):
    card.convert('RGB').resize((OUT_W, int(OUT_W * H / W)), Image.LANCZOS).save(f'{OUT}/{name}.webp', quality=86)


base = Image.open(f'{SRC}/base.png').convert('RGBA')
for s in SUITS:
    a = Image.open(f'{SRC}/{s}1.png').convert('RGBA')
    index(a, 1, s)
    save(a, f'{s}1')
    for n in range(2, 11):
        card = base.copy()
        ph = 200 if n <= 3 else 175 if n <= 8 else 155
        for cx, cy in rows(n):
            paste_emblem(card, s, cx * W, cy * H, ph)
        index(card, n, s)
        save(card, f'{s}{n}')
    # 【仮】J・Q・K：絵が届くまで
    for r in (11, 12, 13):
        card = base.copy()
        paste_emblem(card, s, W / 2, H * 0.6, 420)
        d = ImageDraw.Draw(card)
        f = ImageFont.truetype(FONT, 420)
        t = LABEL[r]
        bb = d.textbbox((0, 0), t, font=f)
        d.text((W / 2 - (bb[2] + bb[0]) / 2, H * 0.30 - (bb[3] + bb[1]) / 2), t, font=f, fill=(196, 150, 40, 255), stroke_width=10, stroke_fill=(90, 62, 10, 255))
        index(card, r, s)
        save(card, f'{s}{r}')
back = Image.open(f'{SRC}/back.png').convert('RGBA')
save(back, 'back')
print('ok')
