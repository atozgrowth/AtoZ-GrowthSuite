<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class ATOZ_Growth_Site_Identity {

    const OPTION_SITE_ID = 'atoz_growth_site_id';

    /**
     * Create a permanent unique ID for this WordPress installation.
     * Existing IDs are never overwritten.
     */
    public static function ensure_site_id() {

        $site_id = get_option( self::OPTION_SITE_ID );

        if ( ! empty( $site_id ) ) {
            return $site_id;
        }

        $site_id = wp_generate_uuid4();

        add_option(
            self::OPTION_SITE_ID,
            $site_id,
            '',
            false
        );

        return get_option( self::OPTION_SITE_ID );
    }

    /**
     * Return this WordPress installation's Site ID.
     */
    public static function get_site_id() {

        $site_id = get_option( self::OPTION_SITE_ID );

        if ( empty( $site_id ) ) {
            $site_id = self::ensure_site_id();
        }

        return $site_id;
    }
}
