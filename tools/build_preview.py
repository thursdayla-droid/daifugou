"""確認用ページ（1ファイル）を作る。npx vite build のあとに実行。
使い方: python3 tools/build_preview.py 出力先.html
"""
import re, sys, pathlib
dist = pathlib.Path('dist')
html = (dist / 'index.html').read_text()
css = ''.join((dist / m).read_text() for m in re.findall(r'href="\./(assets/[^"]+\.css)"', html))
js = ''.join((dist / m).read_text() for m in re.findall(r'src="\./(assets/[^"]+\.js)"', html))
js = js.replace('</script', '<\\/script')
out = f'''<title>大富豪 GOLD</title>
<meta name="theme-color" content="#0b0a08">
<style>html,body{{height:100%;background:#0b0a08;color-scheme:dark}}{css}</style>
<div id="app"></div>
<script type="module">{js}</script>
'''
pathlib.Path(sys.argv[1]).write_text(out)
print(len(out))
