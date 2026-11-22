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


def index(card, rank, suit, box=None):
    """隅の数字とマーク（左上・右下）。box があれば その中に 収める（絵札：絵に かからないように）"""
    d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    txt = LABEL.get(rank, str(rank))
    size = 300 if len(txt) == 1 else 220
    x0, y0, eh, gap, line = 158, 62, 150, 28, 210
    if box:
        bx0, by0, bx1, by1 = box
        bh, bw = by1 - by0, bx1 - bx0
        line = int(bh * 0.52)
        eh = int(bh * 0.38)
        gap = int(bh * 0.06)
        x0, y0 = (bx0 + bx1) / 2, by0
        size = 10
        while True:  # 文字の高さを line に 合わせる
            f2 = ImageFont.truetype(FONT, size + 4)
            b2 = dr.textbbox((0, 0), txt, font=f2)
            if b2[3] - b2[1] > line or b2[2] - b2[0] > bw * 0.95:
                break
            size += 4
    f = ImageFont.truetype(FONT, size)
    bb = dr.textbbox((0, 0), txt, font=f)
    tw = bb[2] - bb[0]
    dr.text((x0 - tw / 2 - bb[0], y0 - bb[1]), txt, font=f, fill=SUITS[suit] + (255,), stroke_width=4, stroke_fill=(120, 86, 20, 255))
    th = bb[3] - bb[1]
    corner = d
    e = EMB[suit]
    ew = int(e.width * eh / e.height)
    corner.alpha_composite(e.resize((ew, eh), Image.LANCZOS), (int(x0 - ew / 2), int(y0 + max(th, line) + gap)))
    card.alpha_composite(corner)
    card.alpha_composite(corner.rotate(180))


def face_card(path, suit):
    """絵札：隅の大きなマークを 紙の色で消して、ほかのカードと同じ 隅の数字を入れられるようにする"""
    im = Image.open(path).convert('RGBA').resize((W, H), Image.LANCZOS)
    a = np.asarray(im.convert('RGB')).astype(int)
    box = None
    for flip in (False, True):
        b = a[::-1, ::-1] if flip else a
        x0, y0, x1, y1 = 78, 98, 380, 470
        reg = b[y0:y1, x0:x1]
        light = reg.sum(-1) > 600
        bg = np.median(reg[light], axis=0)
        ink = np.sqrt(((reg - bg) ** 2).sum(-1)) > 70
        # 細いつながり（花の茎など）を切って、塗りつぶしの マークだけ 取り出す
        solid = ndimage.binary_opening(ink, iterations=9)
        lab, n = ndimage.label(solid)
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        k = 1 + int(np.argmax(sizes))
        main = lab == k
        if suit in ('S', 'C'):
            # スペード・クローバーは 足（茎と下の三角）も 消す：マークの真下の 細い帯の中の インク
            ys, xs = np.where(main)
            cx, bottom = int(xs.mean()), int(ys.max())
            foot = np.zeros_like(ink)
            foot[max(0, bottom - 40):min(ink.shape[0], bottom + 70), max(0, cx - 60):cx + 60] = True
            fl, fn = ndimage.label(ink & foot)
            for j in range(1, fn + 1):
                jy, jx = np.where(fl == j)
                if abs(jx.mean() - cx) < 50:
                    main |= fl == j
        mark = ndimage.binary_dilation(main, iterations=9 + 16) & ndimage.binary_dilation(ink, iterations=3)
        mark = ndimage.binary_dilation(mark, iterations=4)
        full = np.zeros((H, W), bool)
        full[y0:y1, x0:x1] = mark
        if not flip:
            # 消したマークの場所（ここに 隅の数字を入れる）
            ys, xs = np.where(ndimage.binary_dilation(main, iterations=6))
            box = (xs.min() + x0, ys.min() + y0, xs.max() + x0, ys.max() + y0)
        m = Image.fromarray((full * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
        if flip:
            m = m.rotate(180)
        fill = Image.new('RGBA', (W, H), tuple(int(v) for v in bg) + (255,))
        im = Image.composite(fill, im, m)
        a = np.asarray(im.convert('RGB')).astype(int)
    return im, box


def save(card, name):
    card.convert('RGB').resize((OUT_W, int(OUT_W * H / W)), Image.LANCZOS).save(f'{OUT}/{name}.webp', quality=86)


base = Image.open(f'{SRC}/base.png').convert('RGBA')
for s in SUITS:
    a = Image.open(f'{SRC}/{s}1.png').convert('RGBA')
    # A は 枠の金の飾りが大きいので、飾りの内側・紋章の上の すき間に 収める
    index(a, 1, s, (92, 178, 272, 396))
    save(a, f'{s}1')
    for n in range(2, 11):
        card = base.copy()
        ph = 200 if n <= 3 else 175 if n <= 8 else 155
        for cx, cy in rows(n):
            paste_emblem(card, s, cx * W, cy * H, ph)
        index(card, n, s)
        save(card, f'{s}{n}')
    for r in (11, 12, 13):
        import os
        if os.path.exists(f'{SRC}/{s}{r}.png'):
            card, box = face_card(f'{SRC}/{s}{r}.png', s)
            index(card, r, s, box)
            save(card, f'{s}{r}')
            continue
        # 【仮】J・Q・K：絵が届くまで
        card = base.copy()
        paste_emblem(card, s, W / 2, H * 0.6, 420)
        d = ImageDraw.Draw(card)
        f = ImageFont.truetype(FONT, 420)
        t = LABEL[r]
        bb = d.textbbox((0, 0), t, font=f)
        d.text((W / 2 - (bb[2] + bb[0]) / 2, H * 0.30 - (bb[3] + bb[1]) / 2), t, font=f, fill=(196, 150, 40, 255), stroke_width=10, stroke_fill=(90, 62, 10, 255))
        index(card, r, s)
        save(card, f'{s}{r}')
# ジョーカー（依頼者の絵）：隅に たてに JOKER
jk = Image.open(f'{SRC}/JK.png').convert('RGBA').resize((W, H), Image.LANCZOS)
d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dr = ImageDraw.Draw(d)
# 杖や体に かからないよう、左の すき間に 小さめに
f = ImageFont.truetype(FONT, 84)
y = 268
for ch in 'JOKER':
    bb = dr.textbbox((0, 0), ch, font=f)
    dr.text((76 - (bb[0] + bb[2]) / 2, y - bb[1]), ch, font=f, fill=RED + (255,), stroke_width=4, stroke_fill=(250, 236, 205, 255))
    y += (bb[3] - bb[1]) + 14
jk.alpha_composite(d)
jk.alpha_composite(d.rotate(180))
save(jk, 'JK')
back = Image.open(f'{SRC}/back.png').convert('RGBA')
save(back, 'back')
print('ok')
