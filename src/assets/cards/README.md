# カードの絵（ゲームが使うもの）

ここの絵は `tools/make_cards.py` が 依頼者の絵（`design/cards/`）から作る。直接 描きかえない。

2026-11-22 v2：依頼者「カードが全然違う。枠が合ってない。数字の大きさをバランスよく」
- 全カード 同じ枠と紙（`design/cards/base.png`）
- マーク：新しいA（`design/cards/S1.png` など）から取る。Aの真ん中・2〜10の並び・隅に使う
- J・Q・K・ジョーカー：依頼者の絵から 人物だけ切り出して、金の線の箱に入れる
- 隅の数字：全カード 同じ大きさで 左上だけ（スマホの手札では 左上しか見えないため）
- 前の作り方：`tools/make_cards_v1.py`。前のAの絵：`design/cards/old/`

作り直し：`python3 tools/make_cards.py フォント.ttf`（Playfair Display Black）
