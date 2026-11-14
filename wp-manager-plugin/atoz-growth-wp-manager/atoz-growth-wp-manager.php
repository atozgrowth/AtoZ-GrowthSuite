<?php
/**
 * Plugin Name: A to Z Growth WP Manager
 * Plugin URI: https://atozgrowth.net/
 * Description: Secure WordPress connector for the A to Z Growth business automation platform.
 * Version: 0.5.0
 * Author: A to Z Growth
 * Author URI: https://atozgrowth.net/
 * Text Domain: atoz-growth-wp-manager
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'ATOZ_GROWTH_WP_MANAGER_VERSION', '0.5.0' );
define( 'ATOZ_GROWTH_WP_MANAGER_FILE', __FILE__ );
define( 'ATOZ_GROWTH_WP_MANAGER_PATH', plugin_dir_path( __FILE__ ) );
define( 'ATOZ_GROWTH_WP_MANAGER_URL', plugin_dir_url( __FILE__ ) );

require_once ATOZ_GROWTH_WP_MANAGER_PATH . 'includes/class-atoz-endpoints.php';
require_once ATOZ_GROWTH_WP_MANAGER_PATH . 'includes/class-atoz-rest-api.php';
require_once ATOZ_GROWTH_WP_MANAGER_PATH . 'includes/class-atoz-drafts.php';
require_once ATOZ_GROWTH_WP_MANAGER_PATH . 'includes/class-atoz-site-identity.php';
require_once ATOZ_GROWTH_WP_MANAGER_PATH . 'includes/class-atoz-pairing.php';

/**
 * Plugin activation.
 * Creates a permanent Site ID for this WordPress installation.
 */
function atoz_growth_wp_manager_activate() {
    ATOZ_Growth_Site_Identity::ensure_site_id();
}

register_activation_hook(
    ATOZ_GROWTH_WP_MANAGER_FILE,
    'atoz_growth_wp_manager_activate'
);


/**
 * Register the A to Z Growth admin menu.
 */
function atoz_growth_wp_manager_admin_menu() {
    add_menu_page(
        'A to Z Growth',
        'A to Z Growth',
        'manage_options',
        'atoz-growth-wp-manager',
        'atoz_growth_wp_manager_admin_page',
        'dashicons-admin-generic',
        58
    );
}
add_action( 'admin_menu', 'atoz_growth_wp_manager_admin_menu' );

/**
 * Initial plugin administration screen.
 */
function atoz_growth_wp_manager_admin_page() {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    $notice_type    = '';
    $notice_message = '';

    if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'POST' === $_SERVER['REQUEST_METHOD'] && isset( $_POST['atoz_reconnect_action'] ) ) {
        $nonce = isset( $_POST['atoz_reconnect_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['atoz_reconnect_nonce'] ) ) : '';
        $result = ATOZ_Growth_Pairing::reset_for_reconnect( $nonce );
        $notice_type = is_wp_error( $result ) ? 'error' : 'success';
        $notice_message = is_wp_error( $result ) ? $result->get_error_message() : 'Local pairing reset. Revoke the previous backend connection and generate a fresh pairing code; the Site ID is unchanged.';
    }

    if (
        isset( $_SERVER['REQUEST_METHOD'] ) &&
        'POST' === $_SERVER['REQUEST_METHOD'] &&
        isset( $_POST['atoz_pairing_action'] )
    ) {
        check_admin_referer(
            'atoz_confirm_pairing',
            'atoz_pairing_nonce'
        );

        $connection_id = isset( $_POST['atoz_connection_id'] )
            ? sanitize_text_field( wp_unslash( $_POST['atoz_connection_id'] ) )
            : '';
        $challenge = isset( $_POST['atoz_pairing_challenge'] )
            ? sanitize_text_field( wp_unslash( $_POST['atoz_pairing_challenge'] ) )
            : '';

        $result = ATOZ_Growth_Pairing::confirm(
            $connection_id,
            $challenge
        );

        if ( is_wp_error( $result ) ) {
            $notice_type    = 'error';
            $notice_message = $result->get_error_message();
        } else {
            $notice_type    = 'success';
            $notice_message = ATOZ_Growth_Endpoints::writes_enabled() ? 'Pairing confirmed. Isolated test draft operations require exact approval.' : 'Pairing confirmed. This site is connected in read-only mode.';
        }
    }

    $site_id           = ATOZ_Growth_Site_Identity::get_site_id();
    $site_url          = untrailingslashit( home_url( '/' ) );
    $connection_status = ATOZ_Growth_Pairing::get_connection_status();

    ?>
    <div class="wrap">
        <h1>A to Z Growth WP Manager</h1>

        <p>
            Secure WordPress connector for the A to Z Growth platform.
        </p>

        <?php if ( $notice_message ) : ?>
            <div class="notice notice-<?php echo esc_attr( $notice_type ); ?> is-dismissible">
                <p><?php echo esc_html( $notice_message ); ?></p>
            </div>
        <?php endif; ?>

        <table class="widefat striped" style="max-width:800px;">
            <tbody>
                <tr>
                    <td><strong>Plugin Version</strong></td>
                    <td><?php echo esc_html( ATOZ_GROWTH_WP_MANAGER_VERSION ); ?></td>
                </tr>
                <tr>
                    <td><strong>Site URL</strong></td>
                    <td><code><?php echo esc_html( $site_url ); ?></code></td>
                </tr>
                <tr>
                    <td><strong>Site ID</strong></td>
                    <td><code><?php echo esc_html( $site_id ); ?></code></td>
                </tr>
                <tr>
                    <td><strong>Connection Status</strong></td>
                    <td><?php echo esc_html( ucwords( str_replace( '_', ' ', $connection_status ) ) ); ?></td>
                </tr>
                <tr>
                    <td><strong>Operating Mode</strong></td>
                    <td><?php echo esc_html( ATOZ_Growth_Endpoints::writes_enabled() ? 'Isolated unpublished drafts (test only)' : 'Read-only' ); ?></td>
                </tr>
            </tbody>
        </table>

        <?php if ( in_array( $connection_status, array( 'connected', 'revoked' ), true ) ) : ?>
            <form method="post">
                <?php wp_nonce_field( 'atoz_growth_reconnect', 'atoz_reconnect_nonce' ); ?>
                <input type="hidden" name="atoz_reconnect_action" value="reset" />
                <p>Revoke the old connection in A to Z Growth Suite before reconnecting. Reset keeps this site's permanent identity.</p>
                <?php submit_button( 'Reset local pairing for reconnect', 'secondary', 'submit', false ); ?>
            </form>
        <?php endif; ?>

        <?php if ( 'connected' === $connection_status ) : ?>
            <div class="notice notice-success inline" style="max-width:770px;margin-top:20px;">
                <p><strong>Connected.</strong> <?php echo esc_html( ATOZ_Growth_Endpoints::writes_enabled() ? 'Unpublished draft operations are restricted to this isolated fixture and require approval.' : 'Management access remains read-only.' ); ?></p>
            </div>
        <?php elseif ( 'revoked' === $connection_status ) : ?>
            <div class="notice notice-warning inline" style="max-width:770px;margin-top:20px;">
                <p><strong>Connection revoked.</strong> This site cannot be silently reassigned. An administrator must explicitly reset local pairing and obtain a fresh backend challenge.</p>
            </div>
        <?php else : ?>
            <div class="card" style="max-width:800px;margin-top:20px;">
                <h2>Approve secure pairing</h2>
                <p>
                    In A to Z Growth WordPress Manager, enter the exact Site URL shown above and
                    generate a pairing code. Paste the resulting values below before the code expires.
                </p>
                <?php if ( 'pending' === $connection_status ) : ?>
                    <p><strong>Status:</strong> Pairing confirmation is pending.</p>
                <?php endif; ?>
                <form method="post" autocomplete="off">
                    <?php wp_nonce_field( 'atoz_confirm_pairing', 'atoz_pairing_nonce' ); ?>
                    <input type="hidden" name="atoz_pairing_action" value="confirm" />

                    <table class="form-table" role="presentation">
                        <tbody>
                            <tr>
                                <th scope="row">
                                    <label for="atoz-connection-id">Connection ID</label>
                                </th>
                                <td>
                                    <input
                                        id="atoz-connection-id"
                                        name="atoz_connection_id"
                                        type="text"
                                        class="regular-text code"
                                        maxlength="36"
                                        required
                                        spellcheck="false"
                                        autocomplete="off"
                                    />
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="atoz-pairing-challenge">One-time pairing code</label>
                                </th>
                                <td>
                                    <input
                                        id="atoz-pairing-challenge"
                                        name="atoz_pairing_challenge"
                                        type="password"
                                        class="regular-text code"
                                        minlength="32"
                                        maxlength="128"
                                        required
                                        spellcheck="false"
                                        autocomplete="new-password"
                                    />
                                    <p class="description">
                                        The code is submitted once over HTTPS and is never stored by this plugin.
                                    </p>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <?php
                    submit_button(
                        'Approve secure pairing',
                        'primary',
                        'submit',
                        false
                    );
                    ?>
                </form>
            </div>
        <?php endif; ?>
    </div>
    <?php
}
