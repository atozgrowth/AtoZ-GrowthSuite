<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class ATOZ_Growth_REST_API {

    const INSPECTION_AUTHORIZE_ENDPOINT = 'https://api.atozgrowth.net/api/wp-manager/inspection/authorize';
    const NAMESPACE = 'atoz-growth/v1';

    public static function init() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes() {

        register_rest_route(
            self::NAMESPACE,
            '/status',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'get_status' ),
                'permission_callback' => '__return_true',
            )
        );

        register_rest_route(
            self::NAMESPACE,
            '/site',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'get_site' ),
                'permission_callback' => array( __CLASS__, 'admin_permission' ),
            )
        );
        register_rest_route(
            self::NAMESPACE,
            '/inspection',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'get_inspection' ),
                'permission_callback' => array( __CLASS__, 'authorize_inspection' ),
            )
        );

        foreach ( array( 'posts', 'pages', 'media', 'plugins', 'themes' ) as $resource ) {
            register_rest_route(
                self::NAMESPACE,
                '/' . $resource,
                array(
                    'methods'             => WP_REST_Server::READABLE,
                    'callback'            => array( __CLASS__, 'get_' . $resource ),
                    'permission_callback' => array( __CLASS__, 'authorize_inventory' ),
                    'args'                => in_array( $resource, array( 'plugins', 'themes' ), true ) ? array() : array(
                        'page' => array(
                            'default' => 1,
                            'validate_callback' => array( __CLASS__, 'validate_page' ),
                        ),
                        'per_page' => array(
                            'default' => 20,
                            'validate_callback' => array( __CLASS__, 'validate_per_page' ),
                        ),
                    ),
                )
            );
        }

    }

    public static function admin_permission() {
        return current_user_can( 'manage_options' );
    }

    public static function get_status() {
        return rest_ensure_response(
            array(
                'success' => true,
                'service' => 'A to Z Growth WP Manager',
                'version' => ATOZ_GROWTH_WP_MANAGER_VERSION,
                'mode'    => ATOZ_Growth_Endpoints::writes_enabled() ? 'isolated-drafts' : 'read-only',
                'publishing_enabled' => false,
            )
        );
    }

    public static function get_site() {
        global $wp_version;

        return rest_ensure_response(
            array(
                'success'    => true,
                'connection' => ATOZ_Growth_Pairing::get_safe_connection_info(),
                'site'       => array(
                    'name'              => get_bloginfo( 'name' ),
                    'url'               => home_url(),
                    'wordpress_version' => $wp_version,
                    'php_version'       => PHP_VERSION,
                    'language'          => get_locale(),
                    'multisite'         => is_multisite(),
                    'timezone'          => wp_timezone_string(),
                ),
            )
        );
    }
    /**
     * Validate a short-lived backend-issued grant for this connected site.
     *
     * The grant is relayed once and is never persisted or logged by the plugin.
     *
     * @param WP_REST_Request $request REST request.
     * @return true|WP_Error
     */
    public static function authorize_inspection( $request ) {

        if ( ! ATOZ_Growth_Pairing::is_connected() ) {
            return new WP_Error(
                'atoz_not_connected',
                'This WordPress site is not connected.',
                array( 'status' => 403 )
            );
        }

        $grant = trim( (string) $request->get_header( 'X-AtoZ-Inspection-Grant' ) );

        if ( ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) ) {
            return new WP_Error(
                'atoz_invalid_inspection_grant',
                'The inspection grant is invalid.',
                array( 'status' => 403 )
            );
        }

        $endpoint = ATOZ_Growth_Endpoints::endpoint( 'inspection/authorize' );
        if ( is_wp_error( $endpoint ) ) { return $endpoint; }
        $response = wp_remote_post(
            $endpoint,
            array(
                'timeout'     => 8,
                'redirection' => 0,
                'headers'     => array(
                    'Accept'       => 'application/json',
                    'Content-Type' => 'application/json',
                ),
                'body'        => wp_json_encode(
                    array(
                        'grant'    => $grant,
                        'site_id'  => ATOZ_Growth_Site_Identity::get_site_id(),
                        'site_url' => untrailingslashit( home_url( '/' ) ),
                    )
                ),
                'data_format' => 'body',
            )
        );

        if ( is_wp_error( $response ) ) {
            return new WP_Error(
                'atoz_inspection_authorization_unavailable',
                'Inspection authorization is temporarily unavailable.',
                array( 'status' => 503 )
            );
        }

        $status_code = (int) wp_remote_retrieve_response_code( $response );
        $payload     = json_decode( wp_remote_retrieve_body( $response ), true );

        if (
            200 === $status_code &&
            is_array( $payload ) &&
            isset( $payload['success'] ) && true === $payload['success'] &&
            isset( $payload['authorized'] ) && true === $payload['authorized']
        ) {
            return true;
        }

        return new WP_Error(
            'atoz_inspection_not_authorized',
            'The inspection grant is invalid or expired.',
            array( 'status' => 403 )
        );
    }

    /**
     * Return safe, read-only site metadata.
     */
    public static function get_inspection() {
        global $wp_version;

        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $installed_plugins = get_plugins();
        $active_plugins    = (array) get_option( 'active_plugins', array() );
        $network_plugins   = is_multisite()
            ? array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) )
            : array();
        $active_plugins    = array_unique(
            array_merge(
                $active_plugins,
                $network_plugins
            )
        );
        $active_count      = count(
            array_intersect(
                array_keys( $installed_plugins ),
                $active_plugins
            )
        );
        $theme             = wp_get_theme();
        $parent_theme      = $theme->parent();

        return rest_ensure_response(
            array(
                'identity'     => array(
                    'site_id'  => ATOZ_Growth_Site_Identity::get_site_id(),
                    'site_url' => untrailingslashit( home_url( '/' ) ),
                ),
                'mode'         => 'read-only',
                'inspected_at' => gmdate( 'c' ),
                'site'         => array(
                    'title'             => get_bloginfo( 'name' ),
                    'description'       => get_bloginfo( 'description' ),
                    'url'               => untrailingslashit( home_url( '/' ) ),
                    'wordpress_version' => $wp_version,
                    'php_version'       => PHP_VERSION,
                    'language'          => get_locale(),
                    'timezone'          => wp_timezone_string(),
                    'multisite'         => is_multisite(),
                    'https'             => is_ssl(),
                ),
                'theme'        => array(
                    'name'       => $theme->get( 'Name' ),
                    'version'    => $theme->get( 'Version' ),
                    'stylesheet' => $theme->get_stylesheet(),
                    'parent'     => $parent_theme ? $parent_theme->get( 'Name' ) : null,
                ),
                'plugins'      => array(
                    'total'          => count( $installed_plugins ),
                    'active'         => $active_count,
                    'inactive'       => max( 0, count( $installed_plugins ) - $active_count ),
                    'network_active' => count( $network_plugins ),
                ),
                'content'      => array(
                    'posts' => self::content_count( 'post' ),
                    'pages' => self::content_count( 'page' ),
                    'media' => self::content_count( 'attachment' ),
                ),
            )
        );
    }

    /**
     * Count content without returning titles, bodies, authors, or other records.
     *
     * @param string $post_type WordPress post type.
     * @return int
     */
    private static function content_count( $post_type ) {
        $counts   = wp_count_posts( $post_type );
        $statuses = 'attachment' === $post_type
            ? array( 'inherit', 'private' )
            : array( 'publish', 'private', 'draft', 'pending', 'future' );
        $total    = 0;

        foreach ( $statuses as $status ) {
            if ( isset( $counts->{$status} ) ) {
                $total += (int) $counts->{$status};
            }
        }

        return $total;
    }


    public static function validate_page( $value ) {
        return is_scalar( $value ) && preg_match( '/^[0-9]+$/', (string) $value ) && (int) $value >= 1 && (int) $value <= 1000000;
    }

    public static function validate_per_page( $value ) {
        return is_scalar( $value ) && preg_match( '/^[0-9]+$/', (string) $value ) && (int) $value >= 1 && (int) $value <= 50;
    }

    public static function authorize_inventory( $request ) {
        if ( ! ATOZ_Growth_Pairing::is_connected() ) {
            return new WP_Error( 'atoz_not_connected', 'This WordPress site is not connected.', array( 'status' => 403 ) );
        }
        $route = (string) $request->get_route();
        $scope = basename( $route );
        if ( ! in_array( $scope, array( 'posts', 'pages', 'media', 'plugins', 'themes' ), true ) ) {
            return new WP_Error( 'atoz_invalid_scope', 'The read scope is invalid.', array( 'status' => 403 ) );
        }
        $grant = trim( (string) $request->get_header( 'X-AtoZ-Inspection-Grant' ) );
        if ( ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $grant ) ) {
            return new WP_Error( 'atoz_invalid_inspection_grant', 'The inspection grant is invalid.', array( 'status' => 403 ) );
        }
        $body = array(
            'grant' => $grant,
            'site_id' => ATOZ_Growth_Site_Identity::get_site_id(),
            'site_url' => untrailingslashit( home_url( '/' ) ),
            'scope' => $scope,
        );
        if ( ! in_array( $scope, array( 'plugins', 'themes' ), true ) ) {
            $body['page'] = (int) $request->get_param( 'page' );
            $body['per_page'] = (int) $request->get_param( 'per_page' );
        }
        $endpoint = ATOZ_Growth_Endpoints::endpoint( 'inspection/authorize' );
        if ( is_wp_error( $endpoint ) ) { return $endpoint; }
        $response = wp_remote_post( $endpoint, array(
            'timeout' => 8, 'redirection' => 0,
            'headers' => array( 'Accept' => 'application/json', 'Content-Type' => 'application/json' ),
            'body' => wp_json_encode( $body ), 'data_format' => 'body',
        ) );
        if ( is_wp_error( $response ) ) {
            return new WP_Error( 'atoz_inspection_authorization_unavailable', 'Inspection authorization is temporarily unavailable.', array( 'status' => 503 ) );
        }
        $payload = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( 200 === (int) wp_remote_retrieve_response_code( $response ) && is_array( $payload ) && isset( $payload['success'] ) && true === $payload['success'] && isset( $payload['authorized'] ) && true === $payload['authorized'] ) return true;
        return new WP_Error( 'atoz_inspection_not_authorized', 'The inspection grant is invalid or expired.', array( 'status' => 403 ) );
    }

    private static function inventory_identity() {
        return array(
            'site_id' => ATOZ_Growth_Site_Identity::get_site_id(),
            'site_url' => untrailingslashit( home_url( '/' ) ),
        );
    }

    private static function iso_date( $mysql_date ) {
        return $mysql_date && '0000-00-00 00:00:00' !== $mysql_date ? mysql2date( 'c', $mysql_date, false ) : null;
    }

    private static function public_post_url( $post ) {
        if ( 'publish' !== $post->post_status || ! is_post_publicly_viewable( $post ) ) return null;
        $url = get_permalink( $post );
        return $url && 'https' === wp_parse_url( $url, PHP_URL_SCHEME ) ? esc_url_raw( $url ) : null;
    }

    private static function content_inventory( $post_type, $resource, $request ) {
        $page = (int) $request->get_param( 'page' );
        $per_page = (int) $request->get_param( 'per_page' );
        $query = new WP_Query( array(
            'post_type' => $post_type,
            'post_status' => array( 'publish', 'private', 'draft', 'pending', 'future' ),
            'posts_per_page' => $per_page, 'paged' => $page,
            'orderby' => array( 'modified' => 'DESC', 'ID' => 'DESC' ),
            'no_found_rows' => false, 'ignore_sticky_posts' => true,
        ) );
        if ( ( 0 === (int) $query->max_num_pages && $page > 1 ) || ( (int) $query->max_num_pages > 0 && $page > (int) $query->max_num_pages ) ) {
            return new WP_Error( 'atoz_page_out_of_range', 'The requested inventory page is out of range.', array( 'status' => 400 ) );
        }
        $items = array();
        foreach ( $query->posts as $post ) {
            $author = get_userdata( (int) $post->post_author );
            $items[] = array(
                'id' => (int) $post->ID,
                'title' => get_the_title( $post ),
                'status' => (string) $post->post_status,
                'author_display_name' => $author ? (string) $author->display_name : null,
                'published_at' => self::iso_date( $post->post_date_gmt ),
                'modified_at' => self::iso_date( $post->post_modified_gmt ),
                'slug' => (string) $post->post_name,
                'public_url' => self::public_post_url( $post ),
            );
        }
        return rest_ensure_response( array(
            'identity' => self::inventory_identity(), 'mode' => 'read-only', 'resource' => $resource,
            'pagination' => array(
                'page' => $page, 'per_page' => $per_page,
                'total_items' => (int) $query->found_posts,
                'total_pages' => (int) $query->max_num_pages,
            ),
            'items' => $items,
        ) );
    }

    public static function get_posts( $request ) { return self::content_inventory( 'post', 'posts', $request ); }
    public static function get_pages( $request ) { return self::content_inventory( 'page', 'pages', $request ); }

    public static function get_media( $request ) {
        $page = (int) $request->get_param( 'page' );
        $per_page = (int) $request->get_param( 'per_page' );
        $query = new WP_Query( array(
            'post_type' => 'attachment', 'post_status' => 'inherit',
            'posts_per_page' => $per_page, 'paged' => $page,
            'orderby' => array( 'date' => 'DESC', 'ID' => 'DESC' ), 'no_found_rows' => false,
        ) );
        if ( ( 0 === (int) $query->max_num_pages && $page > 1 ) || ( (int) $query->max_num_pages > 0 && $page > (int) $query->max_num_pages ) ) {
            return new WP_Error( 'atoz_page_out_of_range', 'The requested inventory page is out of range.', array( 'status' => 400 ) );
        }
        $items = array();
        foreach ( $query->posts as $attachment ) {
            $url = wp_get_attachment_url( $attachment->ID );
            if ( ! $url || 'https' !== wp_parse_url( $url, PHP_URL_SCHEME ) ) continue;
            $metadata = wp_get_attachment_metadata( $attachment->ID );
            $mime = (string) get_post_mime_type( $attachment->ID );
            $items[] = array(
                'id' => (int) $attachment->ID,
                'title' => get_the_title( $attachment ) ?: wp_basename( wp_parse_url( $url, PHP_URL_PATH ) ),
                'media_type' => $mime ? (string) strtok( $mime, '/' ) : '',
                'mime_type' => $mime,
                'width' => is_array( $metadata ) && isset( $metadata['width'] ) ? (int) $metadata['width'] : null,
                'height' => is_array( $metadata ) && isset( $metadata['height'] ) ? (int) $metadata['height'] : null,
                'uploaded_at' => self::iso_date( $attachment->post_date_gmt ),
                'public_url' => esc_url_raw( $url ),
            );
        }
        return rest_ensure_response( array(
            'identity' => self::inventory_identity(), 'mode' => 'read-only', 'resource' => 'media',
            'pagination' => array( 'page' => $page, 'per_page' => $per_page, 'total_items' => (int) $query->found_posts, 'total_pages' => (int) $query->max_num_pages ),
            'items' => $items,
        ) );
    }

    /** Read cached theme metadata only. Never refresh updates or change themes. */
    public static function get_themes() {
        $installed = wp_get_themes();
        $active = get_stylesheet();
        $updates = get_site_transient( 'update_themes' );
        $last_checked = is_object( $updates ) && isset( $updates->last_checked ) ? (int) $updates->last_checked : 0;
        $known = is_object( $updates ) && isset( $updates->checked, $updates->response ) &&
            is_array( $updates->checked ) && is_array( $updates->response ) &&
            $last_checked >= time() - 86400 && $last_checked <= time() + 300;
        $items = array();
        foreach ( $installed as $stylesheet => $theme ) {
            $parent = $theme->parent();
            $has_checked_version = $known && isset( $updates->checked[ $stylesheet ] ) &&
                (string) $updates->checked[ $stylesheet ] === (string) $theme->get( 'Version' );
            $items[] = array(
                'name' => (string) $theme->get( 'Name' ),
                'version' => (string) $theme->get( 'Version' ),
                'active' => (string) $stylesheet === (string) $active,
                'parent' => $parent ? (string) $parent->get( 'Name' ) : null,
                // NULL means no matching cached observation, not "up to date".
                'update_available' => $has_checked_version ?
                    ( isset( $updates->response ) && is_array( $updates->response ) && isset( $updates->response[ $stylesheet ] ) ) : null,
            );
        }
        usort( $items, function( $a, $b ) { return strcasecmp( $a['name'], $b['name'] ); } );
        return rest_ensure_response( array(
            'identity' => self::inventory_identity(), 'mode' => 'read-only', 'resource' => 'themes', 'items' => $items,
        ) );
    }

    public static function get_plugins() {
        if ( ! function_exists( 'get_plugins' ) ) require_once ABSPATH . 'wp-admin/includes/plugin.php';
        $installed = get_plugins();
        $active = (array) get_option( 'active_plugins', array() );
        $network = is_multisite() ? array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) : array();
        $enabled = array_unique( array_merge( $active, $network ) );
        $items = array();
        foreach ( $installed as $file => $headers ) {
            $items[] = array(
                'name' => isset( $headers['Name'] ) ? (string) $headers['Name'] : '',
                'version' => isset( $headers['Version'] ) ? (string) $headers['Version'] : '',
                'active' => in_array( $file, $enabled, true ),
            );
        }
        usort( $items, function( $a, $b ) { return strcasecmp( $a['name'], $b['name'] ); } );
        return rest_ensure_response( array(
            'identity' => self::inventory_identity(), 'mode' => 'read-only', 'resource' => 'plugins', 'items' => $items,
        ) );
    }

}

ATOZ_Growth_REST_API::init();
