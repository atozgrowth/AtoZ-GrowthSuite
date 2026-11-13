"""Export validated local images as an OCI archive; never push or deploy."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def archive(directory, target):
    with target.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            for path in sorted(directory.rglob('*')):
                if not path.is_file():
                    continue
                info = tar.gettarinfo(str(path), str(path.relative_to(directory)))
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                info.mode = 0o644
                with path.open('rb') as f:
                    tar.addfile(info, f)


def validate_runtime_config(config, inspect):
    """Docker's classic store IDs are config digests; containerd IDs may be indexes."""
    value = json.loads(config)
    assert value['rootfs']['diff_ids'] == inspect['RootFS']['Layers']
    assert value['architecture'] == inspect['Architecture'] and value['os'] == inspect['Os']
    for key in ['Env', 'Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Labels']:
        assert value.get('config', {}).get(key) == inspect['Config'].get(key), key


def layer_descriptor(path, expected_diff_id):
    # Containerd exports compressed blobs; the classic store exports tar bytes.
    with path.open('rb') as f:
        compressed = f.read(2) == b'\x1f\x8b'
    value = digest_file(path)
    diff_id = value
    if compressed:
        h = hashlib.sha256()
        with gzip.open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        diff_id = h.hexdigest()
    assert 'sha256:' + diff_id == expected_diff_id, 'Layer diff ID mismatch'
    return {'mediaType': 'application/vnd.oci.image.layer.v1.tar' + ('+gzip' if compressed else ''), 'digest': 'sha256:' + value, 'size': path.stat().st_size}


def main(source, out):
    sha = os.environ['RC_SOURCE_SHA']
    version = os.environ['RC_VERSION']
    assert subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == sha
    bases = json.loads((out / 'base-images.json').read_text())
    roles = {'backend': 'atoz-rc-backend:' + version, 'frontend': 'atoz-rc-frontend:' + version, 'proxy': bases['caddy:2-alpine']}
    identities = {}
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        layout = temp / 'oci'
        blobs = layout / 'blobs/sha256'
        blobs.mkdir(parents=True)

        def blob(data):
            value = hashlib.sha256(data).hexdigest()
            (blobs / value).write_bytes(data)
            return {'digest': 'sha256:' + value, 'size': len(data)}

        index = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json', 'manifests': []}
        for role, ref in roles.items():
            inspect = json.loads(subprocess.check_output(['docker', 'image', 'inspect', ref]))[0]
            saved = temp / (role + '.tar')
            subprocess.run(['docker', 'save', '-o', str(saved), ref], check=True)
            with tarfile.open(saved) as tar:
                docker_manifest = json.load(tar.extractfile('manifest.json'))[0]
                config = tar.extractfile(docker_manifest['Config']).read()
                config_desc = blob(config)
                validate_runtime_config(config, inspect)
                config_desc['mediaType'] = 'application/vnd.oci.image.config.v1+json'
                layers = []
                for number, name in enumerate(docker_manifest['Layers']):
                    pending = temp / 'layer'
                    with tar.extractfile(name) as incoming, pending.open('wb') as target:
                        shutil.copyfileobj(incoming, target)
                    desc = layer_descriptor(pending, json.loads(config)['rootfs']['diff_ids'][number])
                    value = desc['digest'].removeprefix('sha256:')
                    layers.append(desc)
                    destination = blobs / value
                    if destination.exists():
                        pending.unlink()
                    else:
                        pending.rename(destination)
                manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'config': config_desc, 'layers': layers}
                manifest_desc = blob(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode())
                manifest_desc.update(mediaType=manifest['mediaType'], platform={'architecture': inspect['Architecture'], 'os': inspect['Os']}, annotations={'org.opencontainers.image.ref.name': role + ':' + version})
                index['manifests'].append(manifest_desc)
                identities[role] = {'docker_image_identity': inspect['Id'], 'image_config_digest': config_desc['digest'], 'oci_manifest_digest': manifest_desc['digest'], 'platform': inspect['Os'] + '/' + inspect['Architecture']}
            saved.unlink()
        write_json(layout / 'oci-layout', {'imageLayoutVersion': '1.0.0'})
        write_json(layout / 'index.json', index)
        archive(layout, out / 'images.oci.tar.gz')
    with (out / 'source.tar.gz').open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        process = subprocess.Popen(['git', '-C', str(source), 'archive', '--format=tar', '--prefix=AtoZ-GrowthSuite/', sha], stdout=subprocess.PIPE)
        shutil.copyfileobj(process.stdout, gz)
        assert process.wait() == 0
    rollback = {'production_ready': False, 'previous_image_digests': None, 'previous_config_checksums': None, 'vps_snapshot_id': None, 'supabase_restore_evidence': None, 'non_root_recovery_evidence': None, 'systemd_overlap_inventory': None, 'rollback_owner': None, 'database_changes': 'none', 'approval': 'separate explicit production approval required'}
    write_json(out / 'rollback.json', rollback)
    write_json(out / 'environment-contract.json', {'fixture_url': 'https://example.supabase.co', 'backend_required': ['SUPABASE_URL', 'SUPABASE_ANON_KEY'], 'backend_only_privileged': ['SUPABASE_SERVICE_ROLE_KEY'], 'frontend_public_build_values': ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_BASE_URL'], 'controlled_writes': False, 'production_project_to_verify_separately': 'vigfmclcbibesrorjmut', 'production_configuration_verified': False, 'frontend_rebuild_for_production': 'new version required; this image is fixture-only'})
    shutil.copyfile(source / 'docs/production-remediation.md', out / 'PRODUCTION-PREREQUISITES.md')
    write_json(out / 'manifest.json', {'version': version, 'delivery_build': os.environ.get('GITHUB_RUN_ID', 'local') + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1'), 'source_sha': sha, 'tooling_sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'workflow_sha': os.environ.get('GITHUB_WORKFLOW_SHA'), 'run_url': 'https://github.com/' + os.environ.get('GITHUB_REPOSITORY', 'atozgrowth/AtoZ-GrowthSuite') + '/actions/runs/' + os.environ.get('GITHUB_RUN_ID', 'local'), 'validation_only': True, 'production_deployable': False, 'images': identities, 'base_images': bases, 'retention_days': 30, 'previous_local_rc_bytes_replaced': False, 'scope': 'independent Actions build of exact RC application source; not byte-identical to the earlier local bundle'})
    (out / 'README.md').write_text('# Validation-only RC delivery\n\nVerify SHA256SUMS before use. The OCI archive includes full content-addressed images and manifests; source.tar.gz is the exact application revision in manifest.json. This Actions build is separately identified by run/attempt and does not replace the earlier local bundle or modify the GitHub draft release.\n\nNO-GO for production: frontend uses synthetic fixtures. Live rollback identifiers are deliberately null. Verify Docker/systemd ownership, non-root recovery, backups/restoration and existing Growth Suite Supabase bindings separately. A new frontend build/version and explicit approval are required before production. No deployment or migration runs here.\n\nArtifacts are unsigned and expire after 30 days; repository access is required to download. GitHub artifact immutability does not prevent administrative deletion or expiry. Retain the artifact ID and API ZIP digest externally for verification.\n')
    # SHA256SUMS is not self-referential; every other file is covered.
    checks = [(digest_file(p), p.relative_to(out).as_posix()) for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS']
    (out / 'SHA256SUMS').write_text(''.join(value + '  ' + name + '\n' for value, name in checks))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
