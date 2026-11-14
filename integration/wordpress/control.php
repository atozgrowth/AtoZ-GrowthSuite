<?php
// Fixture control ONLY. Never included in the plugin package or production images.
require '/var/www/html/wp-load.php';
header('Content-Type: application/json');
if (wp_get_environment_type()!=='local' || !defined('ATOZ_GROWTH_ISOLATED_TEST_MODE') || ATOZ_GROWTH_ISOLATED_TEST_MODE!==true || ($_SERVER['HTTP_X_FIXTURE_CONTROL']??'')!=='synthetic-fixture-control') { http_response_code(403);echo '{}';exit; }
$body=json_decode(file_get_contents('php://input'),true);
if (!is_array($body)) { http_response_code(400);echo '{}';exit; }
wp_set_current_user(1);
$op=$body['operation']??'';
$result=null;
if ($op==='pair') {
  $result=ATOZ_Growth_Pairing::confirm($body['connection_id']??'', $body['challenge']??'');
  $result=is_wp_error($result)?array('ok'=>false,'code'=>$result->get_error_code()):array('ok'=>true);
} elseif ($op==='post') {
  $p=get_post((int)($body['id']??0));
  $result=$p?array('id'=>(int)$p->ID,'type'=>$p->post_type,'status'=>$p->post_status,'title'=>$p->post_title,'content'=>$p->post_content,'modified_gmt'=>$p->post_modified_gmt):null;
} elseif ($op==='counts') {
  global $wpdb;
  $result=array('drafts'=>(int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status='draft' AND post_type IN ('post','page')"));
} elseif ($op==='actor_role') {
  $role=$body['role']??'';
  if (!in_array($role,array('subscriber','administrator'),true)) {http_response_code(400);exit;}
  $user=new WP_User(1);$user->set_role($role);$result=array('ok'=>true);
} elseif ($op==='modify_draft') {
  $id=(int)($body['id']??0);$p=get_post($id);
  if (!$p || $p->post_status!=='draft') {http_response_code(400);exit;}
  $r=wp_update_post(wp_slash(array('ID'=>$id,'post_content'=>'<p>Changed by synthetic external editor.</p>')),true);
  $result=array('ok'=>!is_wp_error($r));
} elseif ($op==='external_block') {
  $r=wp_remote_get('https://forbidden.example.test/');
  $result=array('blocked'=>is_wp_error($r));
} elseif ($op==='reset_pairing') {
  ATOZ_Growth_Pairing::mark_not_connected();$result=array('ok'=>true);
} else {http_response_code(400);echo '{}';exit;}
echo wp_json_encode($result);
