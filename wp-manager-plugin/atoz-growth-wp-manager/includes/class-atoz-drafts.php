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
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/drafts/(?P<id>[1-9][0-9]*)/revisions', array(
            'methods' => 'GET', 'callback' => array( __CLASS__, 'get_revisions' ), 'permission_callback' => array( __CLASS__, 'authorize_read' ),
        ) );
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/drafts/(?P<id>[1-9][0-9]*)/revisions/(?P<revision_id>[1-9][0-9]*)', array(
            'methods' => 'GET', 'callback' => array( __CLASS__, 'get_revision' ), 'permission_callback' => array( __CLASS__, 'authorize_read' ),
        ) );
        register_rest_route( ATOZ_Growth_REST_API::NAMESPACE, '/published/(?P<id>[1-9][0-9]*)', array(
            'methods' => 'GET', 'callback' => array( __CLASS__, 'get_published' ), 'permission_callback' => array( __CLASS__, 'authorize_published_read' ),
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
            ! in_array( $body['action_type'], array( 'create_post_draft', 'create_page_draft', 'edit_draft', 'publish_draft', 'restore_revision' ), true ) || ! is_array( $body['payload'] ) ) { return false; }
        $p = $body['payload']; $restore = 'restore_revision' === $body['action_type']; $edit = in_array( $body['action_type'], array( 'edit_draft', 'publish_draft', 'restore_revision' ), true );
        $allowed = array( 'title', 'content' ); if ( $edit ) { $allowed = array_merge( $allowed, array( 'post_id', 'post_type', 'expected_modified_gmt', 'expected_content_digest' ) ); }
        if ( $restore ) { $allowed = array_merge( $allowed, array( 'revision_id', 'expected_revision_digest' ) ); }
        foreach ( array( 'category_ids', 'tag_ids', 'featured_media_id' ) as $optional ) { if ( array_key_exists( $optional, $p ) ) { $allowed[] = $optional; } }
        if ( count( $p ) !== count( $allowed ) || array_diff( array_keys( $p ), $allowed ) || array_diff( $allowed, array_keys( $p ) ) || ! isset( $p['title'], $p['content'] ) || ! is_string( $p['title'] ) || ! is_string( $p['content'] ) ||
            ( '' === trim( $p['title'] ) && ! $restore ) || strlen( $p['title'] ) > 800 || strlen( $p['content'] ) > 100000 ||
            sanitize_text_field( $p['title'] ) !== $p['title'] || wp_kses_post( $p['content'] ) !== $p['content'] ) { return false; }
        $payload = array( 'title' => $p['title'], 'content' => $p['content'] );
        if ( $edit ) {
            if ( ! isset( $p['post_id'], $p['post_type'], $p['expected_modified_gmt'], $p['expected_content_digest'] ) || ! is_int( $p['post_id'] ) || $p['post_id'] < 1 ||
                ! in_array( $p['post_type'], array( 'post', 'page' ), true ) || ! is_string( $p['expected_modified_gmt'] ) ||
                ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $p['expected_modified_gmt'] ) ||
                ! is_string( $p['expected_content_digest'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $p['expected_content_digest'] ) ) { return false; }
            $payload['post_id'] = $p['post_id']; $payload['post_type'] = $p['post_type'];
            $payload['expected_modified_gmt'] = $p['expected_modified_gmt']; $payload['expected_content_digest'] = $p['expected_content_digest'];
            if ( 'publish_draft' === $body['action_type'] && ! hash_equals( $payload['expected_content_digest'], self::content_digest( $payload['title'], $payload['content'] ) ) ) { return false; }
        }
        foreach ( array( 'category_ids', 'tag_ids' ) as $field ) {
            if ( array_key_exists( $field, $p ) ) {
                if ( ! is_array( $p[ $field ] ) || count( $p[ $field ] ) > 100 ) { return false; }
                $ids = array(); foreach ( $p[ $field ] as $term_id ) { if ( ! is_int( $term_id ) || $term_id < 1 || in_array( $term_id, $ids, true ) ) { return false; } $ids[] = $term_id; }
                sort( $ids, SORT_NUMERIC ); $payload[ $field ] = $ids;
            }
        }
        if ( array_key_exists( 'featured_media_id', $p ) ) { if ( ! is_int( $p['featured_media_id'] ) || $p['featured_media_id'] < 1 ) { return false; } $payload['featured_media_id'] = $p['featured_media_id']; }
        if ( $restore ) {
            if ( ! isset( $p['revision_id'], $p['expected_revision_digest'] ) || ! is_int( $p['revision_id'] ) || $p['revision_id'] < 1 || ! is_string( $p['expected_revision_digest'] ) || ! preg_match( '/^[a-f0-9]{64}$/', $p['expected_revision_digest'] ) ) { return false; }
            if ( ! hash_equals( $p['expected_revision_digest'], self::content_digest( $payload['title'], $payload['content'] ) ) ) { return false; }
            $payload['revision_id'] = $p['revision_id']; $payload['expected_revision_digest'] = $p['expected_revision_digest'];
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
    private static function transactional_tables( $payload = array() ) {
        global $wpdb;
        $tables = array( $wpdb->posts, $wpdb->options );
        if ( isset( $payload['category_ids'] ) || isset( $payload['tag_ids'] ) ) { $tables = array_merge( $tables, array( $wpdb->term_relationships, $wpdb->term_taxonomy, $wpdb->terms ) ); }
        if ( isset( $payload['featured_media_id'] ) || isset( $payload['post_id'] ) ) { $tables[] = $wpdb->postmeta; }
        foreach ( array_unique( $tables ) as $table ) {
            $engine = $wpdb->get_var( $wpdb->prepare( 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', $table ) );
            if ( 'innodb' !== strtolower( (string) $engine ) ) { return false; }
        }
        return true;
    }
    private static function validate_assignments( $payload, $type, $actor ) {
        foreach ( array( 'category_ids' => 'category', 'tag_ids' => 'post_tag' ) as $field => $taxonomy ) {
            if ( ! array_key_exists( $field, $payload ) ) { continue; }
            $taxonomy_object = get_taxonomy( $taxonomy );
            if ( 'post' !== $type || ! $taxonomy_object || ! user_can( $actor, $taxonomy_object->cap->assign_terms ) ) { return false; }
            foreach ( $payload[ $field ] as $term_id ) { $term = get_term( $term_id, $taxonomy ); if ( ! $term || is_wp_error( $term ) ) { return false; } }
        }
        if ( isset( $payload['featured_media_id'] ) ) {
            $media = get_post( $payload['featured_media_id'] );
            if ( ! $media || 'attachment' !== $media->post_type || 'trash' === $media->post_status || 0 !== strpos( (string) get_post_mime_type( $media->ID ), 'image/' ) || ! user_can( $actor, 'edit_post', $media->ID ) ) { return false; }
        }
        return true;
    }
    public static function authorize_execute( $request ) {
        $actor = self::actor(); $data = self::request_data( $request );
        if ( ! $actor || ! $data || ! self::transactional_tables( $data['payload'] ) || ( 'publish_draft' === $data['action_type'] && ! ATOZ_Growth_Endpoints::publishing_enabled() ) ) { return self::error( 'atoz_draft_disabled_or_invalid' ); }
        $approved = self::callback( array( 'grant' => $data['grant'], 'action_id' => $data['action_id'], 'action_type' => $data['action_type'], 'payload_digest' => $data['payload_digest'],
            'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ) ) );
        if ( is_wp_error( $approved ) ) { return $approved; }
        foreach ( array( 'action_id', 'action_type', 'payload_digest' ) as $key ) {
            if ( ! isset( $approved[ $key ] ) || ! is_string( $approved[ $key ] ) || ! hash_equals( $data[ $key ], $approved[ $key ] ) ) { return self::error( 'atoz_draft_binding_mismatch' ); }
        }
        $type = 'create_page_draft' === $data['action_type'] ? 'page' : 'post';
        if ( in_array( $data['action_type'], array( 'edit_draft', 'publish_draft', 'restore_revision' ), true ) ) {
            $post = get_post( $data['payload']['post_id'] );
            if ( ! $post || 'draft' !== $post->post_status || $post->post_type !== $data['payload']['post_type'] || ! user_can( $actor, 'edit_post', $post->ID ) ) { return self::error( 'atoz_draft_capability_denied' ); }
            if ( 'publish_draft' === $data['action_type'] && ( ! ATOZ_Growth_Endpoints::publishing_enabled() || ! user_can( $actor, 'page' === $post->post_type ? 'publish_pages' : 'publish_posts' ) ) ) { return self::error( 'atoz_publish_capability_denied' ); }
            if ( 'restore_revision' === $data['action_type'] && ! self::verified_revision( $data['payload']['revision_id'], $post->ID, $data['payload']['expected_revision_digest'] ) ) { return self::error( 'atoz_revision_not_verified' ); }
        } elseif ( ! user_can( $actor, 'page' === $type ? 'edit_pages' : 'edit_posts' ) ) { return self::error( 'atoz_draft_capability_denied' ); }
        if ( ! self::validate_assignments( $data['payload'], $type, $actor ) ) { return self::error( 'atoz_draft_assignment_denied' ); }
        return true;
    }
    private static function draft_record( $post ) {
        $categories = wp_get_post_terms( $post->ID, 'category', array( 'fields' => 'ids' ) );
        $tags = wp_get_post_terms( $post->ID, 'post_tag', array( 'fields' => 'ids' ) );
        if ( is_wp_error( $categories ) ) { $categories = array(); } if ( is_wp_error( $tags ) ) { $tags = array(); }
        $categories = array_map( 'intval', $categories ); $tags = array_map( 'intval', $tags ); sort( $categories, SORT_NUMERIC ); sort( $tags, SORT_NUMERIC );
        $thumbnail = get_post_thumbnail_id( $post->ID );
        return array( 'id' => (int) $post->ID, 'type' => $post->post_type, 'status' => $post->post_status, 'title' => $post->post_title, 'content' => $post->post_content,
            'modified_gmt' => $post->post_modified_gmt, 'content_digest' => self::content_digest( $post->post_title, $post->post_content ),
            'category_ids' => $categories, 'tag_ids' => $tags, 'featured_media_id' => $thumbnail ? (int) $thumbnail : null );
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
        if ( ! $data || ! $actor || ! self::transactional_tables( $data['payload'] ) ) { return self::error( 'atoz_draft_disabled_or_invalid' ); }
        $key = 'atoz_draft_action_' . str_replace( '-', '', $data['action_id'] );
        // Strict database insert is the durable claim. Core add_option UPSERT is not trusted.
        if ( ! self::claim_option( $key, array( 'status' => 'executing', 'digest' => $data['payload_digest'], 'action_type' => $data['action_type'], 'connection_id' => get_option( ATOZ_Growth_Pairing::OPTION_CONNECTION_ID ), 'at' => time() ) ) ) { return self::error( 'atoz_draft_already_claimed', 409 ); }
        $p = $data['payload']; $lock = null; $post_id = null; $transaction = false;
        try {
            if ( false === $wpdb->query( 'START TRANSACTION' ) ) { throw new Exception( 'transaction_unavailable' ); }
            $transaction = true;
            if ( in_array( $data['action_type'], array( 'edit_draft', 'publish_draft', 'restore_revision' ), true ) ) {
                $post_id = $p['post_id']; $lock = 'atoz_draft_edit_lock_' . $post_id;
                if ( ! self::claim_option( $lock, $data['action_id'] ) ) { $lock = null; throw new Exception( 'edit_locked' ); }
                clean_post_cache( $post_id );
                $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE", $post_id ) ); $existing = $row ? get_post( $row ) : null;
                if ( ! $existing || 'draft' !== $existing->post_status || $existing->post_type !== $p['post_type'] || ! user_can( $actor, 'edit_post', $post_id ) ||
                    $existing->post_modified_gmt !== $p['expected_modified_gmt'] || ! hash_equals( $p['expected_content_digest'], self::content_digest( $existing->post_title, $existing->post_content ) ) ) { throw new Exception( 'stale_or_forbidden' ); }
                $target_status = 'publish_draft' === $data['action_type'] ? 'publish' : 'draft';
                if ( 'publish_draft' === $data['action_type'] && ( ! ATOZ_Growth_Endpoints::publishing_enabled() || ! user_can( $actor, $existing->post_type === 'page' ? 'publish_pages' : 'publish_posts' ) || ! hash_equals( $p['expected_content_digest'], self::content_digest( $existing->post_title, $existing->post_content ) ) ) ) { throw new Exception( 'publish_capability_or_payload_changed' ); }
                if ( 'restore_revision' === $data['action_type'] ) {
                    if ( ! self::verified_revision( $p['revision_id'], $post_id, $p['expected_revision_digest'] ) ) { throw new Exception( 'revision_changed' ); }
                    $result = wp_restore_post_revision( $p['revision_id'], array( 'post_title' => 'post_title', 'post_content' => 'post_content' ) );
                } else { $result = wp_update_post( wp_slash( array( 'ID' => $post_id, 'post_title' => $p['title'], 'post_content' => $p['content'], 'post_status' => $target_status ) ), true ); }
            } else {
                $result = wp_insert_post( wp_slash( array( 'post_type' => 'create_page_draft' === $data['action_type'] ? 'page' : 'post', 'post_status' => 'draft', 'post_title' => $p['title'], 'post_content' => $p['content'], 'post_author' => (int) $actor->ID ) ), true );
            }
            if ( is_wp_error( $result ) || ! is_int( $result ) || $result < 1 ) { throw new Exception( 'write_failed' ); }
            if ( array_key_exists( 'category_ids', $p ) ) { $terms = wp_set_post_terms( $result, $p['category_ids'], 'category', false ); if ( is_wp_error( $terms ) ) { throw new Exception( 'category_write_failed' ); } }
            if ( array_key_exists( 'tag_ids', $p ) ) { $terms = wp_set_post_terms( $result, $p['tag_ids'], 'post_tag', false ); if ( is_wp_error( $terms ) ) { throw new Exception( 'tag_write_failed' ); } }
            if ( array_key_exists( 'featured_media_id', $p ) && ! set_post_thumbnail( $result, $p['featured_media_id'] ) ) { throw new Exception( 'featured_image_write_failed' ); }
            $post_id = $result; clean_post_cache( $post_id ); $post = get_post( $post_id );
            $expected_status = 'publish_draft' === $data['action_type'] ? 'publish' : 'draft';
            if ( ! $post || $expected_status !== $post->post_status || ! hash_equals( self::content_digest( $p['title'], $p['content'] ), self::content_digest( $post->post_title, $post->post_content ) ) ) { throw new Exception( 'readback_failed' ); }
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
        if ( ! self::uuid( $action ) || ! in_array( $type, array( 'create_post_draft', 'create_page_draft', 'edit_draft', 'publish_draft', 'restore_revision' ), true ) ||
             ! is_string( $digest ) || ! preg_match( '/^[a-f0-9]{64}$/', $digest ) || ! is_string( $grant ) || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) ) { return false; }
        return array( 'action_id' => $action, 'action_type' => $type, 'payload_digest' => $digest, 'grant' => $grant );
    }
    private static function verified_receipt_post( $data ) {
        $receipt = get_option( 'atoz_draft_action_' . str_replace( '-', '', $data['action_id'] ) );
        $connection = get_option( ATOZ_Growth_Pairing::OPTION_CONNECTION_ID );
        $expected_status = 'publish_draft' === $data['action_type'] ? 'publish' : 'draft';
        if ( ! is_array( $receipt ) || ! isset( $receipt['status'], $receipt['post_id'], $receipt['digest'], $receipt['action_type'], $receipt['connection_id'] ) ||
             'succeeded' !== $receipt['status'] || ! is_int( $receipt['post_id'] ) || $receipt['post_id'] < 1 ||
             ! is_string( $receipt['digest'] ) || ! hash_equals( $data['payload_digest'], $receipt['digest'] ) ||
             $data['action_type'] !== $receipt['action_type'] || ! is_string( $connection ) || $connection !== $receipt['connection_id'] ) { return false; }
        $post = get_post( $receipt['post_id'] ); $actor = self::actor();
        if ( ! $actor || ! $post || $expected_status !== $post->post_status || ! in_array( $post->post_type, array( 'post', 'page' ), true ) || ! user_can( $actor, 'edit_post', $post->ID ) || ( 'publish' === $expected_status && ( ! ATOZ_Growth_Endpoints::publishing_enabled() || ! user_can( $actor, $post->post_type === 'page' ? 'publish_pages' : 'publish_posts' ) ) ) ) { return false; }
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
    public static function authorize_published_read( $request ) {
        $id = (int) $request->get_param( 'id' );
        $grant = trim( (string) $request->get_header( 'X-AtoZ-Inspection-Grant' ) );
        $action_id = (string) $request->get_header( 'X-AtoZ-Action-Id' );
        $digest = (string) $request->get_header( 'X-AtoZ-Payload-Digest' );
        $actor = self::actor();
        if ( ! $actor || ! ATOZ_Growth_Endpoints::publishing_enabled() || $id < 1 || ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) || ! self::uuid( $action_id ) || ! preg_match( '/^[a-f0-9]{64}$/', $digest ) || 'publish_draft' !== $request->get_header( 'X-AtoZ-Action-Type' ) ) { return self::error( 'atoz_published_read_not_authorized' ); }
        $approved = self::callback( array( 'grant' => $grant, 'scope' => 'published_read', 'site_id' => ATOZ_Growth_Site_Identity::get_site_id(), 'site_url' => untrailingslashit( home_url( '/' ) ), 'post_id' => $id, 'action_id' => $action_id, 'action_type' => 'publish_draft', 'payload_digest' => $digest ) );
        if ( is_wp_error( $approved ) || ! isset( $approved['post_id'], $approved['action_id'], $approved['action_type'], $approved['payload_digest'] ) || $approved['post_id'] !== $id || ! hash_equals( $action_id, (string) $approved['action_id'] ) || ! hash_equals( $digest, (string) $approved['payload_digest'] ) ) { return self::error( 'atoz_published_read_not_authorized' ); }
        $post = get_post( $id );
        return $post && 'publish' === $post->post_status && user_can( $actor, 'edit_post', $id ) && user_can( $actor, $post->post_type === 'page' ? 'publish_pages' : 'publish_posts' ) ? true : self::error( 'atoz_published_read_not_available' );
    }
    public static function get_published( $request ) {
        $post = get_post( (int) $request->get_param( 'id' ) );
        if ( ! $post || 'publish' !== $post->post_status ) { return self::error( 'atoz_published_read_not_available', 404 ); }
        return rest_ensure_response( self::response( self::draft_record( $post ) ) );
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
    private static function revision_record( $revision ) {
        return array( 'id' => (int) $revision->ID, 'parent_id' => (int) $revision->post_parent, 'modified_gmt' => $revision->post_modified_gmt,
            'title' => $revision->post_title, 'content' => $revision->post_content, 'content_digest' => self::content_digest( $revision->post_title, $revision->post_content ) );
    }
    private static function verified_revision( $revision_id, $parent_id, $expected_digest ) {
        $revision = get_post( $revision_id );
        return $revision && 'revision' === $revision->post_type && (int) $revision->post_parent === (int) $parent_id &&
            hash_equals( $expected_digest, self::content_digest( $revision->post_title, $revision->post_content ) );
    }
    public static function get_revisions( $request ) {
        $parent_id = (int) $request->get_param( 'id' ); $parent = get_post( $parent_id ); $actor = self::actor();
        if ( ! $actor || ! $parent || 'draft' !== $parent->post_status || ! user_can( $actor, 'edit_post', $parent_id ) ) { return self::error( 'atoz_revision_not_available' ); }
        $items = array(); foreach ( wp_get_post_revisions( $parent_id, array( 'posts_per_page' => 100, 'orderby' => 'date', 'order' => 'DESC' ) ) as $revision ) { $items[] = self::revision_record( $revision ); }
        return rest_ensure_response( array( 'success' => true, 'revisions' => $items ) );
    }
    public static function get_revision( $request ) {
        $parent_id = (int) $request->get_param( 'id' ); $revision_id = (int) $request->get_param( 'revision_id' );
        $parent = get_post( $parent_id ); $revision = get_post( $revision_id ); $actor = self::actor();
        if ( ! $actor || ! $parent || 'draft' !== $parent->post_status || ! user_can( $actor, 'edit_post', $parent_id ) || ! $revision || 'revision' !== $revision->post_type || (int) $revision->post_parent !== $parent_id ) { return self::error( 'atoz_revision_not_available' ); }
        return rest_ensure_response( array( 'success' => true, 'revision' => self::revision_record( $revision ) ) );
    }
}
add_action( 'rest_api_init', array( 'ATOZ_Growth_Drafts', 'register_routes' ) );
