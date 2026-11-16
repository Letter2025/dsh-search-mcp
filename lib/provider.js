/**
 * The `search-mcp` web search provider.
 *
 * Registers into `ctx.web` under the stable id `search-mcp`; the profile
 * patch switches `web.searchProvider` to this id and disables the built-in
 * DeepSeek provider, so the model-facing `web_search` tool executes entirely
 * through the configured search MCP server(s).
 */
import { WebError } from '@deepseek-ai/dsh-web';
import { resolveServer } from './catalog.js';
import { callMcpSearch } from './client.js';
import { extractSearchResult } from './extract.js';

/** Stable provider id the `web` row's `searchProvider` config selects. */
export const SEARCH_MCP_PROVIDER_ID = 'search-mcp';

/** The web search provider served by this plugin. */
export class SearchMCPProvider {
  id = SEARCH_MCP_PROVIDER_ID;

  /**
   * Picker title shown by the Web search provider menu of dsh 0.2.2-rc.3+.
   * Older hosts ignore the field and display {@link id} instead.
   */
  title = 'Search MCP';

  /**
   * Picker description shown under the selected provider on that page: what
   * this provider suits and what its server decides about results and cost.
   * `LocalizedText` from dsh-package-manifest is a plain string or an object
   * with a required `en` entry; translations are keyed by lowercase language id.
   */
  description = {
    en: 'Searches through the search MCP server configured in this plugin. Results, charges, and reachable sources are set by that server.',
    zh: '通过本插件中配置的搜索 MCP 服务器执行搜索。结果数量、费用与可访问来源由该服务器决定。',
  };

  /**
   * @param resolveOptions - snapshots the authoritative config (row config,
   *   or the live settings section) at the START of each operation, so one
   *   search never mixes two settings saves.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
  }

  /** Usable when at least one server entry exists; precise errors surface at search time. */
  available() {
    const options = this.resolveOptions();
    return Array.isArray(options.servers) && options.servers.length > 0;
  }

  async search(request, signal) {
    const options = this.resolveOptions();
    const server = pickServer(options);
    const resolved = resolveServer(server);
    const maxResults = resolved.maxResults ?? options.maxResults ?? request.maxResults ?? 8;
    const key = await options.resolveKey(resolved);
    if (resolved.needsKey && (key === undefined || key.length === 0)) {
      const ref = resolved.apiKeyEnv.length > 0 ? resolved.apiKeyEnv : 'apiKey';
      throw new WebError(
        `search-mcp server "${resolved.id}" (${resolved.kind}) has no API key; set "apiKey" or a resolvable "apiKeyEnv" (${ref}) in Settings → Plugins → search-mcp`,
        'WEB_PROVIDER_ERROR',
      );
    }
    const combined = buildSignal(signal, options.searchTimeoutMs);
    const outcome = await callMcpSearch(resolved, key, { query: request.query, maxResults }, combined);
    return extractSearchResult(outcome);
  }
}

/** Select the default server, falling back to the first configured entry. */
function pickServer(options) {
  const servers = Array.isArray(options.servers) ? options.servers : [];
  if (servers.length === 0) {
    throw new WebError(
      'search-mcp: no search MCP servers configured; add one in Settings → Plugins → search-mcp',
      'WEB_PROVIDER_ERROR',
    );
  }
  if (options.defaultServer !== undefined && options.defaultServer.length > 0) {
    const found = servers.find((entry) => entry.id === options.defaultServer);
    if (found === undefined) {
      throw new WebError(
        `search-mcp: defaultServer "${options.defaultServer}" is not configured; known servers: ${servers
          .map((entry) => `"${entry.id}"`)
          .join(', ') || '(none)'}`,
        'WEB_PROVIDER_ERROR',
      );
    }
    return found;
  }
  return servers[0];
}

/** Combine the caller's cancellation with the configured timeout. */
function buildSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
}
