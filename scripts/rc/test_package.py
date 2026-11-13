import json
import unittest
from package import validate_runtime_config, layer_descriptor
import gzip
import hashlib
from pathlib import Path
import tempfile


class RuntimeIdentityTests(unittest.TestCase):
    def setUp(self):
        self.config = {'architecture': 'amd64', 'os': 'linux', 'rootfs': {'diff_ids': ['sha256:layer']}, 'config': {'User': 'node', 'Env': ['NODE_ENV=production']}}
        self.inspect = {'Id': 'sha256:containerd-index-not-config', 'Architecture': 'amd64', 'Os': 'linux', 'RootFS': {'Layers': ['sha256:layer']}, 'Config': {'User': 'node', 'Env': ['NODE_ENV=production']}}

    def test_containerd_identity_is_independent_of_config_digest(self):
        validate_runtime_config(json.dumps(self.config), self.inspect)

    def test_wrong_runtime_user_rejected(self):
        self.inspect['Config']['User'] = 'root'
        with self.assertRaises(AssertionError):
            validate_runtime_config(json.dumps(self.config), self.inspect)

    def test_wrong_layer_identity_rejected(self):
        self.inspect['RootFS']['Layers'] = ['sha256:other']
        with self.assertRaises(AssertionError):
            validate_runtime_config(json.dumps(self.config), self.inspect)


class LayerIdentityTests(unittest.TestCase):
    def test_raw_and_gzip_blobs_have_same_diff_id(self):
        content = b'synthetic layer tar bytes'
        expected = 'sha256:' + hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'layer'
            for compressed in [False, True]:
                data = gzip.compress(content) if compressed else content
                path.write_bytes(data)
                desc = layer_descriptor(path, expected)
                self.assertEqual(desc['digest'], 'sha256:' + hashlib.sha256(data).hexdigest())
                self.assertEqual(desc['mediaType'].endswith('+gzip'), compressed)
                with self.assertRaises(AssertionError):
                    layer_descriptor(path, 'sha256:' + '0' * 64)
