"""Owner-run metadata probe. Defaults to plan-only. Never reads environment or logs."""
import argparse
import json
import socket
import subprocess

COMMANDS = [
    ['docker', '--host=unix:///var/run/docker.sock', 'inspect', '--format',
     '{"image":{{json .Image}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"user":{{json .Config.User}},"readonly":{{json .HostConfig.ReadonlyRootfs}}}', name]
    for name in ['atoz_backend', 'atoz_frontend', 'atoz_caddy']
] + [['systemctl', 'is-active', 'atoz-backend.service']]

def main(argv=None, runner=subprocess.run):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-read-only', action='store_true')
    parser.add_argument('--expected-hostname')
    args = parser.parse_args(argv)
    if not args.execute_read_only:
        print(json.dumps({'plan_only': True, 'commands': COMMANDS}, indent=2))
        return
    if not args.expected_hostname or args.expected_hostname != socket.gethostname():
        parser.error('Explicit matching owner-approved hostname required')
    for command in COMMANDS:
        result = runner(command, capture_output=True, text=True, timeout=15, check=False)
        if result.returncode:
            print(json.dumps({'check': command[-1], 'exit_code': result.returncode}))
        elif command[0] == 'docker':
            # Only selected safe fields are requested from the daemon.
            print(json.dumps({'check': command[-1], 'metadata': json.loads(result.stdout)}))
        else:
            print(json.dumps({'systemd_backend': result.stdout.strip() if result.stdout.strip() in ['active','inactive','failed','unknown'] else 'unrecognized'}))
if __name__ == '__main__':
    main()
