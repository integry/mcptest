import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/client';

export type CompatibleStreamableHttpOptions = StreamableHTTPClientTransportOptions & {
  /** Backward-compatible shorthand used by existing callers. */
  headers?: HeadersInit;
};

export const withRequestHeaders = (
  requestInit: RequestInit | undefined,
  headers: HeadersInit | undefined
): RequestInit | undefined => {
  if (!requestInit && !headers) {
    return undefined;
  }

  const mergedHeaders = new Headers(requestInit?.headers);
  new Headers(headers).forEach((value, key) => mergedHeaders.set(key, value));

  return { ...requestInit, headers: mergedHeaders };
};

export class CorsAwareStreamableHTTPTransport extends StreamableHTTPClientTransport {
  constructor(url: URL, opts: CompatibleStreamableHttpOptions = {}) {
    const { headers, requestInit, ...transportOptions } = opts;
    super(url, {
      ...transportOptions,
      requestInit: withRequestHeaders(requestInit, headers),
    });
  }
}
