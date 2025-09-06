// src/workers/reportWorker.ts
import { evaluateServer } from '../utils/evaluation';

self.onmessage = async (e) => {
  const { serverUrl, token, oauthAccessToken } = e.data;

  const onProgress = (message: string) => {
    self.postMessage({ type: 'progress', data: message });
  };

  try {
    const report = await evaluateServer(serverUrl, token, onProgress, oauthAccessToken);
    self.postMessage({ type: 'complete', data: report });
  } catch (error) {
    self.postMessage({ type: 'progress', data: `Error: ${(error as Error).message}` });
    self.postMessage({ type: 'complete', data: null });
  }
};