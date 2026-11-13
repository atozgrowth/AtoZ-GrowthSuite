<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class ATOZ_Growth_Pairing {

    const OPTION_CONNECTION_STATUS = 'atoz_growth_connection_status';
    const OPTION_PAIRED_AT         = 'atoz_growth_paired_at';
    const OPTION_CONNECTION_ID     = 'atoz_growth_connection_id';
    const CONFIRM_ENDPOINT         = 'https://api.atozgrowth.net/api/wp-manager/pairing/confirm';

    /**
     * Return the current connection state.
     */
    public static function get_connection_status() {

        $status = get_option(
            self::OPTION_CONNECTION_STATUS,
            'not_connected'
        );

        $allowed = array(
            'not_connected',
            'pending',
            'connected',
            'revoked',
        );

        if ( ! in_array( $status, $allowed, true ) ) {
            return 'not_connected';
        }

        return $status;
    }

    /**
     * Check whether this site is connected.
     */
    public static function is_connected() {
        return 'connected' === self::get_connection_status();
    }

    /**
     * Mark this site as waiting for pairing approval.
     */
    public static function mark_pending() {
        return update_option(
            self::OPTION_CONNECTION_STATUS,
            'pending',
            false
        );
    }

    /**
     * Return to the unpaired state without retaining pairing input.
     */
    public static function mark_not_connected() {
        update_option(
            self::OPTION_CONNECTION_STATUS,
            'not_connected',
            false
        );

        delete_option( self::OPTION_PAIRED_AT );
        delete_option( self::OPTION_CONNECTION_ID );

        return true;
    }

    /**
     * Mark this site as connected.
     */
    public static function mark_connected( $connection_id ) {
        update_option(
            self::OPTION_CONNECTION_STATUS,
            'connected',
            false
        );

        update_option(
            self::OPTION_CONNECTION_ID,
            $connection_id,
            false
        );

        update_option(
            self::OPTION_PAIRED_AT,
            current_time( 'mysql', true ),
            false
        );

        return true;
    }

    /**
     * Revoke the current connection state.
     */
    public static function mark_revoked() {
        return update_option(
            self::OPTION_CONNECTION_STATUS,
            'revoked',
            false
        );
    }

    /**
     * Confirm a short-lived pairing request with the A to Z Growth backend.
     *
     * The submitted challenge is sent once and is never persisted locally.
     *
     * @param string $connection_id Pending backend connection UUID.
     * @param string $challenge     One-time pairing challenge.
     * @return true|WP_Error
     */
    public static function confirm( $connection_id, $challenge ) {

        $current_status = self::get_connection_status();

        if ( 'connected' === $current_status ) {
            return new WP_Error(
                'atoz_already_connected',
                'This WordPress site is already connected.'
            );
        }

        if ( 'revoked' === $current_status ) {
            return new WP_Error(
                'atoz_revoked',
                'This connection was revoked and cannot be silently reassigned.'
            );
        }

        $connection_id = strtolower( trim( (string) $connection_id ) );
        $challenge     = trim( (string) $challenge );

        if ( ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $connection_id ) ) {
            return new WP_Error(
                'atoz_invalid_connection',
                'Enter a valid connection ID from A to Z Growth.'
            );
        }

        if ( strlen( $challenge ) < 32 || strlen( $challenge ) > 128 || ! preg_match( '/^[A-Za-z0-9_-]+$/', $challenge ) ) {
            return new WP_Error(
                'atoz_invalid_challenge',
                'Enter a valid one-time pairing code from A to Z Growth.'
            );
        }

        $site_id  = ATOZ_Growth_Site_Identity::get_site_id();
        $site_url = untrailingslashit( home_url( '/' ) );

        self::mark_pending();

        $response = wp_remote_post(
            self::CONFIRM_ENDPOINT,
            array(
                'timeout'     => 15,
                'redirection' => 0,
                'headers'     => array(
                    'Accept'       => 'application/json',
                    'Content-Type' => 'application/json',
                ),
                'body'        => wp_json_encode(
                    array(
                        'connection_id' => $connection_id,
                        'site_id'       => $site_id,
                        'site_url'      => $site_url,
                        'challenge'     => $challenge,
                    )
                ),
                'data_format' => 'body',
            )
        );

        if ( is_wp_error( $response ) ) {
            self::mark_not_connected();
            return new WP_Error(
                'atoz_service_unavailable',
                'The pairing service could not be reached. Try again with a fresh code.'
            );
        }

        $status_code = (int) wp_remote_retrieve_response_code( $response );
        $payload     = json_decode( wp_remote_retrieve_body( $response ), true );

        if (
            200 === $status_code &&
            is_array( $payload ) &&
            ! empty( $payload['success'] ) &&
            isset( $payload['connection'] ) &&
            is_array( $payload['connection'] ) &&
            isset( $payload['connection']['id'], $payload['connection']['site_url'], $payload['connection']['status'] ) &&
            hash_equals( $connection_id, strtolower( (string) $payload['connection']['id'] ) ) &&
            hash_equals( $site_url, untrailingslashit( (string) $payload['connection']['site_url'] ) ) &&
            'connected' === $payload['connection']['status']
        ) {
            self::mark_connected( $connection_id );
            return true;
        }

        self::mark_not_connected();

        if ( 400 === $status_code ) {
            return new WP_Error(
                'atoz_invalid_or_expired',
                'The pairing code is invalid, expired, mismatched, or already used. Generate a fresh code in A to Z Growth.'
            );
        }

        if ( 409 === $status_code ) {
            return new WP_Error(
                'atoz_pairing_conflict',
                'This site is already connected, revoked, or assigned to another account. No changes were made.'
            );
        }

        if ( 200 === $status_code ) {
            return new WP_Error(
                'atoz_identity_mismatch',
                'The pairing response did not match this WordPress site. No connection was saved.'
            );
        }

        return new WP_Error(
            'atoz_confirmation_failed',
            'The pairing could not be confirmed. Generate a fresh code and try again.'
        );
    }

    /**
     * Return safe connection information.
     *
     * No passwords, API keys, access tokens,
     * refresh tokens or webhook secrets are returned.
     */
    public static function get_safe_connection_info() {

        return array(
            'site_id'    => ATOZ_Growth_Site_Identity::get_site_id(),
            'status'     => self::get_connection_status(),
            'paired_at'  => get_option(
                self::OPTION_PAIRED_AT,
                null
            ),
        );
    }
}
