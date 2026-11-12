/**
 * What MCP clients do with tool annotation hints, limited to behaviour stated
 * in a client's own changelog or release notes. Each entry quotes the source
 * line verbatim so a reviewer can re-check it. Anything not listed here is
 * described by what the specification says the hint means, never by guessed
 * client behaviour.
 */

export interface ToolHintClientBehavior {
  /** clientCompatibility.json id of the client. */
  clientId: 'claude-code' | 'codex-cli';
  clientName: string;
  /** What the client does, and which hints decide it. */
  behavior: 'retry-after-dropped-connection' | 'parallel-read-only-calls';
  /** The client version that introduced the behaviour. */
  sinceVersion: string;
  sourceTitle: string;
  sourceUrl: string;
  /** The source line, verbatim. */
  quote: string;
  verifiedOn: string;
}

/**
 * Claude Code CHANGELOG.md, section "2.1.307":
 * "Fixed HTTP MCP tool calls being sent twice when the connection closed
 * mid-call; only read-only or idempotent tools are now retried"
 * https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
 */
export const CLAUDE_CODE_RETRY_BEHAVIOR: ToolHintClientBehavior = {
  clientId: 'claude-code',
  clientName: 'Claude Code',
  behavior: 'retry-after-dropped-connection',
  sinceVersion: '2.1.307',
  sourceTitle: 'Claude Code changelog, 2.1.307',
  sourceUrl: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
  quote: 'Fixed HTTP MCP tool calls being sent twice when the connection closed mid-call; only read-only or idempotent tools are now retried',
  verifiedOn: '2026-11-11',
};

/**
 * Codex CLI release rust-v0.134.0:
 * "Let read-only MCP tools run concurrently when they advertise `readOnlyHint`. (#23750)"
 * https://github.com/openai/codex/releases/tag/rust-v0.134.0
 */
export const CODEX_CLI_PARALLEL_BEHAVIOR: ToolHintClientBehavior = {
  clientId: 'codex-cli',
  clientName: 'Codex CLI',
  behavior: 'parallel-read-only-calls',
  sinceVersion: '0.134.0',
  sourceTitle: 'Codex CLI release notes, rust-v0.134.0',
  sourceUrl: 'https://github.com/openai/codex/releases/tag/rust-v0.134.0',
  quote: 'Let read-only MCP tools run concurrently when they advertise `readOnlyHint`. (#23750)',
  verifiedOn: '2026-11-11',
};

export const TOOL_HINT_CLIENT_BEHAVIORS: readonly ToolHintClientBehavior[] = Object.freeze([
  CLAUDE_CODE_RETRY_BEHAVIOR,
  CODEX_CLI_PARALLEL_BEHAVIOR,
]);

/**
 * The specification's definition of the hints and their defaults
 * (schema.ts, ToolAnnotations, revision 2025-11-25).
 */
export const TOOL_ANNOTATIONS_SPEC_URL = 'https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations';
