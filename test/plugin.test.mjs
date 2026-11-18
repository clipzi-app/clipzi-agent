import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The directory's plugin lives in plugin/ (only Markdown, JSON and images: no code).
// Its skill drives Clipzi through the MCP tools alone: the plugin declares that it
// runs no code outside its declared server, so it never tells Claude to run the
// command line (the repository's own skill, for `npx skills add`, does).
test('the plugin skill uses the tools and runs no program', () => {
  const skill = readFileSync(new URL('../plugin/skills/clipzi/SKILL.md', import.meta.url), 'utf8');
  assert.ok(/^---\nname: clipzi\n/.test(skill));
  for (const tool of ['make_clips', 'get_job', 'get_upload_link', 'upload_video', 'get_upgrade_link']) assert.ok(skill.includes(tool), tool);
  assert.ok(!/npx|npm i|github:|clipzi login/.test(skill));
});

test('the plugin points at the account MCP server and names its privacy policy', () => {
  const p = JSON.parse(readFileSync(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(p.mcpServers.clipzi.url, 'https://clipzi.app/mcp');
  assert.ok(p.privacyPolicyUrl.startsWith('https://clipzi.app/'));
});
