"""Verify an extracted artifact or GitHub ZIP, including all OCI blob digests."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import zipfile


def hash_stream(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()


def safe_name(name):
    p = Path(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name:
        raise ValueError('Unsafe archive/checksum path')
    return p


def verify_directory(root, expected_source):
    checks = {}
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        value, name = line.split('  ', 1)
        safe_name(name)
        if name in checks or len(value) != 64:
            raise ValueError('Duplicate/invalid checksum entry')
        checks[name] = value
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name != 'SHA256SUMS'}
    if actual != set(checks):
        raise ValueError('Missing or unchecksummed artifact files')
    for name, value in checks.items():
        p = root / name
        if p.is_symlink() or not p.is_file():
            raise ValueError('Missing/non-regular file')
        with p.open('rb') as f:
            if hash_stream(f) != value:
                raise ValueError('Checksum mismatch: ' + name)
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest['source_sha'] != expected_source or not manifest['validation_only'] or manifest['production_deployable']:
        raise ValueError('Unexpected source or production boundary')
    with tarfile.open(root / 'images.oci.tar.gz') as tar:
        members = {m.name: m for m in tar.getmembers()}
        if len(members) != len(tar.getmembers()):
            raise ValueError('Duplicate OCI members')
        for name, member in members.items():
            safe_name(name)
            if not member.isfile():
                raise ValueError('Non-regular OCI member')
            if name.startswith('blobs/sha256/'):
                if hash_stream(tar.extractfile(member)) != name.split('/')[-1]:
                    raise ValueError('OCI blob digest mismatch')
        index = json.load(tar.extractfile('index.json'))
        if len(index['manifests']) != len(manifest['images']):
            raise ValueError('Unexpected image count')
        def descriptor(desc):
            name = 'blobs/sha256/' + desc['digest'].removeprefix('sha256:')
            member = members[name]
            if member.size != desc['size']:
                raise ValueError('OCI size mismatch')
            return name
        found = set()
        for desc in index['manifests']:
            role = desc['annotations']['org.opencontainers.image.ref.name'].split(':')[0]
            if role in found:
                raise ValueError('Duplicate OCI role')
            found.add(role)
            image = manifest['images'][role]
            if desc['digest'] != image['oci_manifest_digest']:
                raise ValueError('Manifest digest mismatch')
            content = json.load(tar.extractfile(descriptor(desc)))
            if content['config']['digest'] != image['image_config_digest']:
                raise ValueError('Config digest mismatch')
            descriptor(content['config'])
            for layer in content['layers']:
                descriptor(layer)
        if found != set(manifest['images']):
            raise ValueError('Missing image role')
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--expected-zip-sha256')
    args = parser.parse_args()
    if args.artifact.is_dir():
        if args.expected_zip_sha256:
            parser.error('ZIP digest requires a ZIP file')
        manifest = verify_directory(args.artifact, args.expected_source)
    else:
        if args.expected_zip_sha256:
            with args.artifact.open('rb') as f:
                if hash_stream(f) != args.expected_zip_sha256.removeprefix('sha256:'):
                    raise ValueError('GitHub ZIP digest mismatch')
        with tempfile.TemporaryDirectory() as folder, zipfile.ZipFile(args.artifact) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError('Duplicate ZIP members')
            for entry in archive.infolist():
                safe_name(entry.filename)
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('ZIP symlinks are not allowed')
            archive.extractall(folder)
            manifest = verify_directory(Path(folder), args.expected_source)
    print(json.dumps({'verified': True, 'source_sha': manifest['source_sha'], 'delivery_build': manifest.get('delivery_build'), 'oci_manifest_digests': {role: image['oci_manifest_digest'] for role, image in manifest['images'].items()}}, indent=2))


if __name__ == '__main__':
    main()
