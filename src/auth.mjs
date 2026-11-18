// Who the CLI works as. Two ways, the same two the Clipzi MCP server takes:
//
//   - CLIPZI_API_KEY (ck_live_...): for scripts, servers and agents with no
//     browser. Created at https://clipzi.app/dashboard/agents.
//   - `clipzi login`: OAuth 2.1 in the browser, like Claude Code connects an
//     MCP server. The CLI registers itself as a public client (dynamic client
//     registration), opens Clipzi's own sign-in and "Allow" screen with PKCE,
//     takes the code on a loopback address and keeps the tokens in
//     ~/.config/clipzi/credentials.json (readable by this user only). The
//     access token is refreshed when it runs out.
//
// Everything is discovered from the server (RFC 9728 then RFC 8414), nothing
// about the authorization server is written here.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { say } from './util.mjs';

export const SITE = (process.env.CLIPZI_URL || 'https://clipzi.app').replace(/\/+$/, '');
export const MCP_URL = `${SITE}/mcp`;
const DIR = process.env.CLIPZI_CONFIG_DIR || join(homedir(), '.config', 'clipzi');
const FILE = join(DIR, 'credentials.json');

export class AuthError extends Error {}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** PKCE: a random verifier and its S256 challenge. */
export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function readCredentials() {
  try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return null; }
}

async function saveCredentials(creds) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await chmod(FILE, 0o600).catch(() => {});
}

export async function logout() {
  const had = !!(await readCredentials());
  await rm(FILE, { force: true });
  return had;
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new AuthError(`${init?.method ?? 'GET'} ${url} answered ${res.status}: ${body.error_description ?? body.error ?? body.msg ?? body.raw ?? ''}`.trim());
  return body;
}

/** Where to sign in, as the server says (protected resource metadata, then the authorization server's). */
async function discover() {
  const resource = await getJson(`${SITE}/.well-known/oauth-protected-resource/mcp`);
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new AuthError('The server names no authorization server.');
  const as = await getJson(`${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`);
  for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!as[k]) throw new AuthError(`The authorization server has no ${k}.`);
  }
  return { resource: resource.resource ?? MCP_URL, scopes: resource.scopes_supported ?? [], ...as };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* the URL is printed anyway */ }
}

/**
 * A loopback server on a free port that waits for one ?code=&state= and
 * answers the browser. Resolves with its port; `code` settles with the code.
 */
function startLoopback(expectedState, timeoutMs) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const code = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    code.catch(() => {});
    let timer;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const got = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const ok = !!got && url.searchParams.get('state') === expectedState && !error;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Clipzi</title><body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0"><p>${ok ? 'Clipzi is connected. You can close this tab and go back to the terminal.' : 'The sign-in did not finish. Go back to the terminal and run clipzi login again.'}</p>`);
      clearTimeout(timer);
      server.close();
      if (ok) settle.resolve(got);
      else settle.reject(new AuthError(error ? `Sign-in refused: ${url.searchParams.get('error_description') ?? error}` : 'The sign-in answer did not match this login.'));
    });
    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => { server.close(); settle.reject(new AuthError('Nobody finished the sign-in in time. Run clipzi login again.')); }, timeoutMs);
      resolveStart({ port: server.address().port, code, close: () => { clearTimeout(timer); server.close(); } });
    });
  });
}

/**
 * `clipzi login`: the browser opens Clipzi's sign-in and "Allow" screen; the
 * tokens are kept for the next commands. Returns the account's email when the
 * server tells it.
 */
export async function login({ browser = true, timeoutMs = 5 * 60_000 } = {}) {
  const as = await discover();
  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkcePair();

  const loop = await startLoopback(state, timeoutMs);
  const redirectUri = `http://127.0.0.1:${loop.port}/callback`;

  let client;
  try {
    client = await getJson(as.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Clipzi CLI',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    });
  } catch (e) { loop.close(); throw e; }

  const authorize = new URL(as.authorization_endpoint);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: as.resource,
    ...(as.scopes.length ? { scope: as.scopes.join(' ') } : {}),
  }).toString();

  say('Opening Clipzi in your browser to sign in and allow this terminal.');
  say(`If it does not open, visit:\n  ${authorize}`);
  if (browser) openBrowser(authorize.toString());

  const code = await loop.code;
  const tokens = await getJson(as.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier }),
  });
  await saveCredentials({
    kind: 'oauth',
    site: SITE,
    client_id: client.client_id,
    token_endpoint: as.token_endpoint,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  });
  return { connected: true };
}

async function refresh(creds) {
  if (!creds.refresh_token) throw new AuthError('The sign-in ran out. Run clipzi login again.');
  let tokens;
  try {
    tokens = await getJson(creds.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refresh_token, client_id: creds.client_id }),
    });
  } catch {
    throw new AuthError('The sign-in ran out or was revoked. Run clipzi login again.');
  }
  const next = {
    ...creds,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? creds.refresh_token,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
  await saveCredentials(next);
  return next;
}

/** The bearer for the next request: the API key when set, else the saved sign-in (refreshed when needed). */
export async function bearer({ forceRefresh = false } = {}) {
  const key = process.env.CLIPZI_API_KEY?.trim();
  if (key) return { token: key, via: 'api_key' };
  let creds = await readCredentials();
  if (!creds || creds.kind !== 'oauth') {
    throw new AuthError('Not signed in. Run `clipzi login` (opens the browser), or set CLIPZI_API_KEY to a key from https://clipzi.app/dashboard/agents.');
  }
  if (creds.site && creds.site !== SITE) throw new AuthError(`The saved sign-in is for ${creds.site}. Run clipzi login again.`);
  if (forceRefresh || Date.now() > creds.expires_at - 60_000) creds = await refresh(creds);
  return { token: creds.access_token, via: 'oauth' };
}
