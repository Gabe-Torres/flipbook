#!/usr/bin/env python3
"""Regenerate docs/sw.js and docs/app-version.js from the files in docs/."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
SKIP = {'sw.js', 'app-version.js'}
# These are fetched the first time they are needed and then cached. Precaching
# them makes Safari spend a long time on install, then stall the next page load.
LAZY = (
    'vendor/tesseract/tesseract-core',
    'vendor/tesseract/tessdata/',
    'vendor/pdfjs/cmaps/',
)


def listed():
    found = []
    for path in DOCS.rglob('*'):
        if not path.is_file() or path.name.startswith('.'):
            continue
        rel = path.relative_to(DOCS).as_posix()
        if rel in SKIP:
            continue
        found.append(rel)
    return sorted(found)


def digest(rels):
    mixer = hashlib.sha256()
    template = (ROOT / 'tools' / 'sw.template.js').read_bytes()
    mixer.update(template)
    for rel in rels:
        mixer.update(rel.encode())
        mixer.update((DOCS / rel).read_bytes())
    return mixer.hexdigest()[:12]


def main():
    rels = listed()
    version = digest(rels)
    (DOCS / 'app-version.js').write_text(
        'window.APP_VERSION=' + json.dumps({
            'version': version,
            'shellCache': 'flipbook-' + version,
        }) + ';\n',
        encoding='utf-8',
    )
    shell = ['./', 'index.html', 'app-version.js'] + [
        rel for rel in rels
        if rel != 'index.html' and not rel.startswith(LAZY)
    ]
    template = (ROOT / 'tools' / 'sw.template.js').read_text(encoding='utf-8')
    sw = template.replace('__VERSION__', version).replace('__SHELL__', json.dumps(shell))
    (DOCS / 'sw.js').write_text(sw, encoding='utf-8')
    print(f'version {version}  precache {len(shell)} files')


if __name__ == '__main__':
    main()
