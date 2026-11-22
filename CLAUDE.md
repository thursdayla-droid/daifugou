# 大富豪 GOLD 開発ルール（Claude Code向け）

友だちの職場で流行っている 独自ルールの大富豪。MONZ とは関係ない別のゲーム。

- 依頼者は iPhone のみで作業する。説明は日本語・短く・専門用語を避ける。
- ルールの中身は依頼者（と友だち）が決める。決まっていない所はコードに【仮】と書き、`docs/RULES.md` の「仮で決めたこと」に書く。
- 絵は依頼者が用意する（`src/assets/cards/README.md`）。
- 技術：Vite + TypeScript（画面は ふつうの HTML）。`src/core/` は画面に依存させない。乱数は種から再現できる。
- オンライン：PeerJS（無料の つなぎ役サーバー 0.peerjs.com）。部屋を作った人の端末がゲームを進め、ほかの人には 見ていい情報だけ送る。
- テスト `npm test`、型チェック `npm run typecheck`。main に push すると GitHub Pages に公開。
