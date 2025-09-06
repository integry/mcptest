import { evaluateServer } from '../utils/evaluation';

self.onmessage = async (event) => {
  const serverUrl = event.data;

  const onProgress = (message: string) => {
    self.postMessage({ type: 'progress', message });
  };

  try {
    const report = await evaluateServer(serverUrl, onProgress);
    self.postMessage({ type: 'complete', report });
  } catch (error) {
    console.error('[Worker] Evaluation error:', error);
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'An unknown error occurred.' });
  }
};
