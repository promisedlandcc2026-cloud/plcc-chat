import { handleIntercessorsBridge } from './_utils/intercessorsBridge.js';

/**
 * GET /api/intercessors?action=access → can this member open the Prayer Watch?
 * (PLCC Chat only uses the access check to show a link to the Prayer Watch in Connect.)
 */
export default async function handler(req, res) {
  return handleIntercessorsBridge(req, res);
}
