import tempfile
from pathlib import Path
import unittest
from package_plugin import build, verify
class PackageTests(unittest.TestCase):
    def test_reproducible_and_verified(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            one=build(Path(first)); two=build(Path(second))
            self.assertEqual(one['sha256'],two['sha256'])
            self.assertEqual(verify(Path(first))['version'],'0.8.0')
            self.assertIn('atoz-growth-wp-manager/atoz-growth-wp-manager.php',one['files'])
            import zipfile
            with zipfile.ZipFile(Path(first)/one['archive']) as package:
                header=package.read('atoz-growth-wp-manager/atoz-growth-wp-manager.php').decode()
            self.assertIn('Plugin Name: A to Z WordPress AI Manager',header)
    def test_tampered_zip_rejected(self):
        with tempfile.TemporaryDirectory() as location:
            out=Path(location); manifest=build(out)
            with (out/manifest['archive']).open('ab') as target: target.write(b'tamper')
            with self.assertRaisesRegex(ValueError,'checksum'): verify(out)
if __name__=='__main__': unittest.main()
