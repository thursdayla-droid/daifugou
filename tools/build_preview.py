"""確認用ページ（1ファイル）を作る。npx vite build のあとに実行。
使い方: python3 tools/build_preview.py 出力先.html
"""
import re, sys, pathlib
dist = pathlib.Path('dist')
html = (dist / 'index.html').read_text()
css = ''.join((dist / m).read_text() for m in re.findall(r'href="\./(assets/[^"]+\.css)"', html))
js = ''.join((dist / m).read_text() for m in re.findall(r'src="\./(assets/[^"]+\.js)"', html))
js = js.replace('</script', '<\\/script')
# 絵はページに埋め込む
import base64
for f in (dist / 'assets').iterdir():
    if f.suffix in ('.webp', '.png', '.jpg'):
        mime = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg'}[f.suffix]
        uri = f'data:{mime};base64,' + base64.b64encode(f.read_bytes()).decode()
        n = re.escape(f.name)
        js = re.sub(r'new URL\(`(?:\./)?' + n + r'`,import\.meta\.url\)(?:\.href)?', '"' + uri + '"', js)
        js = re.sub(r'(["`])(?:\./|/)?(?:assets/)?' + n + r'\1', '"' + uri + '"', js)
out = f'''<title>大富豪 GOLD</title>
<meta name="theme-color" content="#0b0a08">
<style>html,body{{height:100%;background:#0b0a08;color-scheme:dark}}{css}</style>
<div id="app"></div>
<script type="module">{js}</script>
'''
pathlib.Path(sys.argv[1]).write_text(out)
print(len(out))
