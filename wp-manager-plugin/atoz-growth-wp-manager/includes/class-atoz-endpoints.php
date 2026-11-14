<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
/** Explicit isolated endpoint selection. Invalid test configuration never falls back to production. */
class ATOZ_Growth_Endpoints {
    public static function isolated_mode() {
        return defined( 'ATOZ_GROWTH_ISOLATED_TEST_MODE' ) && true === ATOZ_GROWTH_ISOLATED_TEST_MODE;
    }
    public static function endpoint( $path ) {
        if ( ! self::isolated_mode() ) { return 'https://api.atozgrowth.net/api/wp-manager/' . $path; }
        $environment = function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : '';
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
        return self::isolated_mode() && defined( 'ATOZ_GROWTH_TEST_WRITES_ENABLED' ) && true === ATOZ_GROWTH_TEST_WRITES_ENABLED && ! is_wp_error( self::endpoint( 'drafts/authorize' ) );
    }
    /** Test-mode allowlist blocks WordPress background requests as well as connector requests. */
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
