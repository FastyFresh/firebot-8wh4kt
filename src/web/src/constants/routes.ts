/**
 * @fileoverview Application route constants
 * @version 1.0.0
 * 
 * Defines constant route paths for the trading application's navigation system.
 * This file serves as the single source of truth for all application routes,
 * providing type-safe route definitions that map directly to the application's
 * navigation structure.
 */

/**
 * Route path constants for the application
 * @constant
 * @type {Object}
 */
export const ROUTES = {
  /**
   * Authentication route
   * @type {string}
   */
  LOGIN: '/login',

  /**
   * Main dashboard route
   * @type {string}
   */
  DASHBOARD: '/dashboard',

  /**
   * Portfolio management route
   * @type {string}
   */
  PORTFOLIO: '/portfolio',

  /**
   * Trading interface route
   * @type {string}
   */
  TRADING: '/trading',

  /**
   * Strategy configuration route
   * @type {string}
   */
  STRATEGY: '/strategy',

  /**
   * Application settings route
   * @type {string}
   */
  SETTINGS: '/settings',
} as const;

/**
 * Type definition for route paths
 * Ensures type safety when using route constants throughout the application
 */
export type RoutePath = typeof ROUTES[keyof typeof ROUTES];

/**
 * Type definition for route keys
 * Provides type-safe access to route names
 */
export type RouteKey = keyof typeof ROUTES;

// Freeze the routes object to prevent modifications
Object.freeze(ROUTES);