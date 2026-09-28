import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('package exports resolve and dependencies follow the 0.1.7 host model', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], undefined);
  assert.equal(pkg.engines.node, '>=20');

  // Host-provided packages are peers pinned to 0.1.7-rc.2; runtime-only
  // protocol dependencies stay in `dependencies`.
  for (const name of [
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-web',
  ]) {
    assert.equal(pkg.dependencies[name], undefined);
    assert.equal(pkg.peerDependencies[name], '^0.1.7-rc.2');
  }
  assert.equal(pkg.dependencies.undici, '6.28.0');
  assert.equal(pkg.dependencies['ipaddr.js'], '2.5.0');
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.30.0');

  // dsh 0.1.7 dropped the settings owner seam and the document-backed
  // settings card; the plugin owns no browser half anymore.
  assert.equal(pkg.dsh.client, undefined);
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-settings'], undefined);
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-api-remotes'], undefined);
});

test('host half resolves config from the profile row without a settings scope', async () => {
  const host = await read('lib/index.js');
  assert.match(host, /export const inject = \['web'\]/);
  assert.match(host, /const current = \(\) => config;/);
  assert.match(host, /ctx\.web\.registerSearchProvider/);
  assert.doesNotMatch(host, /settings\.register\(SEARCH_MCP_SETTINGS_NAMESPACE/);
  assert.doesNotMatch(host, /from '@deepseek-ai\/dsh-settings'/);
});

test('HTTP transport pins DNS and applies one guarded fetch to every SDK request', async () => {
  const transport = await read('lib/client.js');
  assert.match(transport, /validateHttpEndpoint\(server\.url, \{ signal \}\)/);
  assert.match(transport, /new Agent\(\{[\s\S]*connect: \{ lookup: validated\.lookup \}/);
  assert.match(transport, /requestUrl\.origin !== expectedOrigin/);
  assert.match(transport, /dispatcher: agent/);
  assert.match(transport, /redirect: 'error'/);
  assert.match(transport, /fetch: secureFetch/);
  assert.match(transport, /await client\.close\(\)[\s\S]*await runtime\?\.close\(\)/);
  assert.doesNotMatch(transport, /new URL\(server\.url\)[\s\S]*new StreamableHTTPClientTransport\(url, \{\s*requestInit:/);
});

test('bundle replaces built-in search and leaves default row endpoint-free', async () => {
  const patch = await read('cordis.patch.yml');
  assert.match(patch, /searchProvider: search-mcp/);
  assert.match(patch, /fetchProvider: http/);
  assert.match(patch, /- id: web-search-deepseek\s+disabled: true/);
  assert.match(patch, /- id: tool-web\s+disabled: false/);
  assert.match(patch, /fetch: false/);
  assert.match(patch, /searchMaxResults: 50/);
  assert.match(patch, /searchMaxQueries: 4/);
  const defaultRow = patch.slice(patch.indexOf('- id: tavily'), patch.indexOf('- id: web'));
  assert.doesNotMatch(defaultRow, /url:|toolName:|authParam:|transport:/);
});