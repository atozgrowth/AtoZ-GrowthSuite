"""Build/verify a deterministic installable ZIP from the repository plugin only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SLUG = 'atoz-growth-wp-manager'
SOURCE = ROOT / 'wp-manager-plugin' / SLUG

def digest(data): return hashlib.sha256(data).hexdigest()

def build(output):
    output.mkdir(parents=True, exist_ok=True)
    entry = (SOURCE / (SLUG + '.php')).read_text()
    version = re.search(r'^ \* Version: ([0-9]+\.[0-9]+\.[0-9]+)$', entry, re.M).group(1)
    files = sorted(p for p in SOURCE.rglob('*') if p.is_file())
    if not files or any(p.suffix not in ['.php', '.txt'] or p.is_symlink() for p in files):
        raise ValueError('Unexpected plugin files; review package allowlist')
    archive = output / f'{SLUG}-{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path in files:
            info = zipfile.ZipInfo(SLUG + '/' + path.relative_to(SOURCE).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, path.read_bytes(), compresslevel=9)
    manifest = {'version': version, 'source_revision': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                'archive': archive.name, 'sha256': digest(archive.read_bytes()),
                'files': {SLUG + '/' + p.relative_to(SOURCE).as_posix(): digest(p.read_bytes()) for p in files},
                'mode': 'read-only', 'live_wordpress_validation': False}
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (output/'SHA256SUMS').write_text(manifest['sha256']+'  '+archive.name+'\n')
    verify(output)
    return manifest

def verify(output):
    manifest = json.loads((output/'manifest.json').read_text())
    archive = output/manifest['archive']
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    expected_files = {SLUG + '/' + p.relative_to(SOURCE).as_posix(): digest(p.read_bytes()) for p in SOURCE.rglob('*') if p.is_file()}
    if manifest['source_revision'] != revision or manifest['files'] != expected_files:
        raise ValueError('Downloaded package does not match checked-out source revision/files')
    if archive.name != manifest['archive'] or digest(archive.read_bytes()) != manifest['sha256']:
        raise ValueError('Archive checksum mismatch')
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None or set(package.namelist()) != set(manifest['files']):
            raise ValueError('Invalid archive contents')
        for name in package.namelist():
            if not name.startswith(SLUG+'/') or '..' in name.split('/') or digest(package.read(name)) != manifest['files'][name]:
                raise ValueError('Invalid archive entry')
    return manifest

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args=parser.parse_args()
    print(json.dumps(verify(args.output) if args.verify else build(args.output), indent=2))
