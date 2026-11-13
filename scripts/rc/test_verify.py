import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import verify


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = '4cdf318464719972f6e5a62c2c61d9a06b2a0ab1'
        config = b'{"architecture":"amd64","os":"linux","rootfs":{"type":"layers","diff_ids":[]}}'
        cd = hashlib.sha256(config).hexdigest()
        image = json.dumps({'schemaVersion': 2, 'config': {'digest': 'sha256:' + cd, 'size': len(config)}, 'layers': []}).encode()
        md = hashlib.sha256(image).hexdigest()
        index = json.dumps({'manifests': [{'digest': 'sha256:' + md, 'size': len(image), 'annotations': {'org.opencontainers.image.ref.name': 'backend:test'}}]}).encode()
        self.members = {'index.json': index, 'oci-layout': b'{"imageLayoutVersion":"1.0.0"}', 'blobs/sha256/' + cd: config, 'blobs/sha256/' + md: image}
        (self.root / 'manifest.json').write_text(json.dumps({'source_sha': self.source, 'validation_only': True, 'production_deployable': False, 'images': {'backend': {'image_config_digest': 'sha256:' + cd, 'oci_manifest_digest': 'sha256:' + md}}}))
        self.write_oci()

    def write_oci(self):
        with tarfile.open(self.root / 'images.oci.tar.gz', 'w:gz') as tar:
            for name, data in self.members.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        self.checksums()

    def checksums(self):
        (self.root / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in sorted(self.root.iterdir()) if p.name != 'SHA256SUMS'))

    def test_valid_and_altered_file(self):
        verify.verify_directory(self.root, self.source)
        (self.root / 'manifest.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
            verify.verify_directory(self.root, self.source)

    def test_oci_tampering_even_after_outer_checksums_recomputed(self):
        name = next(n for n in self.members if n.startswith('blobs/'))
        self.members[name] += b'corrupted'
        self.write_oci()
        with self.assertRaisesRegex(ValueError, 'OCI blob digest mismatch'):
            verify.verify_directory(self.root, self.source)

    def test_extra_file_and_wrong_source(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected source'):
            verify.verify_directory(self.root, '0' * 40)
        (self.root / 'unchecked').write_text('unexpected')
        with self.assertRaisesRegex(ValueError, 'unchecksummed'):
            verify.verify_directory(self.root, self.source)

    def test_zip_path_traversal_rejected(self):
        artifact = self.root / 'bad.zip'
        with zipfile.ZipFile(artifact, 'w') as zip:
            zip.writestr('../escape', 'unsafe')
        with patch('sys.argv', ['verify.py', str(artifact), '--expected-source', self.source]):
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                verify.main()


if __name__ == '__main__':
    unittest.main()
