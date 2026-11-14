#!/usr/bin/env python3
"""Real WP core fixture: fixed local Docker, internal network, no host ports or DSNs."""
import json, os, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DOCKER=['docker','--host=unix:///var/run/docker.sock']
PREFIX='atoz-p2-'+str(os.getpid())
IMAGES={'wordpress':'wordpress:7.1.4-php8.3-apache','database':'mariadb:11.4','postgres':'postgres:17-alpine','backend':'node:24-bookworm-slim'}
containers=[]
def docker(*args,input=None,check=True,timeout=900):
    r=subprocess.run(DOCKER+list(args),input=input,text=True,capture_output=True,timeout=timeout)
    if check and r.returncode: raise RuntimeError('isolated Docker '+args[0]+' failed (exit '+str(r.returncode)+')')
    return r

def start(role,*args,command=()):
    name=PREFIX+'-'+role
    proxy=[]
    for key in ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']: proxy+=['-e',key+'=']
    proxy+=['-e','NO_PROXY=*','-e','no_proxy=*']
    docker('run','-d','--name',name,'--network',PREFIX,'--network-alias',role,*proxy,*args,IMAGES[role],*command)
    containers.append(name)
    return name

def ready(command):
    for _ in range(90):
        if docker(*command,check=False).returncode==0:return
        time.sleep(1)
    raise RuntimeError('isolated service readiness timeout')

def main():
    output=ROOT/'integration/wordpress/evidence.json'
    output.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='atoz-wp-test-') as tmp:
        fixture=Path(tmp)
        try:
            for image in IMAGES.values():
                if docker('image','inspect',image,check=False).returncode: docker('pull',image)
            docker('network','create','--internal',PREFIX)
            assert docker('network','inspect','--format','{{.Internal}}',PREFIX).stdout.strip()=='true'
            pg=start('postgres','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-postgres','-e','POSTGRES_DB=fixture')
            ready(['exec',pg,'pg_isready','-U','postgres','-d','fixture'])
            db=start('database','--tmpfs','/var/lib/mysql:rw,size=512m','-e','MARIADB_ROOT_PASSWORD=synthetic-root','-e','MARIADB_DATABASE=wordpress','-e','MARIADB_USER=wordpress','-e','MARIADB_PASSWORD=synthetic-wordpress')
            ready(['exec',db,'healthcheck.sh','--connect','--innodb_initialized'])
            config="""define('WP_ENVIRONMENT_TYPE','local');
define('WP_HTTP_BLOCK_EXTERNAL',true);
define('WP_ACCESSIBLE_HOSTS','backend');
define('DISABLE_WP_CRON',true);
define('WP_AUTO_UPDATE_CORE',false);
define('AUTOMATIC_UPDATER_DISABLED',true);
define('ATOZ_GROWTH_ISOLATED_TEST_MODE',true);
define('ATOZ_GROWTH_TEST_BACKEND_URL','http://backend:3000');
define('ATOZ_GROWTH_TEST_WRITES_ENABLED',true);
define('ATOZ_GROWTH_TEST_ACTOR_ID',1);
"""
            wp=start('wordpress','--tmpfs','/var/www/html:rw,size=256m','--mount',f'type=bind,src={ROOT}/wp-manager-plugin/atoz-growth-wp-manager,dst=/var/www/html/wp-content/plugins/atoz-growth-wp-manager,readonly','--mount',f'type=bind,src={ROOT}/integration/wordpress/control.php,dst=/var/www/html/fixture-control.php,readonly','-e','WORDPRESS_DB_HOST=database','-e','WORDPRESS_DB_USER=wordpress','-e','WORDPRESS_DB_PASSWORD=synthetic-wordpress','-e','WORDPRESS_DB_NAME=wordpress','-e','WORDPRESS_CONFIG_EXTRA='+config)
            ready(['exec',wp,'php','-r',"exit(file_exists('/var/www/html/wp-config.php')?0:1);"])
            install="""<?php
define('WP_INSTALLING',true);
require '/var/www/html/wp-load.php';
require '/var/www/html/wp-admin/includes/upgrade.php';
wp_install('Synthetic site','fixture-admin','fixture@example.test',true,'','synthetic-admin-password');
require_once ABSPATH.'wp-admin/includes/plugin.php';
$r=activate_plugin('atoz-growth-wp-manager/atoz-growth-wp-manager.php');
if(is_wp_error($r)){exit(3);}
update_option('home','https://fixture.example.test');
update_option('siteurl','https://fixture.example.test');
update_option('permalink_structure','/%postname%/');
flush_rewrite_rules();
echo json_encode(['wordpress'=>get_bloginfo('version'),'plugin_active'=>is_plugin_active('atoz-growth-wp-manager/atoz-growth-wp-manager.php'),'site_id'=>ATOZ_Growth_Site_Identity::get_site_id()]);
"""
            raw=docker('exec','-i',wp,'php',input=install).stdout
            installation=json.loads(raw[raw.rfind('{'):]);assert installation['plugin_active'] is True
            (fixture/'installation.json').write_text(json.dumps(installation))
            runner=start('backend','--mount',f'type=bind,src={ROOT}/backend/dist,dst=/app/dist,readonly','--mount',f'type=bind,src={ROOT}/backend/node_modules,dst=/app/node_modules,readonly','--mount',f'type=bind,src={ROOT}/integration/wordpress,dst=/app/integration,readonly','--mount',f'type=bind,src={fixture},dst=/fixture','--mount',f'type=bind,src={ROOT}/backend/supabase/migrations,dst=/app/migrations,readonly','-w','/app','-e','NODE_ENV=test','-e','WP_MANAGER_DRAFT_TEST_MODE=isolated','-e','WP_MANAGER_CONTROLLED_WRITES_ENABLED=true','-e','SUPABASE_URL=https://example.supabase.co','-e','SUPABASE_ANON_KEY=synthetic-anon','-e','SUPABASE_SERVICE_ROLE_KEY=',command=('node','/app/integration/exercise.mjs'))
            result=docker('wait',runner,timeout=300)
            if result.stdout.strip()!='0':
                print(docker('logs',runner,check=False).stderr[-2000:])
                print(docker('logs',wp,check=False).stderr[-3500:])
                raise RuntimeError('actual WordPress workflow assertions failed')
            evidence=json.loads((fixture/'evidence.json').read_text())
            assert evidence['success'] is True and evidence['actual_wordpress_core'] is True
            evidence['source_revision']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
            evidence['source_dirty']=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
            evidence.update(installation=installation,network_internal=True,external_sites_contacted=False,live_supabase_access=False,image_digests={key:docker('image','inspect','--format','{{index .RepoDigests 0}}',image).stdout.strip() for key,image in IMAGES.items()})
            output.write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence,indent=2))
        finally:
            for name in reversed(containers):docker('rm','-f',name,check=False)
            docker('network','rm',PREFIX,check=False)
if __name__=='__main__':main()
