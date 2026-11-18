#!/usr/bin/env node
// Clipzi for Claude Desktop (and any app that runs local MCP servers): a small
// server on the person's own computer, over stdio. It is Clipzi's whole MCP
// server (https://clipzi.app/mcp, every tool passed through as the signed-in
// person) plus what only a program on their machine can do:
//
//   upload_local_video   a video FILE on this computer goes straight to Clipzi
//                        (a chat app's remote connector cannot read it);
//   save_clip            a finished clip is saved into a folder here;
//   sign_in / sign_out   the browser opens Clipzi's own sign-in and "Allow".
//
// No dependencies: the protocol is JSON-RPC, one message per line.
// Nothing but protocol messages may go to stdout; progress goes to stderr.

import { createInterface } from 'node:readline';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthError, bearer, login, logout, MCP_URL, SITE } from './auth.mjs';
import { rpc, ToolError } from './mcp.mjs';
import { download, uploadFile } from './commands.mjs';
import { fileNameFor, UsageError } from './util.mjs';

process.env.CLIPZI_QUIET ??= '';
const VERSION = '0.1.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** The remote tools this server replaces with its own (a local file needs no address to PUT to, and no upload page). */
const REPLACED = new Set(['upload_video', 'finish_upload', 'get_upload_link']);
/** Files are only saved from Clipzi's own hosts. */
const CLIP_HOSTS = new Set(['clips.clipzi.cc', 'clipzi.app']);

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError });
const expand = (p) => resolve(String(p).replace(/^~(?=$|\/)/, homedir()));

const LOCAL_TOOLS = [
  {
    name: 'upload_local_video',
    title: 'Upload a video file from this computer',
    description: 'Brings a long video into Clipzi from a FILE on this computer (mp4, mov, mkv, webm): give its full path. The file goes straight to the person\'s Clipzi account and the analysis starts (transcription, then clip detection). Returns the video id: pass it to make_clips, which waits for the analysis itself, or follow it with get_video and wait_seconds. Counts as one video of the plan. Use this whenever the video is on the person\'s computer; with a link to the file use import_video.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Full path of the video file, e.g. /Users/ana/Movies/episode.mp4 (a leading ~ is the home folder).' } }, required: ['path'], additionalProperties: false },
    annotations: { title: 'Upload a video file from this computer', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'save_clip',
    title: 'Save a finished clip to this computer',
    description: 'Saves a finished clip (the url of a render_clip or make_clips result) as an mp4 in a folder of this computer: the Downloads folder unless another is given. The file is named after the title you pass; an existing file is never replaced. Only for clips that came with a url: an account without a plan gets watch_page instead, which is opened in the browser, not saved.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string', description: 'The clip\'s url, as a Clipzi tool returned it.' },
      title: { type: 'string', description: 'The clip\'s title, used as the file name.' },
      folder: { type: 'string', description: 'Folder to save into. Default: ~/Downloads.' },
    }, required: ['url'], additionalProperties: false },
    annotations: { title: 'Save a finished clip to this computer', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'sign_out',
    title: 'Sign this computer out of Clipzi',
    description: 'Forgets the Clipzi sign-in kept on this computer. Ask the person before calling it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Sign this computer out of Clipzi', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const SIGN_IN = {
  name: 'sign_in',
  title: 'Sign in to Clipzi',
  description: 'Opens Clipzi in the person\'s browser to sign in (or create their account, no card) and allow this computer. Returns at once: tell the person to finish in the browser and to say when it is done; then the Clipzi tools are available. Call this first whenever a Clipzi tool answers not_signed_in.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Sign in to Clipzi', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

const INSTRUCTIONS =
  'Clipzi turns long videos into finished short clips. This server runs on the person\'s computer, so a video FILE on it can be used directly: upload_local_video with its path, then make_clips with the video id, then get_job with wait_seconds until done. ' +
  'With a link to the file (direct, Google Drive, Dropbox) use import_video or make_clips with url. save_clip puts a finished clip in the Downloads folder. ' +
  'If a tool answers not_signed_in, call sign_in and wait for the person to finish in the browser. ' +
  'An account without a plan gets each clip as watch_page (its page in Clipzi) instead of a file: give the person that link; downloading needs a plan, and the person pays on the page get_upgrade_link returns, never you. ' +
  'Ask before deleting anything. Times are in seconds.';

const signedIn = async () => { try { await bearer(); return true; } catch { return false; } };
let signingIn = null;

async function listTools() {
  if (!(await signedIn())) return [SIGN_IN];
  try {
    const remote = (await rpc('tools/list', {}))?.tools ?? [];
    return [...LOCAL_TOOLS.slice(0, 2), ...remote.filter((t) => !REPLACED.has(t.name)), SIGN_IN, LOCAL_TOOLS[2]];
  } catch (e) {
    // The sign-in was revoked or ran out: back to the one tool that fixes it.
    if (e instanceof AuthError) return [SIGN_IN];
    throw e;
  }
}

async function callLocal(name, args) {
  if (name === 'sign_in') {
    if (await signedIn()) return text({ signed_in: true, next: 'Already signed in. Use the Clipzi tools.' });
    if (!signingIn) {
      signingIn = login().then(() => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }))
        .catch((e) => process.stderr.write(`sign-in did not finish: ${e?.message ?? e}\n`))
        .finally(() => { signingIn = null; });
    }
    return text({ signed_in: false, opened: 'A browser window opened on Clipzi\'s sign-in.', next: `Ask the person to sign in (or create their account, no card) and press Allow, then to tell you when it is done. If no window opened, they can connect at ${SITE}/en/mcp.` });
  }
  if (name === 'sign_out') {
    const had = await logout();
    send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    return text({ signed_out: had });
  }
  if (name === 'upload_local_video') {
    const path = expand(args?.path ?? '');
    if (!args?.path || !existsSync(path) || !statSync(path).isFile()) return text(`not_found: No file at "${path}". Ask the person for the full path of the video (they can drag the file into the chat to get it).`, true);
    const id = await uploadFile(path);
    return text({ video: { id, status: 'pending', dashboard: `${SITE}/dashboard/${id}` }, next: 'make_clips with this video_id (it waits for the analysis), or get_video with wait_seconds: 50 until status is completed.' });
  }
  if (name === 'save_clip') {
    let url;
    try { url = new URL(String(args?.url ?? '')); } catch { return text('invalid_input: url is not an address.', true); }
    if (url.protocol !== 'https:' || !CLIP_HOSTS.has(url.host)) return text('invalid_input: Only a clip url returned by a Clipzi tool can be saved. A watch_page is opened in the browser instead.', true);
    const folder = expand(args?.folder || join(homedir(), 'Downloads'));
    const file = await download(url.toString(), folder, fileNameFor(args?.title, 'mp4'), new Set(existsSync(folder) ? (await import('node:fs')).readdirSync(folder) : []));
    return text({ saved: file });
  }
  return null;
}

async function callTool(name, args) {
  try {
    const local = await callLocal(name, args);
    if (local) return local;
    if (REPLACED.has(name)) return text('not_available: On this computer use upload_local_video with the file\'s path.', true);
    // Everything else is Clipzi's own tool, passed through as it answers.
    return await rpc('tools/call', { name, arguments: args ?? {} });
  } catch (e) {
    if (e instanceof AuthError) return text('not_signed_in: Clipzi is not signed in on this computer. Call sign_in, then ask the person to finish in the browser.', true);
    if (e instanceof ToolError) return text(`${e.code}: ${e.message}`, true);
    if (e instanceof UsageError) return text(`invalid_input: ${e.message}`, true);
    return text(`failed: ${e?.message ?? e}`, true);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return; // a notification: nothing to answer
  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'clipzi', title: 'Clipzi', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: await listTools() });
    if (method === 'tools/call') return reply(await callTool(String(params?.name ?? ''), params?.arguments));
    return fail(-32601, `Method not found: ${method}`);
  } catch (e) {
    return fail(-32603, e?.message ?? String(e));
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  void handle(msg);
});
lines.on('close', () => process.exit(0));
process.stderr.write(`clipzi desktop server ${VERSION} ready (${MCP_URL})\n`);
