import { redactReportString, redactReportValue } from '../utils/reportArtifact';
import type {
  MonitoringAlertV1,
  MonitoringNotificationAdapter,
} from './types';

export interface WebhookNotificationOptions {
  url: string;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  name?: string;
}

const publicAlert = (alert: MonitoringAlertV1): MonitoringAlertV1 => (
  redactReportValue(alert) as MonitoringAlertV1
);

/** Sends the redacted alert body. The webhook URL and its authorization headers are never copied into it. */
export const createWebhookNotificationAdapter = (
  options: WebhookNotificationOptions
): MonitoringNotificationAdapter => ({
  name: options.name || 'webhook',
  async send(alert) {
    const response = await (options.fetch || globalThis.fetch)(options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...Object.fromEntries(new Headers(options.headers).entries()),
      },
      body: JSON.stringify(publicAlert(alert)),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}.`);
    }
  },
});

export interface EmailStyleMessage {
  subject: string;
  text: string;
  alert: MonitoringAlertV1;
}

export interface EmailStyleNotificationOptions {
  name?: string;
  send(message: EmailStyleMessage): Promise<void>;
}

/** Adapter seam for hosts that already provide email delivery infrastructure. */
export const createEmailStyleNotificationAdapter = (
  options: EmailStyleNotificationOptions
): MonitoringNotificationAdapter => ({
  name: options.name || 'email',
  async send(alert) {
    const safe = publicAlert(alert);
    const evidence = safe.evidence.map((item) => `- ${item.message}`).join('\n');
    const links = [
      safe.before ? `Before: ${safe.before.url}` : undefined,
      `After: ${safe.after.url}`,
    ].filter(Boolean).join('\n');
    await options.send({
      subject: redactReportString(`[mcptest] ${safe.title}`),
      text: `${safe.summary}\n\n${evidence}\n\n${links}`,
      alert: safe,
    });
  },
});
