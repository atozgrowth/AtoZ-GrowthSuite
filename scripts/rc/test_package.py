import json
import unittest
from package import validate_runtime_config


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
