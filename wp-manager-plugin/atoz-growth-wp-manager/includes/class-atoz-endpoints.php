<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
/** Explicit isolated endpoint selection. Invalid test configuration never falls back to production. */
class ATOZ_Growth_Endpoints {
    public static function nonproduction_mode() {
        $environment = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : '';
        return defined( 'ATOZ_GROWTH_NONPRODUCTION_MODE' ) && true === ATOZ_GROWTH_NONPRODUCTION_MODE && 'staging' === $environment;
    }
    public static function isolated_mode() {
        return ( defined( 'ATOZ_GROWTH_ISOLATED_TEST_MODE' ) && true === ATOZ_GROWTH_ISOLATED_TEST_MODE ) || self::nonproduction_mode();
    }
    public static function endpoint( $path ) {
        if ( ! self::isolated_mode() ) { return 'https://api.atozgrowth.net/api/wp-manager/' . $path; }
        $environment = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : '';
        if ( self::nonproduction_mode() ) {
            if ( ! defined( 'ATOZ_GROWTH_STAGING_BACKEND_URL' ) ) { return new WP_Error( 'atoz_staging_configuration', 'A staging backend URL is required.', array( 'status' => 503 ) ); }
            $base = rtrim( (string) ATOZ_GROWTH_STAGING_BACKEND_URL, '/' ); $url = wp_parse_url( $base );
            if ( ! is_array( $url ) || ! isset( $url['scheme'], $url['host'] ) || 'https' !== $url['scheme'] ||
                'api.atozgrowth.net' === strtolower( $url['host'] ) || ! preg_match( '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.staging\.atozgrowth\.net$/', strtolower( $url['host'] ) ) ||
                isset( $url['user'] ) || isset( $url['pass'] ) || isset( $url['query'] ) || isset( $url['fragment'] ) ||
                ( isset( $url['path'] ) && '' !== $url['path'] ) || ( isset( $url['port'] ) && 443 !== (int) $url['port'] ) ) {
                return new WP_Error( 'atoz_staging_configuration', 'Only the configured HTTPS staging backend is allowed.', array( 'status' => 503 ) );
            }
            return $base . '/api/wp-manager/' . $path;
        }
        if ( ! in_array( $environment, array( 'local', 'development' ), true ) || ! defined( 'ATOZ_GROWTH_TEST_BACKEND_URL' ) ) {
            return new WP_Error( 'atoz_test_configuration', 'Isolated backend configuration is required.', array( 'status' => 503 ) );
        }
        $base = rtrim( (string) ATOZ_GROWTH_TEST_BACKEND_URL, '/' ); $url = wp_parse_url( $base );
        if ( ! is_array( $url ) || ! isset( $url['scheme'], $url['host'] ) || 'http' !== $url['scheme'] ||
            ! in_array( strtolower( $url['host'] ), array( 'backend', 'atoz_backend', '127.0.0.1', 'localhost' ), true ) ||
            isset( $url['user'] ) || isset( $url['pass'] ) || isset( $url['query'] ) || isset( $url['fragment'] ) ||
            ( isset( $url['path'] ) && '' !== $url['path'] ) ||
            ( isset( $url['port'] ) && ! in_array( (int) $url['port'], array( 80, 3000, 4174 ), true ) ) ) {
            return new WP_Error( 'atoz_test_configuration', 'Only the explicitly isolated backend is allowed.', array( 'status' => 503 ) );
        }
        return $base . '/api/wp-manager/' . $path;
    }
    public static function writes_enabled() {
        $flag = self::nonproduction_mode() ? ( defined( 'ATOZ_GROWTH_NONPRODUCTION_WRITES_ENABLED' ) && true === ATOZ_GROWTH_NONPRODUCTION_WRITES_ENABLED ) : ( defined( 'ATOZ_GROWTH_TEST_WRITES_ENABLED' ) && true === ATOZ_GROWTH_TEST_WRITES_ENABLED );
        return self::isolated_mode() && $flag && ! is_wp_error( self::endpoint( 'drafts/authorize' ) );
    }
    /** Publishing needs an independent flag and local or staging WordPress environment. */
    public static function publishing_enabled() {
        $flag = self::nonproduction_mode() ? ( defined( 'ATOZ_GROWTH_NONPRODUCTION_PUBLISH_ENABLED' ) && true === ATOZ_GROWTH_NONPRODUCTION_PUBLISH_ENABLED ) : ( defined( 'ATOZ_GROWTH_TEST_PUBLISH_ENABLED' ) && true === ATOZ_GROWTH_TEST_PUBLISH_ENABLED );
        return self::writes_enabled() && $flag;
    }
    /** Isolated/staging allowlist blocks background requests outside the selected backend. */
    public static function block_external_test_http( $preempt, $args, $url ) {
        if ( ! self::isolated_mode() ) { return $preempt; }
        $allowed = self::endpoint( '' );
        if ( is_wp_error( $allowed ) || 0 !== strpos( (string) $url, $allowed ) ) {
            return new WP_Error( 'atoz_isolated_egress_blocked', 'External HTTP is disabled in this isolated fixture.' );
        }
        return $preempt;
    }
}
add_filter( 'pre_http_request', array( 'ATOZ_Growth_Endpoints', 'block_external_test_http' ), 1, 3 );
