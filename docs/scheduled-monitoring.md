# Scheduled MCP monitoring

The monitoring engine runs the same headless MCP negotiation and report pipeline as the release gate. It supports stateless and stateful Streamable HTTP plus legacy HTTP+SSE, and monitoring is available without entitlements, quotas, feature flags, or usage gates.

This is the canonical implementation of the monitoring outcome first outlined in [issue #1](https://github.com/integry/mcptest/issues/1). [Issue #250](https://github.com/integry/mcptest/issues/250) tracks the scheduled monitoring and drift-alerting implementation; these are not separate roadmaps.

## Run from a scheduler

Create a configuration file. Keep secret values out of it; credentials and webhook URLs are referenced by environment-variable name.

```json
{
  "targets": [
    {
      "id": "public-search",
      "endpoint": "https://search.example/mcp",
      "reportBaseUrl": "https://reports.example/mcp/:serverId/:snapshotId"
    },
    {
      "id": "private-api",
      "endpoint": "https://api.example/mcp",
      "bearerTokenEnv": "PRIVATE_MCP_TOKEN"
    }
  ],
  "stateFile": "mcptest-monitor/state.json",
  "reportDirectory": "mcptest-monitor/reports",
  "concurrency": 4,
  "timeoutMs": 30000,
  "retry": {
    "maxAttempts": 3,
    "baseDelayMs": 1000,
    "maxDelayMs": 30000
  },
  "retention": {
    "perServer": 30,
    "total": 200
  },
  "webhooks": [
    {
      "name": "operations",
      "urlEnv": "MCP_MONITOR_WEBHOOK_URL",
      "bearerTokenEnv": "MCP_MONITOR_WEBHOOK_TOKEN"
    }
  ]
}
```

Run one scheduled cycle:

```bash
npm run monitor -- --config mcptest-monitor.json
```

Invoke that command from cron, a systemd timer, CI schedule, or another scheduler. Persist both the state file and report directory between invocations. The exported `MonitoringScheduler` is available to long-running Node or Worker hosts; it schedules the next cycle only after the current one completes. `MonitoringRunner.runOnce()` also skips concurrent triggers, and a timed-out underlying transport remains marked in flight so the next cycle skips it instead of stacking another probe.

Every remote is probed and recorded independently before aggregate health is calculated. Concurrency and per-probe timeouts are bounded. Credentialed targets are isolated because their credential-scoped SDK evaluations are serialized; public targets can still run concurrently.

## Status and provenance

Each snapshot has one operational status:

| Status | Meaning | Failure provenance |
| --- | --- | --- |
| `healthy` | A complete scored report was produced. | None |
| `authorization-required` | The target returned the expected OAuth/API authorization prerequisite. This is not downtime. | None |
| `degraded` | The target returned a partial report or rate limiting. | Target |
| `unavailable` | The target could not complete MCP negotiation. | Target |
| `proxy-failure` | The proxy generated the failure or requires its own authorization. | Proxy |
| `checker-failure` | The evaluator, timeout guard, persistence host, or other checker infrastructure failed. | Checker |

Proxy responses carry `X-MCP-Proxy-Response-Source`; the evaluator retains this as failure evidence so a proxy-generated response is not attributed to the target. State contains current status, bounded status/report history, last run, last good run, last change, and the most recent failure with its provenance.

HTTP 429 is degraded rather than unavailable. Numeric and HTTP-date `Retry-After` guidance is honored; otherwise transient target, proxy, and checker failures use exponential backoff capped by `maxDelayMs`. Target OAuth 401/403 responses become `authorization-required` and are never retried as downtime. Proxy authentication is classified separately and is not retried because it provides no target-health evidence.

## Drift and notifications

Reports are compared semantically using the shared report diff engine. Alerts cover:

- reachability and recovery transitions;
- target authorization prerequisite changes;
- protocol era/version and transport changes;
- tool additions, removals, and input-schema changes;
- latency regressions greater than both 100 ms and 25 percent;
- newly introduced high, error, or critical findings.

Each alert contains bounded evidence plus links to the before and after report snapshots. Configure `reportBaseUrl` for links served by your artifact host; it may contain `:serverId` and `:snapshotId`. Without it, links use the relative `reports/<server>/<snapshot>.json` layout written by the filesystem store.

Webhook request URLs and authorization headers are transport configuration and are never copied into notification bodies. Reports, state, errors, endpoints, and alert payloads pass through the shared redaction pipeline before persistence or delivery. Hosts with existing email infrastructure can use `createEmailStyleNotificationAdapter`; it deliberately accepts a delivery callback rather than adding provider credentials or a new mail service to mcptest.

Notification delivery errors are returned separately from target health so a broken notification provider cannot be mistaken for MCP downtime.
