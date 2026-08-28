export interface TinyfishSearchConfig {
  enabled: boolean;
  apiKey: string;
  maxResults: number;
}

export interface TinyfishSearchResult {
  title: string;
  url: string;
  content: string;
  siteName?: string;
  position?: number;
  date?: string;
}

interface TinyfishSearchResponse {
  query: string;
  results: Array<{
    position: number;
    site_name: string;
    title: string;
    snippet: string;
    url: string;
    date?: string;
  }>;
  total_results: number;
  page: number;
}

function normalizeConfig(config: TinyfishSearchConfig): TinyfishSearchConfig {
  return {
    enabled: config.enabled,
    apiKey: config.apiKey.trim(),
    maxResults: Math.min(10, Math.max(1, Math.round(config.maxResults || 5))),
  };
}

export function shouldUseWebSearch(query: string, includePageContent: boolean): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return false;
  }

  if (!includePageContent) {
    return true;
  }

  return /\b(search|web|internet|online|find|look up|latest|current|today|recent|news|price|weather|release date|stock|score)\b/i.test(
    trimmedQuery,
  );
}

export async function searchTinyfish(
  query: string,
  config: TinyfishSearchConfig,
  signal?: AbortSignal,
): Promise<TinyfishSearchResult[]> {
  const normalizedConfig = normalizeConfig(config);

  if (!normalizedConfig.enabled || !normalizedConfig.apiKey) {
    return [];
  }

  const searchUrl = new URL('https://api.search.tinyfish.ai');
  searchUrl.searchParams.set('query', query);

  const headers: HeadersInit = {
    Accept: 'application/json',
    'X-API-Key': normalizedConfig.apiKey,
  };

  const response = await fetch(searchUrl.toString(), {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`TinyFish Search request failed with status ${response.status}`);
  }

  const data = (await response.json()) as TinyfishSearchResponse;
  const results = data.results ?? [];

  return results
    .filter(result => result.url && result.title)
    .slice(0, normalizedConfig.maxResults)
    .map(result => ({
      title: result.title ?? '',
      url: result.url ?? '',
      content: result.snippet ?? '',
      siteName: result.site_name,
      position: result.position,
      date: result.date,
    }));
}

export function formatSearchResultsForPrompt(results: TinyfishSearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  return results
    .map((result, index) => {
      const lines = [`[${index + 1}] ${result.title}`, `URL: ${result.url}`];

      if (result.siteName) {
        lines.push(`Source: ${result.siteName}`);
      }

      if (result.content) {
        lines.push(`Snippet: ${result.content}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
