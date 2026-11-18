"""把 src/ 下的模块拼成单文件 HTML，双击即可离线使用。"""
import datetime
import pathlib

base = pathlib.Path(__file__).parent
src = base / 'src'
# 构建戳：标题栏右上角显示，用来确认打开的是不是最新版
stamp = '构建 ' + datetime.datetime.now().strftime('%m-%d %H:%M')
tpl = (src / 'index.template.html').read_text(encoding='utf-8').replace('__BUILD__', stamp)
for key, fn in [('STYLE', 'style.css'), ('VM', 'vm.js'), ('HW', 'hw.js'),
                ('EXAMPLES', 'examples.js'), ('APP', 'app.js')]:
    tpl = tpl.replace('/*__%s__*/' % key, (src / fn).read_text(encoding='utf-8'))

out = base / 'index.html'   # GitHub Pages 入口文件名
out.write_text(tpl, encoding='utf-8')
print('已生成:', out)
print('构建戳:', stamp)
print('大小: %.1f KB' % (out.stat().st_size / 1024))

# 硬件篇是独立页面，由主应用的「硬件」页以 iframe 加载；构建时原样复制到根目录。
hw_src = src / 'hardware.html'
if hw_src.exists():
    hw_out = base / 'hardware.html'
    hw_out.write_text(hw_src.read_text(encoding='utf-8'), encoding='utf-8')
    print('已生成:', hw_out)
    print('大小: %.1f KB' % (hw_out.stat().st_size / 1024))
