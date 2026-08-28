const TINYFISH_FETCH_BASE_URL = 'https://api.fetch.tinyfish.ai';
const MAX_READER_CONTENT_CHARS = 16000;

export interface TinyfishFetchConfig {
  apiKey?: string;
}

export interface TinyfishFetchResult {
  url: string;
  content: string;
  truncated: boolean;
}

interface TinyfishFetchResponse {
  results: Array<{
    url: string;
    final_url: string;
    title?: string;
    description?: string;
    language?: string;
    format: string;
    text: string;
  }>;
  errors: Array<{
    url: string;
    error: string;
  }>;
}

export function normalizeReaderTargetUrl(url: string): string {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    throw new Error('A URL is required.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error('The provided URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  return parsedUrl.toString();
}

export async function fetchUrlWithTinyfish(
  url: string,
  config: TinyfishFetchConfig = {},
  signal?: AbortSignal,
): Promise<TinyfishFetchResult> {
  const normalizedUrl = normalizeReaderTargetUrl(url);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }

  const response = await fetch(TINYFISH_FETCH_BASE_URL, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      urls: [normalizedUrl],
      format: 'markdown',
      ttl: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`TinyFish Fetch request failed with status ${response.status}`);
  }

  const data = (await response.json()) as TinyfishFetchResponse;

  if (data.errors && data.errors.length > 0) {
    const firstError = data.errors[0];
    throw new Error(`TinyFish Fetch error: ${firstError.error}`);
  }

  if (!data.results || data.results.length === 0) {
    throw new Error('TinyFish Fetch returned no readable content.');
  }

  const result = data.results[0];
  const content = result.text?.trim() || '';

  if (!content) {
    throw new Error('TinyFish Fetch returned no readable content.');
  }

  const truncated = content.length > MAX_READER_CONTENT_CHARS;

  return {
    url: normalizedUrl,
    content: truncated ? `${content.slice(0, MAX_READER_CONTENT_CHARS)}\n\n[Truncated for QA context]` : content,
    truncated,
  };
}
