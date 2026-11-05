import { handlePushBridge } from './_utils/pushBridge.js';

/**
 * Phone alerts for PLCC Chat (chat messages only):
 *   GET  /api/push?action=status&endpoint=…
 *   POST /api/push?action=subscribe   { subscription, topics: ['chat'] }
 *   POST /api/push?action=unsubscribe { endpoint }
 *   POST /api/push?action=test
 * → PLCC Vault resource=push.
 */
export default async function handler(req, res) {
  return handlePushBridge(req, res);
}
