"""絵札の 隅の大きなマークを 紙の色で消す（make_cards.py から使う）"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

W, H = 1024, 1536


def erase_corner_marks(path, suit):
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

