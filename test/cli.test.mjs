import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileNameFor, parseArgs, sourceKind, uniqueName } from '../src/util.mjs';
import { readToolResult, splitToolError, ToolError } from '../src/mcp.mjs';
import { pkcePair } from '../src/auth.mjs';
import { BOOLEAN_FLAGS } from '../src/commands.mjs';

test('flags: values, = values, booleans and --no-', () => {
  const a = parseArgs(['video.mp4', '--count', '3', '--query=the funny parts', '--title', '--no-wait', '--out', 'out dir'], BOOLEAN_FLAGS);
  assert.deepEqual(a._, ['video.mp4']);
  assert.deepEqual(a.flags, { count: '3', query: 'the funny parts', title: true, wait: false, out: 'out dir' });
});

test('a boolean flag never eats the next word', () => {
  const a = parseArgs(['--wait', 'clip-upload-1'], BOOLEAN_FLAGS);
  assert.deepEqual(a, { _: ['clip-upload-1'], flags: { wait: true } });
});

test('dashed flag names become camelCase', () => {
  assert.deepEqual(parseArgs(['--max-chars', '200']).flags, { maxChars: '200' });
});

test('a clip title as a file name every system takes', () => {
  assert.equal(fileNameFor('Why we left: a/b "story"?'), 'Why we left a b story.mp4');
  assert.equal(fileNameFor('   ', 'mp4'), 'clip.mp4');
  assert.equal(fileNameFor('Ends with dots...'), 'Ends with dots.mp4');
  assert.ok(fileNameFor('x'.repeat(300)).length <= 124);
});

test('the same name twice gets a number', () => {
  const taken = new Set();
  assert.equal(uniqueName('A.mp4', taken), 'A.mp4');
  assert.equal(uniqueName('A.mp4', taken), 'A (2).mp4');
  assert.equal(uniqueName('A.mp4', taken), 'A (3).mp4');
});

test('what a make argument is', () => {
  assert.equal(sourceKind('https://drive.google.com/file/d/x/view', () => false), 'url');
  assert.equal(sourceKind('./podcast.mp4', () => true), 'file');
  assert.equal(sourceKind('clip-upload-123', () => false), 'video_id');
});

test('a tool error comes as its code and message', () => {
  assert.deepEqual(splitToolError('quota: The 5 clips are used. Get a plan.'), { code: 'quota', message: 'The 5 clips are used. Get a plan.' });
  assert.deepEqual(splitToolError('Something odd'), { code: 'tool_error', message: 'Something odd' });
  assert.throws(() => readToolResult({ isError: true, content: [{ type: 'text', text: 'not_found: No clip "x".' }] }),
    (e) => e instanceof ToolError && e.code === 'not_found' && e.message === 'No clip "x".');
});

test('a tool value: structured content first, else the JSON text', () => {
  assert.deepEqual(readToolResult({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 2 } }), { a: 2 });
  assert.deepEqual(readToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
});

test('PKCE: the challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});
