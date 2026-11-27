<?php
/**
 * Plugin Name: AtoZ Abilities Fixture
 * Description: Synthetic WP Abilities API records for isolated AtoZ integration coverage.
 */
add_action( 'wp_abilities_api_categories_init', function () {
	wp_register_ability_category( 'atoz-fixture', array( 'label' => 'AtoZ fixture', 'description' => 'Synthetic isolated category.' ) );
} );
add_action( 'wp_abilities_api_init', function () {
	$common = array(
		'category' => 'atoz-fixture',
		'input_schema' => array( 'type' => 'object', 'properties' => array() ),
		'output_schema' => array( 'type' => 'object', 'properties' => array() ),
		'execute_callback' => function () { return array(); },
		'permission_callback' => function () { return current_user_can( 'read' ); },
	);
	wp_register_ability( 'atoz-fixture/read-only', array_merge( $common, array(
		'label' => 'Synthetic read-only capability',
		'description' => 'Available for isolated discovery only.',
		'meta' => array( 'show_in_rest' => true ),
	) ) );
	wp_register_ability( 'atoz-fixture/public', array_merge( $common, array(
		'label' => 'Synthetic public capability',
		'description' => 'Visible through public ability metadata.',
		'meta' => array( 'public' => true ),
	) ) );
	wp_register_ability( 'atoz-fixture/private', array_merge( $common, array(
		'label' => 'Synthetic private capability',
		'description' => 'Must not appear in customer inspection.',
		'meta' => array( 'public' => false ),
	) ) );
} );
