<?php
// Standalone fixtures: no WordPress installation, HTTP request, credentials or database.
define('ABSPATH', '/synthetic/');
class WP_Error { public $code; public function __construct($code, $message='', $data=array()) { $this->code=$code; } }
class WP_REST_Server { const READABLE='GET'; }
$GLOBALS['connected']=true; $GLOBALS['remote_count']=0; $GLOBALS['routes']=array(); $GLOBALS['remote']=array('code'=>200,'body'=>'{"success":true,"authorized":true}');
function add_action($name,$callback) {}
function add_filter($name,$callback,$priority=10,$accepted=1) {}
function current_user_can($capability) { return false; }
function register_rest_route($namespace,$route,$options) { $GLOBALS['routes'][$route]=$options; }
function rest_ensure_response($value) { return $value; }
function home_url($path='/') { return 'https://synthetic.example.test/'; }
function untrailingslashit($value) { return rtrim($value,'/'); }
function wp_json_encode($value) { return json_encode($value); }
function wp_remote_post($url,$args) { $GLOBALS['remote_count']++; $GLOBALS['sent']=$args; return $GLOBALS['remote']; }
function wp_remote_retrieve_response_code($value) { return $value['code']; }
function wp_remote_retrieve_body($value) { return $value['body']; }
function is_wp_error($value) { return $value instanceof WP_Error; }
class ATOZ_Growth_Pairing { public static function is_connected() { return $GLOBALS['connected']; } }
class ATOZ_Growth_Site_Identity { public static function get_site_id() { return '33333333-3333-4333-8333-333333333333'; } }
class SyntheticRequest {
 public $grant; public $route;
 public function __construct($grant,$route='/atoz-growth/v1/themes') { $this->grant=$grant; $this->route=$route; }
 public function get_header($name) { return $this->grant; }
 public function get_route() { return $this->route; }
 public function get_param($name) { return null; }
}
class SyntheticTheme {
 public $name; public function __construct($name) { $this->name=$name; }
 public function get($key) { return $key==='Name' ? $this->name : '1.0'; }
 public function parent() { return false; }
}
function wp_get_themes() { return array('synthetic'=>new SyntheticTheme('Synthetic Theme')); }
function get_stylesheet() { return 'synthetic'; }
function get_site_transient($key) { return $GLOBALS['updates']; }
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-endpoints.php';
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-rest-api.php';
$count=0;
function check($condition,$name) { global $count; if (!$condition) { fwrite(STDERR,"FAIL: $name\n"); exit(1); } $count++; }
ATOZ_Growth_REST_API::register_routes();
check(ATOZ_Growth_REST_API::admin_permission()===false,'site admin capability denied');
foreach (array('inspection','posts','pages','media','plugins','themes') as $resource) {
 $route=$GLOBALS['routes']['/'.$resource];
 check($route['methods']==='GET' && $route['permission_callback']!=='__return_true','sensitive routes require grants and remain read-only');
}
$request=new SyntheticRequest(str_repeat('A',43));
$GLOBALS['connected']=false;
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory($request)) && $GLOBALS['remote_count']===0,'disconnected denies before HTTP');
$GLOBALS['connected']=true;
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory(new SyntheticRequest('invalid'))) && $GLOBALS['remote_count']===0,'bad grants denied before HTTP');
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory(new SyntheticRequest(str_repeat('A',43),'/atoz-growth/v1/execute'))),'unknown write scope denied');
check(ATOZ_Growth_REST_API::authorize_inventory($request)===true,'themes grant verified by backend');
$body=json_decode($GLOBALS['sent']['body'],true);
check($body['scope']==='themes' && !isset($body['page']) && $GLOBALS['sent']['redirection']===0,'exact scoped metadata and redirects disabled');
$GLOBALS['remote']=array('code'=>200,'body'=>'{"success":true,"authorized":"false"}');
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory($request)),'truthy string cannot authorize inventory');
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inspection($request)),'truthy string cannot authorize inspection');
$GLOBALS['remote']=new WP_Error('synthetic_transport');
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory($request)),'network errors fail closed');
$GLOBALS['remote']=array('code'=>403,'body'=>'{"success":true,"authorized":true}');
check(is_wp_error(ATOZ_Growth_REST_API::authorize_inventory($request)),'HTTP rejection cannot be bypassed by JSON');
$GLOBALS['updates']=false;
$value=ATOZ_Growth_REST_API::get_themes();
check($value['items'][0]['update_available']===null,'unknown update cache is not up-to-date');
$GLOBALS['updates']=(object)array('last_checked'=>time(),'checked'=>array('synthetic'=>'0.9'),'response'=>array());
check(ATOZ_Growth_REST_API::get_themes()['items'][0]['update_available']===null,'cache version mismatch unknown');
$GLOBALS['updates']=(object)array('last_checked'=>time(),'checked'=>array('synthetic'=>'1.0'),'response'=>array('synthetic'=>array('new_version'=>'1.1')));
check(ATOZ_Growth_REST_API::get_themes()['items'][0]['update_available']===true,'cached update available');
$GLOBALS['updates']=(object)array('last_checked'=>time(),'checked'=>array('synthetic'=>'1.0'),'response'=>array());
check(ATOZ_Growth_REST_API::get_themes()['items'][0]['update_available']===false,'matching cached observation reports no update');
$GLOBALS['updates']->last_checked=time()-86401;
check(ATOZ_Growth_REST_API::get_themes()['items'][0]['update_available']===null,'stale cache is unknown, never falsely up-to-date');
echo "$count standalone plugin contract checks passed (synthetic, not WordPress integration)\n";
