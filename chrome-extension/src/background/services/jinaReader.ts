const JINA_READER_BASE_URL = 'https://r.jina.ai/';
const MAX_READER_CONTENT_CHARS = 16000;

export interface JinaReaderConfig {
  apiKey?: string;
}

export interface JinaReaderResult {
  url: string;
  content: string;
  truncated: boolean;
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

export async function readUrlWithJina(
  url: string,
  config: JinaReaderConfig = {},
  signal?: AbortSignal,
): Promise<JinaReaderResult> {
  const normalizedUrl = normalizeReaderTargetUrl(url);
  const headers: HeadersInit = {
    Accept: 'text/plain',
    'X-Respond-With': 'markdown',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers['X-API-Key'] = config.apiKey;
  }

  const response = await fetch(`${JINA_READER_BASE_URL}${normalizedUrl}`, {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Jina Reader request failed with status ${response.status}`);
  }

  const content = await response.text();
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new Error('Jina Reader returned no readable content.');
  }

  const truncated = trimmedContent.length > MAX_READER_CONTENT_CHARS;

  return {
    url: normalizedUrl,
    content: truncated
      ? `${trimmedContent.slice(0, MAX_READER_CONTENT_CHARS)}\n\n[Truncated for QA context]`
      : trimmedContent,
    truncated,
  };
}
