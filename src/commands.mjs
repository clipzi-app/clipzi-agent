// What each `clipzi <command>` does, on top of the server's tools (src/mcp.mjs).
// Every command prints one JSON answer on stdout; progress goes to stderr.

import { createWriteStream, existsSync, openAsBlob, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { callTool, listTools, ToolError } from './mcp.mjs';
import { login, logout, SITE } from './auth.mjs';
import { fileNameFor, intFlag, say, sleep, sourceKind, uniqueName, UsageError } from './util.mjs';

const WAIT = 50; // seconds the server waits per get_job / get_video call (its maximum)

/** Calls get_video until the analysis finished (or failed). */
async function waitForVideo(videoId) {
  let last = '';
  for (;;) {
    const { video } = await callTool('get_video', { video_id: videoId, wait_seconds: WAIT });
    if (video.stage !== last) { say(`Video ${videoId}: ${video.stage}`); last = video.stage; }
    if (video.status === 'completed' || video.status === 'failed') return video;
  }
}

/** Calls get_job until it is done or failed; `onRead` sees every read (make_clips fills in as it goes). */
async function waitForJob(jobId, onRead) {
  for (;;) {
    const job = await callTool('get_job', { job_id: jobId, wait_seconds: WAIT });
    if (onRead) await onRead(job);
    if (job.status === 'done' || job.status === 'failed') return job;
  }
}

async function download(url, dir, name, taken) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, uniqueName(name, taken));
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Downloading ${url} answered ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return resolve(file);
}

/** A local file into Clipzi: upload_video, the PUT, finish_upload. Returns the new video's id. */
async function uploadFile(path) {
  const size = statSync(path).size;
  const filename = basename(path);
  if (!/\.(mp4|mov|m4v|mkv|webm)$/i.test(extname(filename))) {
    throw new UsageError(`${filename} does not look like a video (mp4, mov, mkv, webm).`);
  }
  const up = await callTool('upload_video', { filename, size_bytes: size });
  say(`Uploading ${filename} (${(size / 1e6).toFixed(1)} MB)...`);
  const res = await fetch(up.put_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: await openAsBlob(path) });
  if (!res.ok) throw new Error(`The upload answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const done = await callTool('finish_upload', { upload_id: up.upload_id });
  say(`Uploaded. Clipzi is analyzing it (transcript, then the moments): ${done.dashboard ?? ''}`);
  return done.video.id;
}

export const COMMANDS = {
  async login(a) {
    return login({ browser: a.flags.browser !== false });
  },

  async logout() {
    return { signed_out: await logout() };
  },

  async account() {
    return callTool('get_account');
  },

  async tools() {
    return (await listTools()).map((t) => ({ name: t.name, title: t.title ?? t.annotations?.title ?? null }));
  },

  /** Any tool, by name, with its arguments as JSON: everything the server can do. */
  async call(a) {
    const [name, json] = a._;
    if (!name) throw new UsageError('clipzi call <tool> \'{"arg": "value"}\'  (clipzi tools lists them)');
    let args = {};
    if (json) { try { args = JSON.parse(json); } catch { throw new UsageError('The arguments must be JSON, e.g. \'{"video_id": "clip-upload-..."}\''); } }
    return callTool(name, args);
  },

  async videos(a) {
    return callTool('list_videos', { limit: intFlag(a.flags, 'limit', 20) });
  },

  async video(a) {
    const [id] = a._;
    if (!id) throw new UsageError('clipzi video <video_id> [--wait]');
    return a.flags.wait ? { video: await waitForVideo(id) } : callTool('get_video', { video_id: id });
  },

  async upload(a) {
    const [path] = a._;
    if (!path || !existsSync(path)) throw new UsageError('clipzi upload <video file> [--wait]');
    const id = await uploadFile(path);
    return { video: a.flags.wait ? await waitForVideo(id) : { id, status: 'pending' } };
  },

  async import(a) {
    const [url] = a._;
    if (!url) throw new UsageError('clipzi import <link to the video file, or a Drive / Dropbox share link> [--wait]');
    const out = await callTool('import_video', { url });
    return a.flags.wait ? { ...out, video: await waitForVideo(out.video.id) } : out;
  },

  async clips(a) {
    const [id] = a._;
    if (!id) throw new UsageError('clipzi clips <video_id>');
    return callTool('list_clips', { video_id: id });
  },

  async transcript(a) {
    const [id] = a._;
    if (!id) throw new UsageError('clipzi transcript <video_id> [--start s] [--end s]');
    const args = { video_id: id };
    if (a.flags.start !== undefined) args.start = Number(a.flags.start);
    if (a.flags.end !== undefined) args.end = Number(a.flags.end);
    return callTool('get_transcript', args);
  },

  async find(a) {
    const [id, ...words] = a._;
    if (!id || !words.length) throw new UsageError('clipzi find <video_id> <what to look for> [--count 5]');
    return callTool('find_moments', { video_id: id, query: words.join(' '), count: intFlag(a.flags, 'count', 5) });
  },

  async job(a) {
    const [id] = a._;
    if (!id) throw new UsageError('clipzi job <job_id> [--wait]');
    return a.flags.wait ? waitForJob(id) : callTool('get_job', { job_id: id });
  },

  /**
   * The short way: a file, a link or a video already in Clipzi, to finished
   * clips on disk. Uploads a local file first, runs make_clips, follows the
   * job and downloads each clip as it finishes (an account without a plan
   * gets each clip's page to watch it instead).
   */
  async make(a) {
    const [source] = a._;
    if (!source) throw new UsageError('clipzi make <video file | link | video_id> [--count 5] [--query "..."] [--out ./clips]');
    const f = a.flags;
    const args = { count: intFlag(f, 'count', 5) };
    if (f.query) args.query = String(f.query);
    if (f.clips) args.clip_ids = String(f.clips).split(',').map((s) => s.trim()).filter(Boolean);
    if (f.template) args.template = String(f.template);
    if (f.pace) args.pace = String(f.pace);
    if (f.title !== undefined) args.title = f.title !== false && f.title !== 'false';
    if (f.horizontal) args.format = 'horizontal';

    const kind = sourceKind(source, existsSync);
    if (kind === 'file') args.video_id = await uploadFile(source);
    else if (kind === 'url') args.url = source;
    else args.video_id = source;

    const started = await callTool('make_clips', args);
    say(`Making clips (job ${started.job_id}). ${started.video?.dashboard ?? ''}`.trim());
    if (f.wait === false) return started;

    const out = resolve(String(f.out ?? 'clips'));
    const fetchFiles = f.download !== false;
    const files = new Map(); // clip_id -> local path
    const taken = new Set();
    let reported = '';
    const job = await waitForJob(started.job_id, async (j) => {
      const r = j.result ?? {};
      const line = r.stage === 'waiting_for_video' ? 'waiting for the video analysis' : `${r.done ?? 0} of ${r.total ?? '?'} clips finished`;
      if (line !== reported) { say(line); reported = line; }
      for (const c of r.clips ?? []) {
        if (c.status !== 'done' || files.has(c.clip_id)) continue;
        if (c.url && fetchFiles) {
          const path = await download(c.url, out, fileNameFor(c.title, 'mp4'), taken);
          files.set(c.clip_id, path);
          say(`  saved ${path}`);
        } else if (c.watch_page) {
          files.set(c.clip_id, null);
          say(`  ready to watch: ${c.watch_page}`);
        }
      }
    });
    const r = job.result ?? {};
    return {
      job_id: job.job_id,
      status: job.status,
      video_id: r.video_id ?? args.video_id ?? null,
      ...(job.error ? { error: job.error } : {}),
      clips: (r.clips ?? []).map((c) => ({
        clip_id: c.clip_id, title: c.title, start: c.start, end: c.end, status: c.status,
        ...(files.get(c.clip_id) ? { file: files.get(c.clip_id) } : {}),
        ...(c.url ? { url: c.url } : {}),
        ...(c.watch_page ? { watch_page: c.watch_page } : {}),
        ...(c.why ? { why: c.why } : {}),
        ...(c.error ? { error: c.error } : {}),
      })),
      ...(job.note ? { note: job.note } : {}),
    };
  },

  /** One clip's file: renders it when needed, waits, downloads it. */
  async render(a) {
    const [clipId] = a._;
    if (!clipId) throw new UsageError('clipzi render <clip_id> [--horizontal] [--edited] [--out ./clips]');
    const args = { clip_id: clipId };
    if (a.flags.horizontal) { args.format = 'horizontal'; if (a.flags.edited) args.edited = true; }
    const started = await callTool('render_clip', args);
    if (a.flags.wait === false) return started;
    const job = started.status === 'done' ? started : await waitForJob(started.job_id);
    const url = job.result?.url;
    if (job.status === 'done' && url && a.flags.download !== false) {
      const { clip } = await callTool('get_clip', { clip_id: clipId });
      const name = fileNameFor(args.format === 'horizontal' ? `${clip.title} (horizontal)` : clip.title, 'mp4');
      return { ...job, file: await download(url, resolve(String(a.flags.out ?? 'clips')), name, new Set()) };
    }
    return job;
  },
};

export const BOOLEAN_FLAGS = new Set(['wait', 'title', 'horizontal', 'edited', 'download', 'browser', 'help']);

export const HELP = `clipzi: long videos in, finished short clips out. ${SITE}
Run with npx -y github:clipzi-app/clipzi-agent <command>, or npm i -g github:clipzi-app/clipzi-agent for the clipzi command.

Sign in
  clipzi login                 Opens the browser to sign in and allow this terminal
  clipzi logout
  (or set CLIPZI_API_KEY to a key from ${SITE}/dashboard/agents, for servers and CI)

The short way
  clipzi make <file | link | video_id> [--count 5] [--query "the funny parts"]
              [--template impacto] [--pace fast] [--title] [--horizontal]
              [--out ./clips] [--no-wait] [--no-download]
      Uploads a local file (or takes a link to the file, Drive or Dropbox),
      lets Clipzi choose the moments, frames them for vertical, captions them,
      and saves each mp4 in --out as it finishes.

Step by step
  clipzi account               Plan, what is left, what the agent may do
  clipzi videos                The videos in the account
  clipzi upload <file> [--wait]
  clipzi import <link> [--wait]
  clipzi video <video_id> [--wait]
  clipzi clips <video_id>      The clips Clipzi found
  clipzi transcript <video_id> [--start s] [--end s]
  clipzi find <video_id> <what to look for> [--count 5]
  clipzi render <clip_id> [--horizontal [--edited]] [--out ./clips]
  clipzi job <job_id> [--wait]

Everything else
  clipzi tools                 Every tool the server has
  clipzi call <tool> '<json>'  Call any of them

Every command prints JSON on stdout (progress on stderr). Exit codes: 0 done,
1 the tool could not (the JSON says why and what to do), 2 wrong usage,
3 not signed in. Docs: ${SITE}/en/developers`;

export { ToolError };
