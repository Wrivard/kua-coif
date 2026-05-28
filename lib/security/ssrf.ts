/**
 * Security audit #4 + #5 (MINOR) — SSRF guards for owner-controllable
 * fetch targets.
 *
 * Two concrete vectors:
 *
 *   1. `shops.slack_webhook_url` — owner pastes any URL. Without a
 *      guard, a malicious owner could point us at `https://169.254.169.254/`
 *      (AWS/Vercel instance metadata), `https://localhost:6379/`
 *      (internal Redis), or other internal Supabase / Vercel hosts.
 *      The outbound fetch runs from our serverless function with no
 *      egress filter.
 *
 *   2. `smtp_settings.host` — owner sets any hostname. nodemailer opens
 *      a TCP connection to it. Less impact than HTTP (no body returned)
 *      but still allows port-scanning internal infra via response
 *      timing.
 *
 * This module provides two helpers:
 *   - `isAllowedSlackWebhookHost(url)` — whitelist of known
 *     Slack-compatible webhook hosts (Slack, Discord, Mattermost).
 *   - `isPrivateOrLoopbackIp(hostname)` — generic RFC1918 / loopback /
 *     link-local / IPv6 ULA / IPv6 loopback check.
 *
 * Both are sync — no DNS resolution. For HTTP webhook URLs the host
 * whitelist is enough; for SMTP we additionally resolve the hostname
 * because owners can use internal DNS that maps to private IPs.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Allowed webhook hosts for Slack-compatible endpoints. The list reflects
 * services that expose Slack-shaped incoming webhooks:
 *   - hooks.slack.com (official Slack)
 *   - discord.com (`/api/webhooks/...` accepts Slack JSON via `?wait=true`)
 *   - *.mattermost.com (incoming webhooks)
 *   - Mattermost self-hosted: NOT covered — those use arbitrary corporate
 *     hostnames. If a customer needs that, add per-shop whitelist override.
 */
const ALLOWED_WEBHOOK_HOSTS = ['hooks.slack.com', 'discord.com', 'discordapp.com'];
const ALLOWED_WEBHOOK_HOST_SUFFIXES = ['.mattermost.com'];

export function isAllowedSlackWebhookHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_WEBHOOK_HOSTS.includes(host)) return true;
  if (ALLOWED_WEBHOOK_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return false;
}

/**
 * Check whether a hostname OR literal IP is in private / loopback /
 * link-local space. Returns true to BLOCK; false means the address is
 * (probably) routable to the public internet.
 *
 * IPv4 ranges blocked (RFC1918 + RFC5735 + RFC3927):
 *   - 10.0.0.0/8        — private
 *   - 172.16.0.0/12     — private
 *   - 192.168.0.0/16    — private
 *   - 127.0.0.0/8       — loopback
 *   - 169.254.0.0/16    — link-local (AWS instance metadata)
 *   - 0.0.0.0/8         — current network
 *   - 100.64.0.0/10     — carrier-grade NAT
 *
 * IPv6 ranges blocked:
 *   - ::1               — loopback
 *   - fc00::/7          — unique local addresses
 *   - fe80::/10         — link-local
 *   - ::ffff:0:0/96     — IPv4-mapped (must also pass the v4 check)
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed → block
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  // IPv4-mapped (`::ffff:a.b.c.d`) — extract the v4 and recurse.
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIpv4(v4);
  }
  return false;
}

/**
 * Returns true when the given hostname resolves to (or IS) a private,
 * loopback, or link-local address. Async because hostname → IP
 * requires DNS. Returns true on resolution failure (fail closed).
 */
export async function isPrivateOrLoopbackHost(hostname: string): Promise<boolean> {
  // Literal IP — no DNS needed.
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion === 6) return isPrivateIpv6(hostname);

  // Hostname — resolve both A and AAAA. ANY private resolution → block.
  try {
    const [v4s, v6s] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    if (v4s.length === 0 && v6s.length === 0) return true; // unresolvable → block
    if (v4s.some((ip) => isPrivateIpv4(ip))) return true;
    if (v6s.some((ip) => isPrivateIpv6(ip))) return true;
    return false;
  } catch {
    return true;
  }
}
