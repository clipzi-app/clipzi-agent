import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The directory's plugin lives in plugin/ (only Markdown, JSON and images: no code).
// Its skill is a copy of the repository's own, which `npx skills add` reads.
test('the plugin ships the same skill as the repository', () => {
  assert.equal(readFileSync(new URL('../plugin/skills/clipzi/SKILL.md', import.meta.url), 'utf8'), readFileSync(new URL('../skills/clipzi/SKILL.md', import.meta.url), 'utf8'));
});

test('the plugin points at the account MCP server and names its privacy policy', () => {
  const p = JSON.parse(readFileSync(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(p.mcpServers.clipzi.url, 'https://clipzi.app/mcp');
  assert.ok(p.privacyPolicyUrl.startsWith('https://clipzi.app/'));
});
