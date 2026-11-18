// Small pieces every command uses: arguments, output, file names.
// Pure (no network, no disk) so the tests can hold them.

/**
 * argv -> { _: positionals, flags }. `--count 5`, `--count=5` and `--title`
 * (a flag with no value, true) all work; `--no-wait` sets wait: false.
 * Names in BOOLEAN never take the next word as their value.
 */
export function parseArgs(argv, BOOLEAN = new Set()) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a === '--') { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const name = toCamel(eq > 0 ? a.slice(2, eq) : a.slice(2));
    if (eq > 0) { out.flags[name] = a.slice(eq + 1); continue; }
    if (name.startsWith('no') && name.length > 2 && name[2] === name[2].toUpperCase()) {
      out.flags[name[2].toLowerCase() + name.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (BOOLEAN.has(name) || next === undefined || next.startsWith('--')) out.flags[name] = true;
    else { out.flags[name] = next; i++; }
  }
  return out;
}

const toCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** A whole number flag, or the default; a usage error when it is not a number. */
export function intFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const n = Number(flags[name]);
  if (!Number.isInteger(n)) throw new UsageError(`--${name} takes a whole number`);
  return n;
}

export class UsageError extends Error {}

/** A clip's title as a file name that every system accepts, with its extension. */
export function fileNameFor(title, ext = 'mp4', fallback = 'clip') {
  const base = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  return `${base || fallback}.${ext}`;
}

/** The same name made unique among those already taken: "Title.mp4", "Title (2).mp4"... */
export function uniqueName(name, taken) {
  if (!taken.has(name)) { taken.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}

/** What a make/import argument is: a local file, a link, or the id of a video already in Clipzi. */
export function sourceKind(arg, exists) {
  if (/^https?:\/\//i.test(arg)) return 'url';
  if (exists(arg)) return 'file';
  return 'video_id';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The answer of every command: JSON on stdout, so an agent can read it and a person too. */
export function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** What is happening, for whoever watches: stderr, never mixed with the JSON answer. */
export function say(text) {
  if (!process.env.CLIPZI_QUIET) process.stderr.write(`${text}\n`);
}
