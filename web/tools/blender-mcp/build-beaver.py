from pathlib import Path
path = Path(r'web/tools/build-beaver.py')
exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), {'__file__': str(path), '__name__': '__main__'})
