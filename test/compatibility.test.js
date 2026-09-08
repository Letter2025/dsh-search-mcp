import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('package exports resolve and dependencies follow the 0.1.2 host model', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.browser.js');
  assert.equal(pkg.engines.node, '>=20');

  // Host-provided packages are peers pinned to 0.1.2-rc.1; runtime-only
  // protocol dependencies stay in `dependencies`.
  for (const name of [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-web',
  ]) {
    assert.equal(pkg.dependencies[name], undefined);
    assert.equal(pkg.peerDependencies[name], '^0.1.2-rc.1');
  }
  assert.equal(pkg.dependencies.undici, '6.28.0');
  assert.equal(pkg.dependencies['ipaddr.js'], '2.5.0');
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.30.0');

  // The client inject list names only 0.1.2 graph rows; the removed
  // dsh-client-runtime must not appear.
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
  ]);
  assert.equal(pkg.dsh.client.platform, 'web');
});

test('0.1.2 browser bundle: settingsScope card, keyed slot, module-table-only requires', async () => {
  const client = await read('lib/client.browser.js');
  assert.match(client, /settingsScope\.bind\(\{\s*namespace: NS\s*\}\)/);
  assert.match(client, /name: "settings\.plugin\.item",\s+key: NS,/);
  assert.doesNotMatch(client, /api\.settings\.describe/);
  assert.doesNotMatch(client, /@deepseek-ai\/dsh-client-runtime/);
  // The only external is the module table's react word.
  assert.deepEqual([...client.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]), ['react']);
  assert.match(client, /window\.__ModuleLoader__\.load\s*\(\s*\{\s*id: "dsh-search-mcp"/);
  assert.match(client, /scope\.set\("servers", next\)/);
  assert.match(client, /scope\.unset\(field\)/);
});

test('host half registers the namespace through the rc.1 owner seam', async () => {
  const host = await read('lib/index.js');
  assert.match(host, /export const inject = \['web', 'settings'\]/);
  assert.match(host, /settings\.register\(SEARCH_MCP_SETTINGS_NAMESPACE, Config, \{/);
  assert.match(host, /base: config/);
  // The removed settings entry points must not be imported anymore.
  assert.doesNotMatch(host, /from '@deepseek-ai\/dsh-settings'/);
  assert.doesNotMatch(host, /settingsNamespace\(/);
});

test('known providers are CDKey-only while custom keeps advanced fields', async () => {
  const client = await read('lib/client.browser.js');
  const catalog = client.slice(client.indexOf('const CATALOG = {'), client.indexOf('const KNOWN_KINDS'));
  assert.doesNotMatch(catalog, /https?:\/\//);
  assert.doesNotMatch(catalog, /toolName|authParam|transport/);
  assert.match(client, /const isCustom = server\.kind === "custom"/);
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