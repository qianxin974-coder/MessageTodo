/**
 * Notification Adapters Package (Web-first)
 * Cross-platform notification scheduling and handling.
 * Phase 2 ships the Web adapter only; iOS/Android adapters arrive with the mobile app phase.
 */

export * from './types';
export {
  createNotificationAdapter,
  initializeNotifications,
  getNotificationStatus
} from './web';
