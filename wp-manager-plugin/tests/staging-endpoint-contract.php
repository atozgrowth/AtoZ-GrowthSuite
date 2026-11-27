<?php
// Staging endpoint policy fixture only; no HTTP calls or WordPress database.
define('ABSPATH','/synthetic/');
$candidate=isset($argv[1])?$argv[1]:'https://api.staging.atozgrowth.net';
$expected=isset($argv[2])?$argv[2]:'valid';
$GLOBALS['environment']='staging';
define('ATOZ_GROWTH_NONPRODUCTION_MODE',true);
define('ATOZ_GROWTH_STAGING_BACKEND_URL',$candidate);
define('ATOZ_GROWTH_NONPRODUCTION_WRITES_ENABLED',true);
define('ATOZ_GROWTH_NONPRODUCTION_PUBLISH_ENABLED',true);
class WP_Error { public $code; public function __construct($code,$message='',$data=array()) { $this->code=$code; } }
function add_filter($name,$callback,$priority=10,$accepted=1) {}
function wp_get_environment_type() { return $GLOBALS['environment']; }
function wp_parse_url($url) { return parse_url($url); }
function is_wp_error($value) { return $value instanceof WP_Error; }
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-endpoints.php';
$checks=0;
function check($ok,$name) { global $checks; if(!$ok){fwrite(STDERR,"FAIL: $name\n");exit(1);} $checks++; }
check(ATOZ_Growth_Endpoints::nonproduction_mode(),'explicit staging environment enables bounded nonproduction mode');
if('valid'===$expected){
 check(ATOZ_Growth_Endpoints::endpoint('pairing/initiate')===$candidate.'/api/wp-manager/pairing/initiate','endpoint uses configured staging origin');
 check(ATOZ_Growth_Endpoints::writes_enabled(),'write requires the explicit staging write flag');
 check(ATOZ_Growth_Endpoints::publishing_enabled(),'publish requires a separate explicit staging publish flag');
}else{
 check(is_wp_error(ATOZ_Growth_Endpoints::endpoint('pairing/initiate')),'invalid staging origin fails closed');
 check(!ATOZ_Growth_Endpoints::writes_enabled()&&!ATOZ_Growth_Endpoints::publishing_enabled(),'invalid origin cannot enable writes');
}
$GLOBALS['environment']='production';
check(!ATOZ_Growth_Endpoints::nonproduction_mode()&&!ATOZ_Growth_Endpoints::writes_enabled()&&!ATOZ_Growth_Endpoints::publishing_enabled(),'production WordPress can never use staging write flags');
echo "$checks staging endpoint contract checks passed for $expected origin (synthetic, no HTTP)\n";
