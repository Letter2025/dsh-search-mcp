/**
 * dsh-search-mcp — replace dsh's built-in web search with search MCP servers.
 *
 * A Cordis plugin that
 *   - registers a `ctx.web` search provider under the id `search-mcp`.
 *
 * Configuration is the plugin's own Cordis `Config` row: the profile tree
 * (bundle patch + profile overrides) is the single source of truth, and
 * dsh 0.1.7 renders it through the auto-generated settings page. Settings
 * edits reload this plugin instance, so `apply` receives the fresh config.
 *
 * The package's `cordis.patch.yml` (bundle layer) switches
 * `web.searchProvider` to `search-mcp` and disables the built-in
 * `web-search-deepseek` provider, so while this plugin is enabled the
 * built-in search is unavailable and every `web_search` call runs through
 * the configured MCP server(s). Removing the package restores the built-in.
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { SearchMCPProvider, SEARCH_MCP_PROVIDER_ID } from './provider.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'search-mcp';

/** The web seam this provider registers into. */
export const inject = ['web'];

const serverSchema = z.object({
  id: z.string(),
  kind: z.string().default('custom'),
  transport: z.string().default('http'),
  url: z.string().default(''),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(''),
  authStyle: z.string().default(''),
  authParam: z.string().default(''),
  authPrefix: z.string().default(''),
  toolName: z.string().default(''),
  // Note: this schemastery fork has no `.optional()`; object fields are
  // optional unless `.required()` is applied, so absence is already allowed.
  maxResults: z.number().step(1).min(1).max(50),
});

export const Config = z.object({
  defaultServer: z.string().default(''),
  maxResults: z.number().step(1).min(1).max(50).default(8),
  searchTimeoutMs: z.number().step(1).min(1000).default(30000),
  servers: z.array(serverSchema).default([]),
});

/** Settings namespace owning this plugin's section (Settings → Plugins card). */
export const SEARCH_MCP_SETTINGS_NAMESPACE = 'search-mcp';

/**
 * Register the search provider. dsh 0.1.7 removed the settings owner seam
 * (`ctx.settings.register` and the separate settings document); the profile
 * tree now carries this plugin's config, each live edit reloads the
 * instance, and `apply` always receives the resolved Config value.
 */
export function apply(ctx, config) {
  const current = () => config;
  // `registerSearchProvider` owns its cleanup via ctx.effect (HMR/dispose safe).
  ctx.web.registerSearchProvider(new SearchMCPProvider(() => resolveOptions(ctx, current())));
}

/**
 * Project the authoritative config into per-search options. The resolved
 * profile config (schema defaults <- bundle row <- profile overrides) is
 * authoritative for every operation.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently resolved section.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
  return {
    servers: config.servers ?? [],
    defaultServer: config.defaultServer ?? '',
    maxResults: config.maxResults ?? 8,
    searchTimeoutMs: config.searchTimeoutMs ?? 30000,
    resolveKey: async (server) => {
      if (server.apiKey !== undefined && server.apiKey.length > 0) return server.apiKey;
      const envName = server.apiKeyEnv ?? '';
      if (envName.length === 0) return undefined;
      const credentials = ctx.get('credentials');
      if (credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(credentialRef(envName));
          if (resolved !== undefined && resolved.value !== undefined && resolved.value.length > 0) {
            return resolved.value;
          }
        } catch {
          /* fall through to the launch environment */
        }
      }
      const ambient = launchEnvironmentOf(ctx).get(envName);
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
    },
  };
}
