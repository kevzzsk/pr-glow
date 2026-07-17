import * as http from 'node:http';
import * as https from 'node:https';
import { FetchLike } from './types';

const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ECONNRESET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

/**
 * fetch with an IPv4-forced fallback. On networks where a host's IPv6 route
 * blackholes (common on VPNs — e.g. api.bitbucket.org publishes AAAA records
 * that never connect), global fetch fails with ETIMEDOUT even though IPv4
 * works. When the primary fetch fails with a connection-level error, retry
 * the request over node http(s) pinned to IPv4.
 */
export const resilientFetch: FetchLike = async (url, init) => {
  const primary = globalThis.fetch as unknown as FetchLike | undefined;
  if (primary) {
    try {
      return await primary(url, init);
    } catch (err) {
      if (!isConnectionError(err)) {
        throw err;
      }
    }
  }
  return ipv4Fetch(url, init);
};

function isConnectionError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

/** Minimal fetch over node http(s) with family: 4, following redirects. */
export function ipv4Fetch(
  url: string,
  init?: Parameters<FetchLike>[1],
  redirectsLeft = MAX_REDIRECTS,
): ReturnType<FetchLike> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method: init?.method ?? 'GET',
        headers: init?.headers,
        family: 4,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 301 && status <= 308 && location && redirectsLeft > 0) {
          res.resume();
          resolve(ipv4Fetch(new URL(location, url).toString(), init, redirectsLeft - 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            json: async () => JSON.parse(body) as unknown,
            text: async () => body,
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('error', reject);
    req.end();
  });
}
