import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ipv4Fetch, resilientFetch } from '../src/core/resilientFetch';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world', auth: req.headers.authorization ?? null }));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/json' });
      res.end();
    } else if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ipv4Fetch', () => {
  it('performs a GET and parses JSON', async () => {
    const res = await ipv4Fetch(`${baseUrl}/json`, { headers: { Authorization: 'Bearer t' } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'world', auth: 'Bearer t' });
  });

  it('follows redirects', async () => {
    const res = await ipv4Fetch(`${baseUrl}/redirect`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hello: 'world' });
  });

  it('stops following redirects after the limit', async () => {
    const res = await ipv4Fetch(`${baseUrl}/loop`);
    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
  });

  it('reports non-2xx as not ok', async () => {
    const res = await ipv4Fetch(`${baseUrl}/missing`);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe('resilientFetch', () => {
  it('falls back to ipv4Fetch when global fetch fails with a connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } }),
    ));
    const res = await resilientFetch(`${baseUrl}/json`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toMatchObject({ hello: 'world' });
  });

  it('rethrows non-connection errors from global fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('invalid header value')));
    await expect(resilientFetch(`${baseUrl}/json`)).rejects.toThrow('invalid header value');
  });

  it('uses the global fetch result when it succeeds', async () => {
    const sentinel = { ok: true, status: 200, statusText: 'OK', json: async () => 'primary', text: async () => 'primary' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sentinel));
    const res = await resilientFetch('https://example.invalid/anything');
    expect(await res.json()).toBe('primary');
  });
});
