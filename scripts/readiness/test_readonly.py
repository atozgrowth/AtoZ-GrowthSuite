import contextlib
import io
import unittest
from unittest.mock import patch
from vps_readonly import main, COMMANDS
class ReadOnlyPlan(unittest.TestCase):
    def test_default_never_executes(self):
        def forbidden(*args, **kwargs): raise AssertionError('executed')
        with contextlib.redirect_stdout(io.StringIO()): main([], forbidden)
    def test_host_mismatch_never_executes(self):
        with patch('socket.gethostname',return_value='synthetic-host'), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit): main(['--execute-read-only','--expected-hostname','different'])
    def test_allowlist_excludes_secrets_and_mutations(self):
        self.assertEqual(len(COMMANDS),4)
        for command in COMMANDS:
            self.assertIn(command[0], ['docker','systemctl'])
            self.assertNotIn('.Config.Env', ' '.join(command))
            self.assertNotIn('restart',command)
if __name__ == '__main__': unittest.main()
