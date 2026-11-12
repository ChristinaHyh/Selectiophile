#!/usr/bin/env python3
"""Packages the extension for the Chrome Web Store.

Usage: python3 scripts/build_release.py <output dir>

Files are listed by what the extension loads at run time, so tests and development
files can't slip in. It stops if a local import, script or stylesheet would be missing.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOP_FILES = ['manifest.json', 'background.js', 'Reading Template.md', 'Article Template.md']
FOLDERS = ['_locales', 'content', 'options', 'popup', 'profiles', 'icons', 'core', 'vendor']
SKIP_NAMES = {'core/evaluate.js'}  # Only the accuracy script under eval/ uses it.
SKIP_SUFFIXES = ('.test.js',)


def release_files():
    files = [ROOT / name for name in TOP_FILES]
    for folder in FOLDERS:
        files += [p for p in sorted((ROOT / folder).rglob('*')) if p.is_file()]
    return [p for p in files
            if p.relative_to(ROOT).as_posix() not in SKIP_NAMES and not p.name.endswith(SKIP_SUFFIXES)]


def local_references(path):
    """Paths a shipped file loads, as written in its source."""
    if path.suffix == '.js':
        return re.findall(r"""(?:from\s+|import\s*\(\s*)['"](\.{1,2}/[^'"]+)['"]""", path.read_text(encoding='utf-8'))
    if path.suffix == '.html':
        return [r for r in re.findall(r"""(?:src|href)="([^"#]+)\"""", path.read_text(encoding='utf-8')) if '://' not in r]
    return []


def check(names):
    missing = []
    for path in [ROOT / n for n in names]:
        for ref in local_references(path):
            target = (path.parent / ref).resolve().relative_to(ROOT).as_posix()
            if target not in names:
                missing.append(f'{path.relative_to(ROOT)} -> {ref}')
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    for size, icon in manifest['icons'].items():
        if icon not in names:
            missing.append(f'manifest icon {size}: {icon}')
    # Loaded by name from background.js, so not caught by the import scan above.
    for loaded in re.findall(r"'((?:vendor|content)/[^']+)'", (ROOT / 'background.js').read_text(encoding='utf-8')):
        if loaded not in names:
            missing.append(f'background.js -> {loaded}')
    if missing:
        sys.exit('Missing from the package:\n  ' + '\n  '.join(missing))
    return manifest['version']


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    files = release_files()
    names = {p.relative_to(ROOT).as_posix() for p in files}
    version = check(names)
    out = Path(sys.argv[1]) / f'selectiophile-{version}.zip'
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(ROOT).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    print(f'{out} ({out.stat().st_size // 1024} KB, {len(files)} files)')


main()
