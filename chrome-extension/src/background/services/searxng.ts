export interface SearxngSearchConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  maxResults: number;
}

export interface SearxngSearchResult {
  title: string;
  url: string;
  content: string;
  engine?: string;
  score?: number;
}

interface SearxngSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    engine?: string;
    score?: number;
  }>;
}

function normalizeConfig(config: SearxngSearchConfig): SearxngSearchConfig {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey?.trim(),
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

export async function searchSearxng(
  query: string,
  config: SearxngSearchConfig,
  signal?: AbortSignal,
): Promise<SearxngSearchResult[]> {
  const normalizedConfig = normalizeConfig(config);

  if (!normalizedConfig.enabled || !normalizedConfig.baseUrl) {
    return [];
  }

  const searchUrl = new URL(`${normalizedConfig.baseUrl}/search`);
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('language', 'en-US');
  searchUrl.searchParams.set('safesearch', '1');

  const headers: HeadersInit = {
    Accept: 'application/json',
  };

  if (normalizedConfig.apiKey) {
    headers.Authorization = `Bearer ${normalizedConfig.apiKey}`;
  }

  const response = await fetch(searchUrl.toString(), {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`SearXNG request failed with status ${response.status}`);
  }

  const data = (await response.json()) as SearxngSearchResponse;
  const results = data.results ?? [];

  return results
    .filter(result => result.url && result.title)
    .slice(0, normalizedConfig.maxResults)
    .map(result => ({
      title: result.title ?? '',
      url: result.url ?? '',
      content: result.content ?? '',
      engine: result.engine,
      score: result.score,
    }));
}

export function formatSearchResultsForPrompt(results: SearxngSearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  return results
    .map((result, index) => {
      const lines = [`[${index + 1}] ${result.title}`, `URL: ${result.url}`];

      if (result.engine) {
        lines.push(`Engine: ${result.engine}`);
      }

      if (result.content) {
        lines.push(`Snippet: ${result.content}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
