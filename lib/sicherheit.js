'use strict';

function sameOriginMutation(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return true;
  const host = req.headers?.host;
  const originHeader = req.headers?.origin;
  if (typeof host !== 'string' || typeof originHeader !== 'string') return false;
  const fetchSite = req.headers?.['sec-fetch-site'];
  if (fetchSite !== undefined && String(fetchSite).toLowerCase() !== 'same-origin') return false;
  let origin;
  try { origin = new URL(originHeader); } catch { return false; }
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || (req.socket?.encrypted ? 'https' : 'http');
  return ['http:', 'https:'].includes(origin.protocol) &&
    origin.host.toLowerCase() === host.toLowerCase() && origin.protocol === protocol + ':';
}

module.exports = { sameOriginMutation };
