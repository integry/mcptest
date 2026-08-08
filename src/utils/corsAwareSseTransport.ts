import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/client';
import { withRequestHeaders } from './corsAwareTransport';

export type CompatibleSseOptions = SSEClientTransportOptions & {
  /** Backward-compatible shorthand used by existing callers. */
  headers?: HeadersInit;
};

export class CorsAwareSSETransport extends SSEClientTransport {
  constructor(url: URL, opts: CompatibleSseOptions = {}) {
    const { headers, requestInit, ...transportOptions } = opts;
    super(url, {
      ...transportOptions,
      requestInit: withRequestHeaders(requestInit, headers),
    });
  }
}
