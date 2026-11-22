# カードの絵（ゲームが使うもの）

ここの絵は `tools/make_cards.py` が 依頼者の絵（`design/cards/`）から作る。直接 描きかえない。

- 依頼者の絵：土台（base）・裏（back）・A×4（2026-11-22）
- 2〜10：土台に Aの紋章を 並べて作る
- 隅の数字とマーク：全カードに こちらで入れる（フォント Playfair Display Black）
- J・Q・K：【仮】土台＋大きな文字＋紋章。絵が届いたら `design/cards/S11.png` などに置いて 作り直す
- ジョーカー：依頼者の絵（2026-11-22）＋隅に たてに JOKER

作り直し：`python3 tools/make_cards.py フォント.ttf`
