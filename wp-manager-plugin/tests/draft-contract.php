<?php
// Standalone fixtures only. Actual WordPress/MySQL integration is a separate suite.
define('ABSPATH','/synthetic/');
$mode=isset($argv[1])?$argv[1]:'default';
if($mode!=='default'){
 define('ATOZ_GROWTH_ISOLATED_TEST_MODE',true);define('ATOZ_GROWTH_TEST_WRITES_ENABLED',true);define('ATOZ_GROWTH_TEST_ACTOR_ID',1);
 $bases=array('invalid'=>'https://api.atozgrowth.net','credentials'=>'http://user@backend:3000','path'=>'http://backend:3000/unexpected','host'=>'http://evil.example.test:3000','port'=>'http://backend:443');
 define('ATOZ_GROWTH_TEST_BACKEND_URL',isset($bases[$mode])?$bases[$mode]:'http://backend:3000');
}
class WP_Error {public $code;public function __construct($code,$message='',$data=array()){$this->code=$code;}}
function add_action($name,$callback){}function add_filter($name,$callback,$priority=10,$accepted=1){}
function is_wp_error($value){return $value instanceof WP_Error;}function wp_get_environment_type(){return $GLOBALS['mode']==='wrong-environment'?'production':'local';}
function wp_parse_url($url){return parse_url($url);}function wp_json_encode($value,$flags=0){return json_encode($value,$flags);}
function get_userdata($id){return(object)array('ID'=>$id);}function user_can($user,$capability,$id=null){return empty($GLOBALS['deny_cap']);}
function sanitize_text_field($text){return trim(strip_tags($text));}function wp_kses_post($text){return preg_replace('/<script.*?<\/script>/s','',$text);}
function home_url($path='/'){return'http://wordpress';}function untrailingslashit($value){return rtrim($value,'/');}function rest_ensure_response($value){return$value;}
function clean_post_cache($id){}function wp_slash($value){return$value;}function wp_cache_delete($key,$group=''){}function maybe_serialize($value){return serialize($value);}
$GLOBALS['options']=array('fixture_connection'=>'55555555-5555-4555-8555-555555555555');$GLOBALS['posts']=array();$GLOBALS['remote_count']=0;$GLOBALS['write_count']=0;$GLOBALS['remote_boolean']=true;
function add_option($key,$value,$deprecated='',$autoload=false){if(isset($GLOBALS['options'][$key]))return false;$GLOBALS['options'][$key]=$value;return true;}
function update_option($key,$value,$autoload=false){$GLOBALS['options'][$key]=$value;return true;}function delete_option($key){unset($GLOBALS['options'][$key]);return true;}
function get_option($key,$default=false){if(strpos($key,'atoz_draft_action_')===0)$GLOBALS['receipt_reads']=isset($GLOBALS['receipt_reads'])?$GLOBALS['receipt_reads']+1:1;return isset($GLOBALS['options'][$key])?$GLOBALS['options'][$key]:$default;}
function get_post($id){if(is_object($id))return clone$id;return isset($GLOBALS['posts'][$id])?clone$GLOBALS['posts'][$id]:null;}
function wp_insert_post($value,$error=false){$GLOBALS['write_count']++;$id=count($GLOBALS['posts'])+1;$GLOBALS['posts'][$id]=(object)array('ID'=>$id,'post_type'=>$value['post_type'],'post_status'=>$value['post_status'],'post_title'=>$value['post_title'],'post_content'=>$value['post_content'],'post_modified_gmt'=>'2026-11-14 00:00:00');return$id;}
function wp_update_post($value,$error=false){$GLOBALS['write_count']++;$id=$value['ID'];$post=$GLOBALS['posts'][$id];$post->post_title=$value['post_title'];$post->post_content=$value['post_content'];$post->post_status=$value['post_status'];return$id;}
function wp_remote_post($url,$args){$GLOBALS['remote_count']++;if(strpos($url,'http://backend:3000/')!==0)throw new Exception('unexpected external HTTP');$body=json_decode($args['body'],true);$reply=array('success'=>true,'authorized'=>$GLOBALS['remote_boolean']);foreach(array('action_id','action_type','payload_digest','post_id')as$key)if(isset($body[$key]))$reply[$key]=$body[$key];if(isset($GLOBALS['force_action_type']))$reply['action_type']=$GLOBALS['force_action_type'];return array('code'=>200,'body'=>json_encode($reply));}
function wp_remote_retrieve_response_code($response){return$response['code'];}function wp_remote_retrieve_body($response){return$response['body'];}
class ATOZ_Growth_Pairing{const OPTION_CONNECTION_ID='fixture_connection';public static function is_connected(){return empty($GLOBALS['disconnected']);}}
class ATOZ_Growth_Site_Identity{public static function get_site_id(){return'33333333-3333-4333-8333-333333333333';}}
class ATOZ_Growth_REST_API{const NAMESPACE='atoz-growth/v1';}
class FixtureDB{public $posts='wp_posts';public $options='wp_options';public function prepare($sql,...$values){$GLOBALS['prepared_values']=$values;return str_replace(array('%d','%s'),array((string)$values[0],(string)$values[0]),$sql);}public function get_var($sql){return empty($GLOBALS['bad_engine'])?'InnoDB':'MyISAM';}public function query($sql){if(strpos($sql,'INSERT IGNORE')===0){$args=$GLOBALS['prepared_values'];if(isset($GLOBALS['options'][$args[0]]))return 0;$GLOBALS['options'][$args[0]]=unserialize($args[1]);return 1;}return 0;}public function get_row($sql){preg_match('/ID=(\d+)/',$sql,$m);return get_post((int)$m[1]);}}
$GLOBALS['wpdb']=new FixtureDB();
class Request{public $body;public $id=1;public $actionId;public $headers=array();public function __construct($body){$this->body=$body;}public function get_json_params(){return$this->body;}public function get_header($key){return isset($this->headers[$key])?$this->headers[$key]:str_repeat('A',43);}public function get_param($key){return$key==='action_id'?$this->actionId:$this->id;}}
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-endpoints.php';
require dirname(__DIR__).'/atoz-growth-wp-manager/includes/class-atoz-drafts.php';
$count=0;function check($condition,$label){global$count;if(!$condition){fwrite(STDERR,"FAIL: $label\n");exit(1);}$count++;}
function request($suffix,$type='create_post_draft',$payload=null){if($payload===null)$payload=array('title'=>'Synthetic title','content'=>'<p>Synthetic content</p>');return new Request(array('grant'=>str_repeat('A',43),'action_id'=>'44444444-4444-4444-8444-'.str_pad($suffix,12,'0',STR_PAD_LEFT),'action_type'=>$type,'payload_digest'=>hash('sha256',json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE)),'payload'=>$payload));}
if($mode!=='isolated'){
 check(!ATOZ_Growth_Endpoints::writes_enabled(),'write gate fails closed');check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('1'))),'no draft write authorization');
 check($GLOBALS['remote_count']===0&&$GLOBALS['write_count']===0,'no HTTP or write before valid isolated gate');
 if($mode!=='default')check(is_wp_error(ATOZ_Growth_Endpoints::endpoint('pairing/confirm')),'invalid test configuration never production fallback');
 echo"$count standalone draft $mode checks passed (not WordPress integration)\n";exit;
}
check(ATOZ_Growth_Endpoints::writes_enabled(),'explicit isolated gate enabled');
check(is_wp_error(ATOZ_Growth_Endpoints::block_external_test_http(false,array(),'https://api.atozgrowth.net/api/wp-manager/pairing/confirm')),'production HTTP blocked');
check(ATOZ_Growth_Endpoints::block_external_test_http(false,array(),'http://backend:3000/api/wp-manager/drafts/authorize')===false,'configured local callback allowed');
$bad=request('2');$bad->body['payload']['content']='<script>alert(1)</script>';check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute($bad))&&$GLOBALS['remote_count']===0,'unsafe HTML rejected before callback');
$bad=request('3');$bad->body['payload_digest']=str_repeat('0',64);check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute($bad)),'tampered digest rejected');
$bad=request('4');$bad->body['action_type']='publish_post';check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute($bad)),'publish action rejected');
$GLOBALS['deny_cap']=true;check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('5'))),'missing local WP capability denied');unset($GLOBALS['deny_cap']);
$GLOBALS['remote_boolean']='true';check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('6'))),'truthy callback string denied');$GLOBALS['remote_boolean']=true;
$GLOBALS['bad_engine']=true;check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('7'))),'nontransactional storage denied');unset($GLOBALS['bad_engine']);
$GLOBALS['force_action_type']='create_post_draft';check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('14','create_page_draft'))),'authoritative operation mismatch rejected');unset($GLOBALS['force_action_type']);
$post=request('8');check(ATOZ_Growth_Drafts::authorize_execute($post)===true,'approved exact grant accepted');$result=ATOZ_Growth_Drafts::execute($post);
check(!is_wp_error($result)&&$result['draft']['status']==='draft'&&$result['draft']['type']==='post','only draft post created');
check(is_wp_error(ATOZ_Growth_Drafts::execute($post))&&$GLOBALS['write_count']===1,'same durable action claim prevents duplicate');
$page=request('9','create_page_draft');check(ATOZ_Growth_Drafts::authorize_execute($page)===true,'page capability accepted');$result=ATOZ_Growth_Drafts::execute($page);check($result['draft']['type']==='page'&&$result['draft']['status']==='draft','page created unpublished');
$receipt=new Request(array());$receipt->actionId=$post->body['action_id'];$receipt->headers=array('X-AtoZ-Action-Type'=>$post->body['action_type'],'X-AtoZ-Payload-Digest'=>$post->body['payload_digest']);
$reads=isset($GLOBALS['receipt_reads'])?$GLOBALS['receipt_reads']:0;$GLOBALS['remote_boolean']=false;
check(is_wp_error(ATOZ_Growth_Drafts::authorize_receipt($receipt)),'receipt requires fresh backend authorization');
check((isset($GLOBALS['receipt_reads'])?$GLOBALS['receipt_reads']:0)===$reads,'unauthorized receipt never reads local receipt');$GLOBALS['remote_boolean']=true;
check(ATOZ_Growth_Drafts::authorize_receipt($receipt)===true,'completed receipt can reconcile with fresh exact grant');
check(ATOZ_Growth_Drafts::get_receipt($receipt)['draft']['id']===1&&$GLOBALS['write_count']===2,'receipt read never creates another draft');
$receipt->headers['X-AtoZ-Payload-Digest']=str_repeat('0',64);check(is_wp_error(ATOZ_Growth_Drafts::authorize_receipt($receipt)),'receipt payload mismatch denied');
$read=request('10');check(ATOZ_Growth_Drafts::authorize_read($read)===true,'draft read grant bound to post');$draft=ATOZ_Growth_Drafts::get_draft($read)['draft'];
$payload=array('title'=>'Updated','content'=>'<p>Updated</p>','post_id'=>1,'post_type'=>'post','expected_modified_gmt'=>$draft['modified_gmt'],'expected_content_digest'=>$draft['content_digest']);
$edit=request('11','edit_draft',$payload);check(ATOZ_Growth_Drafts::authorize_execute($edit)===true,'edit permission authorized');$result=ATOZ_Growth_Drafts::execute($edit);check($result['draft']['title']==='Updated'&&$result['draft']['status']==='draft','draft edited and read back');
$stale=request('12','edit_draft',$payload);check(ATOZ_Growth_Drafts::authorize_execute($stale)===true,'stale operation may authenticate');check(is_wp_error(ATOZ_Growth_Drafts::execute($stale))&&$GLOBALS['write_count']===3,'same-second stale digest blocks overwrite');
$GLOBALS['posts'][1]->post_status='publish';check(is_wp_error(ATOZ_Growth_Drafts::authorize_read($read)),'published content not inspectable');check(is_wp_error(ATOZ_Growth_Drafts::authorize_execute(request('13','edit_draft',$payload))),'published content cannot be edited');
check(strpos(json_encode($GLOBALS['options']),str_repeat('A',43))===false,'grant not persisted in receipts');
echo"$count standalone isolated draft checks passed (synthetic, not WordPress integration)\n";
