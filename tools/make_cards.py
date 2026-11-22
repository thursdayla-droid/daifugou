"""カードの絵を作る（2026-11-22 v2：全部のカードを 同じ枠・同じ紙・同じ大きさの数字に そろえる）
- 枠と紙：design/cards/base.png（2〜10 と同じ）
- 紋章：新しいA（design/cards/S1.png など）の マーク。A の真ん中・2〜10 の並び・隅に使う
- J・Q・K・ジョーカー：依頼者の絵から 人物だけ切り出して、枠の中の 金の線の箱に 入れる
- 隅の数字：全カード 同じ大きさ・同じ場所
使い方: python3 tools/make_cards.py フォント.ttf
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
GOLD = (176, 130, 34)
SUITS = {'S': BLACK, 'H': RED, 'D': RED, 'C': BLACK}
LABEL = {1: 'A', 11: 'J', 12: 'Q', 13: 'K'}

# 隅の数字（全カード共通）
# スマホの手札で 読めるように 大きく。手札では 左上しか見えないので 隅の数字は 左上だけ
IDX_X = 150      # 列の まん中
IDX_TOP = 70
IDX_H = 250      # 文字の高さ
IDX_MAXW = 210   # 文字の はば（10 は 横を 細くして 収める）
IDX_EMB = 150    # 小さいマークの高さ
IDX_GAP = 22
COL_R = 262      # 隅の列の 右はし（絵は ここより右）


def emblem(suit):
    """新しいA から マークだけ 取り出す（金のふち ごと）"""
    im = Image.open(f'{SRC}/{suit}1.png').convert('RGB')
    a = np.asarray(im).astype(int)
    region = np.zeros(a.shape[:2], bool)
    region[220:1330, 120:904] = True
    bg = np.median(a[region & (a.sum(-1) > 600)], axis=0)
    diff = np.sqrt(((a - bg) ** 2).sum(-1))
    m = (diff > 40) & region
    m = ndimage.binary_closing(m, iterations=3)
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    m = ndimage.binary_fill_holes(lab == (1 + int(np.argmax(sizes))))
    m = ndimage.binary_dilation(m, iterations=2)
    ys, xs = np.where(m)
    alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
    rgba = im.convert('RGBA')
    rgba.putalpha(alpha)
    return rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


EMB = {s: emblem(s) for s in SUITS}
BASE = Image.open(f'{SRC}/base.png').convert('RGBA').resize((W, H), Image.LANCZOS)
# 2〜10・A は 金の枠なし（2026-11-22 依頼者）：土台の 内側の紙だけを 広げる
PLAIN = BASE.crop((140, 140, W - 140, H - 140)).resize((W, H), Image.LANCZOS)


def put(card, img, cx, cy, h=None, w=None, flip=False):
    if h is None:
        h = img.height * w / img.width
    w = img.width * h / img.height
    e = img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
    if flip:
        e = e.rotate(180)
    card.alpha_composite(e, (int(cx - e.width / 2), int(cy - e.height / 2)))


def index(card, rank, suit):
    d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    txt = LABEL.get(rank, str(rank))
    # 文字の高さは 全部 同じ。はばが 広すぎる時（10）は 横だけ 細くする
    size = 40
    while True:
        f = ImageFont.truetype(FONT, size + 2)
        bb = dr.textbbox((0, 0), 'K', font=f)
        if bb[3] - bb[1] > IDX_H:
            break
        size += 2
    f = ImageFont.truetype(FONT, size)
    bb = dr.textbbox((0, 0), txt, font=f)
    t = Image.new('RGBA', (bb[2] - bb[0] + 8, bb[3] - bb[1] + 8), (0, 0, 0, 0))
    ImageDraw.Draw(t).text((4 - bb[0], 4 - bb[1]), txt, font=f, fill=SUITS[suit] + (255,))
    tw = min(t.width, IDX_MAXW)
    t = t.resize((tw, t.height), Image.LANCZOS)
    d.alpha_composite(t, (int(IDX_X - tw / 2), IDX_TOP - 4))
    put(d, EMB[suit], IDX_X, IDX_TOP + IDX_H + IDX_GAP + IDX_EMB / 2, h=IDX_EMB)
    card.alpha_composite(d)


FACE_BOX = (100, 160, 300, 400)


def index_in_box(card, rank, suit, box):
    """絵札：消したマークの場所（box）に 文字とマーク（左上・右下）"""
    d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    txt = LABEL[rank]
    bx0, by0, bx1, by1 = box
    bh, bw = by1 - by0, bx1 - bx0
    line, eh, gap = int(bh * 0.74), int(bh * 0.24), int(bh * 0.03)
    size = 10
    while True:
        f = ImageFont.truetype(FONT, size + 4)
        # J・Q・K 全部 同じ大きさ（いちばん大きく見える文字に 合わせる）
        too = False
        for t in 'JQK':
            b2 = dr.textbbox((0, 0), t, font=f)
            if b2[3] - b2[1] > line or b2[2] - b2[0] > bw * 1.4:
                too = True
        if too:
            break
        size += 4
    f = ImageFont.truetype(FONT, size)
    bb = dr.textbbox((0, 0), txt, font=f)
    cx = (bx0 + bx1) / 2
    dr.text((cx - (bb[0] + bb[2]) / 2, by0 - bb[1]), txt, font=f, fill=SUITS[suit] + (255,))
    put(d, EMB[suit], cx, by0 + max(bb[3] - bb[1], line) + gap + eh / 2, h=eh)
    card.alpha_composite(d)
    card.alpha_composite(d.rotate(180))


def joker_index(card):
    d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    f = ImageFont.truetype(FONT, 118)
    y = IDX_TOP
    for ch in 'JOKER':
        bb = dr.textbbox((0, 0), ch, font=f)
        dr.text((IDX_X - (bb[0] + bb[2]) / 2, y - bb[1]), ch, font=f, fill=RED + (255,))
        y += (bb[3] - bb[1]) + 16
    card.alpha_composite(d)


def figure(im, inner, corner=170):
    """絵札の 人物だけ（紙の色を 透明に。四隅の 金の飾りは 消す）"""
    im = im.crop(inner)
    a = np.asarray(im.convert('RGB')).astype(int)
    edge = np.concatenate([a[:12].reshape(-1, 3), a[-12:].reshape(-1, 3), a[:, :12].reshape(-1, 3), a[:, -12:].reshape(-1, 3)])
    paper = np.median(edge[edge.sum(-1) > 550], axis=0)
    dist = np.sqrt(((a - paper) ** 2).sum(-1))
    alpha = np.clip((dist - 22) / 30, 0, 1)
    solid = alpha > 0.5
    lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=2))
    hh, ww = solid.shape
    for j, sl in enumerate(ndimage.find_objects(lab), start=1):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        in_corner = (x1 <= corner or x0 >= ww - corner) and (y1 <= corner or y0 >= hh - corner)
        tiny = (y1 - y0) * (x1 - x0) < 400
        if in_corner or tiny:
            alpha[lab == j] = 0
    out = im.convert('RGBA')
    out.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
    bb = out.getbbox()
    return out.crop(bb)


def figure_card(fig):
    """金の線の箱に 人物を入れる"""
    card = BASE.copy()
    bx0, bx1 = COL_R + 4, W - 62
    pad = 16
    fw = bx1 - bx0 - 2 * pad
    fh = fig.height * fw / fig.width
    if fh > H - 2 * 90:
        fh = H - 2 * 90
        fw = fig.width * fh / fig.height
    by0 = (H - fh) / 2 - pad
    by1 = (H + fh) / 2 + pad
    dr = ImageDraw.Draw(card)
    dr.rounded_rectangle((bx0, by0, bx1, by1), radius=14, outline=GOLD + (255,), width=5)
    dr.rounded_rectangle((bx0 + 10, by0 + 10, bx1 - 10, by1 - 10), radius=10, outline=GOLD + (150,), width=2)
    put(card, fig, (bx0 + bx1) / 2, H / 2, h=fh - 8)
    return card


def save(card, name):
    card.convert('RGB').resize((OUT_W, int(OUT_W * H / W)), Image.LANCZOS).save(f'{OUT}/{name}.webp', quality=86)


# 2〜10 の並び
L, C, R = 0.42, 0.6, 0.78
T, B = 0.215, 0.785


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


sys.path.insert(0, 'tools')
from make_cards_v1_face import erase_corner_marks  # noqa: E402

for s in SUITS:
    a = PLAIN.copy()
    put(a, EMB[s], W * 0.57, H * 0.55, w=W * 0.56)
    index(a, 1, s)
    save(a, f'{s}1')
    for n in range(2, 11):
        card = PLAIN.copy()
        ph = 190 if n <= 3 else 170 if n <= 8 else 150
        for cx, cy in rows(n):
            put(card, EMB[s], cx * W, cy * H, h=ph, flip=cy > 0.5 + 1e-6)
        index(card, n, s)
        save(card, f'{s}{n}')
    # J・Q・K：依頼者の絵を そのまま 大きく（2026-11-22 依頼者「枠の大きさは戻して」）。隅のマークの場所に 文字
    for r in (11, 12, 13):
        im, _box = erase_corner_marks(f'{SRC}/{s}{r}.png', s)
        # 12枚 同じ場所・同じ大きさ（2026-11-22 依頼者「位置がバラバラ」）：どの絵でも 空いている 共通の場所
        index_in_box(im, r, s, FACE_BOX)
        save(im, f'{s}{r}')

# ジョーカー：依頼者の絵を そのまま。左の すき間に たてに JOKER
jk = Image.open(f'{SRC}/JK.png').convert('RGBA').resize((W, H), Image.LANCZOS)
d = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dr = ImageDraw.Draw(d)
f = ImageFont.truetype(FONT, 92)
y = 230
for ch in 'JOKER':
    bb = dr.textbbox((0, 0), ch, font=f)
    dr.text((80 - (bb[0] + bb[2]) / 2, y - bb[1]), ch, font=f, fill=RED + (255,), stroke_width=4, stroke_fill=(250, 236, 205, 255))
    y += (bb[3] - bb[1]) + 14
jk.alpha_composite(d)
jk.alpha_composite(d.rotate(180))
save(jk, 'JK')
save(Image.open(f'{SRC}/back.png').convert('RGBA'), 'back')
print('ok')
