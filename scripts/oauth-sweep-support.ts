import { isOAuthSensitiveKey } from '../src/utils/transportDetection';
import { sanitizeOAuthTraceUrl } from '../src/utils/oauthTrace';

export function sweepUrl(value: string | URL): string {
  return sanitizeOAuthTraceUrl(value).replace(/\/(interaction|sessions?)\/[^/?#]{20,}/gi, '/$1/[REDACTED]');
}

export function visibleText(body: string): string {
  return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Do not export hidden form values, embedded scripts or arbitrary JSON fields. */
export function redactExcerpt(value: string): string {
  let text: string;
  try {
    text = JSON.stringify(JSON.parse(value), (key, entry) => {
      if (isOAuthSensitiveKey(key) || /client.?id|registration.?access.?token|cookie|session|assertion|password/i.test(key)) return '[REDACTED]';
      if (typeof entry === 'string') return redactText(entry);
      return entry;
    });
  } catch { text = redactText(visibleText(value)); }
  return text.slice(0, 350);
}

function redactText(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"']+/g, url => sweepUrl(url))
    .replace(/\b((?:[a-z]+[_-])*(?:token|secret|code|state|session|password)|client_id|code_verifier|code_challenge)(["']?\s*[:=]\s*["']?)[^\s<>"'&,]+/gi, '$1$2[REDACTED]')
    .replace(/\bBearer\s+[\w.~-]+/gi, 'Bearer [REDACTED]');
}

export function authorizationPageProblem(status: number, contentType: string, body: string): { classification: string; reason: string } | undefined {
  const text = visibleText(body);
  if (status === 429 || status >= 500) return { classification: 'transient', reason: 'Authorization service unavailable or rate limited' };
  if (/cf-chl-|awswaf|challenge-platform/i.test(body)
    || /just a moment|press and hold|sorry, you have been blocked|verify that you.re not a robot|verify (?:that you are|you.re) human/i.test(text)
    || (status === 403 && /_pxAppId/i.test(body))) {
    return { classification: 'transient', reason: 'Anti-bot challenge; interactive browser compatibility is unverified' };
  }
  if (!text && (status === 200 || status === 202)) return { classification: 'transient', reason: 'Empty or script-only page; login page unverified' };
  if (/sign.in link has expired|session (?:has )?expired|enable cookies|cookies (?:are )?required/i.test(text)) return { classification: 'transient', reason: 'Anonymous browser session or cookies required; login page unverified' };
  if (status < 200 || status >= 300 || !contentType.includes('text/html') || /invalid_client|invalid_redirect_uri|invalid_scope|invalid_target|unauthorized_client|"error"\s*:|authorization failed|access denied|something went wrong/i.test(text)) {
    return { classification: 'server non-compliance', reason: 'Authorization endpoint returned an error instead of a login page' };
  }
  if (!/log\s*in|sign\s*in|authorize|authorization|consent|password|connect|permission|approve|continue|account/i.test(text)) {
    return { classification: 'transient', reason: 'HTML received but no identifiable login or consent page' };
  }
}

export function publicClientCache(storage: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(storage)) {
    if (!key.startsWith('mcp_oauth_v2:')) continue;
    const state = JSON.parse(value);
    const clients: Record<string, unknown> = {};
    for (const [issuer, client] of Object.entries(state.clients ?? {}) as [string, Record<string, unknown>][]) {
      if (client.client_secret || typeof client.client_id !== 'string' || client.issuer !== issuer) continue;
      clients[issuer] = { client_id: client.client_id, issuer,
        ...(client.token_endpoint_auth_method === 'none' ? { token_endpoint_auth_method: 'none' } : {}),
        ...(client.registeredManually === true ? { registeredManually: true } : {}),
      };
    }
    if (Object.keys(clients).length) result[key] = JSON.stringify({ clients });
  }
  return result;
}
