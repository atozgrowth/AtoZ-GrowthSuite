<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
/** Restricted unpublished draft operations, disabled outside an explicitly isolated fixture. */
class ATOZ_Growth_Drafts {
    private static function error( $code, $status = 403 ) {
        return new WP_Error( $code, 'The draft operation could not be authorized or verified.', array( 'status' => $status ) );
    }
    public static function register_routes() {
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/drafts/execute', array(
            'methods' => 'POST', 'callback' => array( __CLASS__, 'execute' ), 'permission_callback' => array( __CLASS__, 'authorize_execute' ),
        ) );
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/drafts/receipts/(?P<action_id>[0-9a-f-]{36})', array(
            'methods' => 'GET', 'callback' => array( __CLASS__, 'get_receipt' ), 'permission_callback' => array( __CLASS__, 'authorize_receipt' ),
        ) );
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/drafts/(?P<id>[1-9][0-9]*)', array(
            'methods' => 'GET', 'callback' => array( __CLASS__, 'get_draft' ), 'permission_callback' => array( __CLASS__, 'authorize_read' ),
        ) );
    }
    private static function uuid( $value ) {
        return is_string( $value ) && preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $value );
    }
    private static function digest( $value ) {
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
        if ( defined( 'JSON_UNESCAPED_LINE_TERMINATORS' ) ) { $flags |= JSON_UNESCAPED_LINE_TERMINATORS; }
        return hash( 'sha256', wp_json_encode( $value, $flags ) );
    }
    public static function content_digest( $title, $content ) { return self::digest( array( 'title' => $title, 'content' => $content ) ); }
    private static function actor() {
        if ( ! ATOZ_Growth_Endpoints::writes_enabled() || ! ATOZ_Growth_Pairing::is_connected() || ! defined( 'ATOZ_GROWTH_TEST_ACTOR_ID' ) ) { return false; }
        $id = ATOZ_GROWTH_TEST_ACTOR_ID;
        if ( ! is_int( $id ) || $id < 1 ) { return false; }
        $user = get_userdata( $id );
        return $user && user_can( $user, 'edit_posts' ) ? $user : false;
    }
    /** Detached canonical payload; unsafe HTML is rejected rather than silently changing approval. */
    private static function request_data( $request ) {
        $body = $request->get_json_params();
        if ( ! is_array( $body ) || count( $body ) !== 5 || ! isset( $body['grant'], $body['action_id'], $body['action_type'], $body['payload_digest'], $body['payload'] ) ||
            ! is_string( $body['grant'] ) || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $body['grant'] ) || ! self::uuid( $body['action_id'] ) ||
            ! is_string( $body['payload_digest'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $body['payload_digest'] ) ||
            ! in_array( $body['action_type'], array( 'create_post_draft', 'create_page_draft', 'edit_draft' ), true ) || ! is_array( $body['payload'] ) ) { return false; }
        $p = $body['payload']; $edit = 'edit_draft' === $body['action_type'];
        if ( count( $p ) !== ( $edit ? 6 : 2 ) || ! isset( $p['title'], $p['content'] ) || ! is_string( $p['title'] ) || ! is_string( $p['content'] ) ||
            '' === trim( $p['title'] ) || strlen( $p['title'] ) > 800 || strlen( $p['content'] ) > 100000 ||
            sanitize_text_field( $p['title'] ) !== $p['title'] || wp_kses_post( $p['content'] ) !== $p['content'] ) { return false; }
        $payload = array( 'title' => $p['title'], 'content' => $p['content'] );
        if ( $edit ) {
            if ( ! isset( $p['post_id'], $p['post_type'], $p['expected_modified_gmt'], $p['expected_content_digest'] ) || ! is_int( $p['post_id'] ) || $p['post_id'] < 1 ||
                ! in_array( $p['post_type'], array( 'post', 'page' ), true ) || ! is_string( $p['expected_modified_gmt'] ) ||
                ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $p['expected_modified_gmt'] ) ||
                ! is_string( $p['expected_content_digest'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $p['expected_content_digest'] ) ) { return false; }
            $payload['post_id'] = $p['post_id']; $payload['post_type'] = $p['post_type'];
            $payload['expected_modified_gmt'] = $p['expected_modified_gmt']; $payload['expected_content_digest'] = $p['expected_content_digest'];
        }
        if ( ! hash_equals( $body['payload_digest'], self::digest( $payload ) ) ) { return false; }
        return array( 'grant' => $body['grant'], 'action_id' => $body['action_id'], 'action_type' => $body['action_type'], 'payload_digest' => $body['payload_digest'], 'payload' => $payload );
    }
    private static function callback( $body ) {
        $endpoint = ATOZ_Growth_Endpoints::endpoint( 'drafts/authorize' );
        if ( is_wp_error( $endpoint ) ) { return $endpoint; }
        $response = wp_remote_post( $endpoint, array( 'timeout' => 8, 'redirection' => 0,
            'headers' => array( 'Accept' => 'application/json', 'Content-Type' => 'application/json' ), 'body' => wp_json_encode( $body ), 'data_format' => 'body' ) );
        if ( is_wp_error( $response ) ) { return self::error( 'atoz_draft_authorization_unavailable', 503 ); }
        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) || ! is_array( $data ) || ! isset( $data['success'], $data['authorized'] ) || true !== $data['success'] || true !== $data['authorized'] ) { return self::error( 'atoz_draft_not_authorized' ); }
        return $data;
    }
    private static function transactional_tables() {
        global $wpdb;
        foreach ( array( $wpdb->posts, $wpdb->options ) as $table ) {
            $engine = $wpdb->get_var( $wpdb->prepare( 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', $table ) );
            if ( 'innodb' !== strtolower( (string) $engine ) ) { return false; }
        }
        return true;
    }
    public static function authorize_execute( $request ) {
        $actor = self::actor(); $data = self::request_data( $request );
        if ( ! $actor || ! $data || ! self::transactional_tables() ) { return self::error( 'atoz_draft_disabled_or_invalid' ); }
        $approved = self::callback( array( 'grant' => $data['grant'], 'action_id' => $data['action_id'], 'action_type' => $data['action_type'], 'payload_digest' => $data['payload_digest'],
            'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ) ) );
        if ( is_wp_error( $approved ) ) { return $approved; }
        foreach ( array( 'action_id', 'action_type', 'payload_digest' ) as $key ) {
            if ( ! isset( $approved[ $key ] ) || ! is_string( $approved[ $key ] ) || ! hash_equals( $data[ $key ], $approved[ $key ] ) ) { return self::error( 'atoz_draft_binding_mismatch' ); }
        }
        $type = 'create_page_draft' === $data['action_type'] ? 'page' : 'post';
        if ( 'edit_draft' === $data['action_type'] ) {
            $post = get_post( $data['payload']['post_id'] );
            if ( ! $post || 'draft' !== $post->post_status || $post->post_type !== $data['payload']['post_type'] || ! user_can( $actor, 'edit_post', $post->ID ) ) { return self::error( 'atoz_draft_capability_denied' ); }
        } elseif ( ! user_can( $actor, 'page' === $type ? 'edit_pages' : 'edit_posts' ) ) { return self::error( 'atoz_draft_capability_denied' ); }
        return true;
    }
    private static function draft_record( $post ) {
        return array( 'id' => (int) $post->ID, 'type' => $post->post_type, 'status' => 'draft', 'title' => $post->post_title, 'content' => $post->post_content,
            'modified_gmt' => $post->post_modified_gmt, 'content_digest' => self::content_digest( $post->post_title, $post->post_content ) );
    }
    private static function response( $draft ) {
        return array( 'success' => true, 'identity' => array( 'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ) ), 'draft' => $draft );
    }
    /** Strict INSERT IGNORE: add_option is not sufficient (core uses a racing UPSERT). */
    private static function claim_option( $key, $value ) {
        global $wpdb;
        $inserted = $wpdb->query( $wpdb->prepare(
            "INSERT IGNORE INTO `{$wpdb->options}` (option_name,option_value,autoload) VALUES (%s,%s,'no')",
            $key, maybe_serialize( $value )
        ) );
        if ( 1 !== $inserted ) { return false; }
        wp_cache_delete( $key, 'options' );
        wp_cache_delete( 'notoptions', 'options' );
        return true;
    }
    public static function execute( $request ) {
        global $wpdb;
        $data = self::request_data( $request ); $actor = self::actor();
        if ( ! $data || ! $actor || ! self::transactional_tables() ) { return self::error( 'atoz_draft_disabled_or_invalid' ); }
        $key = 'atoz_draft_action_' . str_replace( '-', '', $data['action_id'] );
        // Strict database insert is the durable claim. Core add_option UPSERT is not trusted.
        if ( ! self::claim_option( $key, array( 'status' => 'executing', 'digest' => $data['payload_digest'], 'action_type' => $data['action_type'], 'connection_id' => get_option( ATOZ_Growth_Pairing::OPTION_CONNECTION_ID ), 'at' => time() ) ) ) { return self::error( 'atoz_draft_already_claimed', 409 ); }
        $p = $data['payload']; $lock = null; $post_id = null; $transaction = false;
        try {
            if ( false === $wpdb->query( 'START TRANSACTION' ) ) { throw new Exception( 'transaction_unavailable' ); }
            $transaction = true;
            if ( 'edit_draft' === $data['action_type'] ) {
                $post_id = $p['post_id']; $lock = 'atoz_draft_edit_lock_' . $post_id;
                if ( ! self::claim_option( $lock, $data['action_id'] ) ) { $lock = null; throw new Exception( 'edit_locked' ); }
                clean_post_cache( $post_id );
                $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE", $post_id ) ); $existing = $row ? get_post( $row ) : null;
                if ( ! $existing || 'draft' !== $existing->post_status || $existing->post_type !== $p['post_type'] || ! user_can( $actor, 'edit_post', $post_id ) ||
                    $existing->post_modified_gmt !== $p['expected_modified_gmt'] || ! hash_equals( $p['expected_content_digest'], self::content_digest( $existing->post_title, $existing->post_content ) ) ) { throw new Exception( 'stale_or_forbidden' ); }
                $result = wp_update_post( wp_slash( array( 'ID' => $post_id, 'post_title' => $p['title'], 'post_content' => $p['content'], 'post_status' => 'draft' ) ), true );
            } else {
                $result = wp_insert_post( wp_slash( array( 'post_type' => 'create_page_draft' === $data['action_type'] ? 'page' : 'post', 'post_status' => 'draft', 'post_title' => $p['title'], 'post_content' => $p['content'], 'post_author' => (int) $actor->ID ) ), true );
            }
            if ( is_wp_error( $result ) || ! is_int( $result ) || $result < 1 ) { throw new Exception( 'write_failed' ); }
            $post_id = $result; clean_post_cache( $post_id ); $post = get_post( $post_id );
            if ( ! $post || 'draft' !== $post->post_status || ! hash_equals( self::content_digest( $p['title'], $p['content'] ), self::content_digest( $post->post_title, $post->post_content ) ) ) { throw new Exception( 'readback_failed' ); }
            $draft = self::draft_record( $post );
            if ( ! update_option( $key, array( 'status' => 'succeeded', 'digest' => $data['payload_digest'], 'action_type' => $data['action_type'], 'connection_id' => get_option( ATOZ_Growth_Pairing::OPTION_CONNECTION_ID ), 'post_id' => $post_id ), false ) ) { throw new Exception( 'receipt_failed' ); }
            if ( false === $wpdb->query( 'COMMIT' ) ) { throw new Exception( 'commit_uncertain' ); }
            $transaction = false;
            $response = self::response( $draft ); $response['action_id'] = $data['action_id']; $response['payload_digest'] = $data['payload_digest'];
            return rest_ensure_response( $response );
        } catch ( Throwable $error ) {
            if ( $transaction ) { $wpdb->query( 'ROLLBACK' ); }
            if ( null !== $post_id ) { clean_post_cache( $post_id ); }
            // Never retry automatically: a write or external hook may already have committed.
            update_option( $key, array( 'status' => 'reconciliation_required', 'digest' => $data['payload_digest'], 'action_type' => $data['action_type'], 'post_id' => $post_id ), false );
            return self::error( 'atoz_draft_reconciliation_required', 409 );
        } finally { if ( null !== $lock ) { delete_option( $lock ); } }
    }
    public static function authorize_read( $request ) {
        $actor = self::actor(); $id = (int) $request->get_param( 'id' ); $grant = trim( (string) $request->get_header( 'X-AtoZ-Inspection-Grant' ) );
        if ( ! $actor || $id < 1 || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) ) { return self::error( 'atoz_draft_not_readable' ); }
        $approved = self::callback( array( 'grant' => $grant, 'scope' => 'draft_read', 'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ), 'post_id' => $id ) );
        if ( is_wp_error( $approved ) ) { return $approved; }
        if ( ! isset( $approved['post_id'] ) || ! is_int( $approved['post_id'] ) || $approved['post_id'] !== $id ) { return self::error( 'atoz_draft_binding_mismatch' ); }
        $post = get_post( $id );
        return $post && 'draft' === $post->post_status && in_array( $post->post_type, array( 'post', 'page' ), true ) && user_can( $actor, 'edit_post', $id ) ? true : self::error( 'atoz_draft_not_readable' );
    }
    private static function receipt_request( $request ) {
        $action = $request->get_param( 'action_id' );
        $type = $request->get_header( 'X-AtoZ-Action-Type' ); $digest = $request->get_header( 'X-AtoZ-Payload-Digest' );
        $grant = $request->get_header( 'X-AtoZ-Inspection-Grant' );
        if ( ! self::uuid( $action ) || ! in_array( $type, array( 'create_post_draft', 'create_page_draft', 'edit_draft' ), true ) ||
             ! is_string( $digest ) || ! preg_match( '/^[a-f0-9]{64}$/', $digest ) || ! is_string( $grant ) || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) ) { return false; }
        return array( 'action_id' => $action, 'action_type' => $type, 'payload_digest' => $digest, 'grant' => $grant );
    }
    private static function verified_receipt_post( $data ) {
        $receipt = get_option( 'atoz_draft_action_' . str_replace( '-', '', $data['action_id'] ) );
        $connection = get_option( ATOZ_Growth_Pairing::OPTION_CONNECTION_ID );
        if ( ! is_array( $receipt ) || ! isset( $receipt['status'], $receipt['post_id'], $receipt['digest'], $receipt['action_type'], $receipt['connection_id'] ) ||
             'succeeded' !== $receipt['status'] || ! is_int( $receipt['post_id'] ) || $receipt['post_id'] < 1 ||
             ! is_string( $receipt['digest'] ) || ! hash_equals( $data['payload_digest'], $receipt['digest'] ) ||
             $data['action_type'] !== $receipt['action_type'] || ! is_string( $connection ) || $connection !== $receipt['connection_id'] ) { return false; }
        $post = get_post( $receipt['post_id'] ); $actor = self::actor();
        if ( ! $actor || ! $post || 'draft' !== $post->post_status || ! in_array( $post->post_type, array( 'post', 'page' ), true ) || ! user_can( $actor, 'edit_post', $post->ID ) ) { return false; }
        return $post;
    }
    public static function authorize_receipt( $request ) {
        $data = self::receipt_request( $request );
        if ( ! self::actor() || ! $data ) { return self::error( 'atoz_receipt_not_available', 409 ); }
        // Do not look up a local receipt until a fresh exact-tuple backend grant is consumed.
        $approved = self::callback( array( 'grant' => $data['grant'], 'scope' => 'draft_receipt', 'action_id' => $data['action_id'],
            'action_type' => $data['action_type'], 'payload_digest' => $data['payload_digest'],
            'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ) ) );
        if ( is_wp_error( $approved ) ) { return $approved; }
        foreach ( array( 'action_id', 'action_type', 'payload_digest' ) as $key ) {
            if ( ! isset( $approved[ $key ] ) || ! is_string( $approved[ $key ] ) || ! hash_equals( $data[ $key ], $approved[ $key ] ) ) { return self::error( 'atoz_receipt_not_available', 409 ); }
        }
        return self::verified_receipt_post( $data ) ? true : self::error( 'atoz_receipt_not_available', 409 );
    }
    public static function get_receipt( $request ) {
        $data = self::receipt_request( $request ); $post = $data ? self::verified_receipt_post( $data ) : false;
        if ( ! $post ) { return self::error( 'atoz_receipt_not_available', 409 ); }
        $response = self::response( self::draft_record( $post ) );
        $response['action_id'] = $data['action_id']; $response['action_type'] = $data['action_type']; $response['payload_digest'] = $data['payload_digest'];
        return rest_ensure_response( $response );
    }
    public static function get_draft( $request ) {
        $id = (int) $request->get_param( 'id' ); $post = get_post( $id ); $actor = self::actor();
        if ( ! $actor || ! $post || ! user_can( $actor, 'edit_post', $id ) || 'draft' !== $post->post_status || ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) { return self::error( 'atoz_draft_not_readable' ); }
        return rest_ensure_response( self::response( self::draft_record( $post ) ) );
    }
}
add_action( 'rest_api_init', array( 'ATOZ_Growth_Drafts', 'register_routes' ) );
