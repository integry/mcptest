import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import app from '../app.mjs';

export const handler = awslambda.streamifyResponse(async (event, output) => {
  const method = event.requestContext.http.method;
  const headers = new Headers(event.headers);
  const url = new URL(event.rawPath, process.env.PUBLIC_URL);
  url.search = event.rawQueryString ?? '';
  const body = event.body == null ? undefined
    : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const request = new Request(url, {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
  const response = await app.fetch(request);
  const stream = awslambda.HttpResponseStream.from(output, {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
  });
  if (response.body) await pipeline(Readable.fromWeb(response.body), stream);
  else stream.end();
});
