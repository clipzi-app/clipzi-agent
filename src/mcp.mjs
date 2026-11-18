// The CLI is a thin client of Clipzi's MCP server (https://clipzi.app/mcp):
// every command is one or more of the same tools Claude or ChatGPT call, with
// the same rules (plan, limits, a trial's clips as pages to watch). Stateless
// Streamable HTTP with plain JSON answers: one POST per call, no session.

import { AuthError, bearer, MCP_URL } from './auth.mjs';

/** A tool that could not do what was asked: its code (quota, not_found, paid_plan_required...) and what to do. */
export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let nextId = 1;

/** "code: message" (the server's error text) as its two parts. */
export function splitToolError(text) {
  const m = /^([a-z_]+):\s*([\s\S]*)$/.exec(String(text ?? ''));
  return m ? { code: m[1], message: m[2] } : { code: 'tool_error', message: String(text ?? 'The tool failed') };
}

/** A tools/call answer as the tool's value, or a ToolError. */
export function readToolResult(result) {
  const text = result?.content?.find?.((c) => c?.type === 'text')?.text;
  if (result?.isError) {
    const { code, message } = splitToolError(text);
    throw new ToolError(code, message);
  }
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  try { return JSON.parse(text); } catch { return text ?? null; }
}

async function post(body, token) {
  return fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'clipzi-cli',
    },
    body: JSON.stringify(body),
  });
}

/** One JSON-RPC request to the server, signed in. A 401 on a saved sign-in refreshes it once. */
export async function rpc(method, params) {
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
  let auth = await bearer();
  let res = await post(body, auth.token);
  if (res.status === 401 && auth.via === 'oauth') {
    auth = await bearer({ forceRefresh: true });
    res = await post(body, auth.token);
  }
  if (res.status === 401) {
    throw new AuthError(auth.via === 'api_key'
      ? 'CLIPZI_API_KEY was refused (wrong or revoked). Make a new one at https://clipzi.app/dashboard/agents.'
      : 'The sign-in was refused. Run clipzi login again.');
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 10;
    throw new ToolError('rate_limited', `Too many requests. Try again in ${wait} s.`);
  }
  const text = await res.text();
  let msg;
  try { msg = JSON.parse(text); } catch { throw new Error(`Clipzi answered ${res.status} with something that is not JSON.`); }
  if (msg.error) throw new ToolError('protocol_error', msg.error.message ?? JSON.stringify(msg.error));
  return msg.result;
}

/** Call one Clipzi tool: its value, or a ToolError with the server's code and advice. */
export async function callTool(name, args = {}) {
  return readToolResult(await rpc('tools/call', { name, arguments: args }));
}

/** The tools the server offers this account, with their descriptions and inputs. */
export async function listTools() {
  return (await rpc('tools/list', {}))?.tools ?? [];
}
