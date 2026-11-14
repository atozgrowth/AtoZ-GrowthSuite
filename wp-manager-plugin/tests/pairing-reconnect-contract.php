<?php
// Synthetic reset-only capability/nonce regression. No HTTP or WordPress core invocation.
define('ABSPATH','/synthetic/');
class WP_Error {public $code;public function __construct($code,$message='',$data=array()){$this->code=$code;}}
$GLOBALS['admin']=false;
$GLOBALS['options']=array('atoz_growth_connection_status'=>'revoked','atoz_growth_connection_id'=>'synthetic-old-connection','atoz_growth_paired_at'=>'synthetic-time','atoz_growth_site_id'=>'33333333-3333-4333-8333-333333333333');
function get_option($key,$default=false){return isset($GLOBALS['options'][$key])?$GLOBALS['options'][$key]:$default;}
function update_option($key,$value,$autoload=false){$GLOBALS['options'][$key]=$value;return true;}function delete_option($key){unset($GLOBALS['options'][$key]);return true;}
function current_user_can($capability){return $GLOBALS['admin']&&$capability==='manage_options';}function wp_verify_nonce($nonce,$action){return $nonce==='synthetic-valid'&&$action==='atoz_growth_reconnect';}
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-pairing.php';
$count=0;function check($condition,$label){global$count;if(!$condition){fwrite(STDERR,"FAIL: $label\n");exit(1);}$count++;}
check(ATOZ_Growth_Pairing::reset_for_reconnect('synthetic-valid') instanceof WP_Error,'nonadmin cannot reset');
check(get_option('atoz_growth_connection_status')==='revoked','denial preserves state');
$GLOBALS['admin']=true;check(ATOZ_Growth_Pairing::reset_for_reconnect('invalid') instanceof WP_Error,'admin still needs nonce');
check(ATOZ_Growth_Pairing::reset_for_reconnect('synthetic-valid')===true,'explicit admin nonce reset allowed');
check(get_option('atoz_growth_connection_status')==='not_connected','fresh challenge now required');
check(get_option('atoz_growth_connection_id')===false&&get_option('atoz_growth_paired_at')===false,'old local pairing removed');
check(get_option('atoz_growth_site_id')==='33333333-3333-4333-8333-333333333333','permanent site identity retained');
echo "$count standalone reconnect checks passed (synthetic, not WordPress integration)\n";
