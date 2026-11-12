import { describe, expect, it } from 'vitest';
import {
  IDLE_CONNECTION_PROGRESS,
  connectionStages,
  describeConnectionProgress,
  listOutcome,
  listStageFromDiscovery,
  reduceConnectionProgress,
  type ConnectionProgressEvent,
} from './connectionStages';
import type { DiscoveryStatus } from '../hooks/useToolsAndResources';

const run = (...events: ConnectionProgressEvent[]) => events.reduce(reduceConnectionProgress, IDLE_CONNECTION_PROGRESS);
const statusOf = (progress: ReturnType<typeof run>) => Object.fromEntries(
  connectionStages(progress).map(({ id, status }) => [id, status])
);

describe('connection stage reporting', () => {
  it('starts with only the first stage in progress', () => {
    expect(statusOf(run({ type: 'start' }))).toEqual({ reach: 'active', negotiate: 'pending', authorize: 'pending', list: 'pending' });
  });

  it('treats any readable HTTP status as reaching the endpoint, and a fetch failure as nothing yet', () => {
    expect(statusOf(run({ type: 'start' }, { type: 'response' })).reach).toBe('active');
    const reached = run({ type: 'start' }, { type: 'response', status: 405, ok: false, route: 'direct' });
    expect(statusOf(reached)).toMatchObject({ reach: 'done', negotiate: 'active' });
    expect(connectionStages(reached)[0].detail).toBe('HTTP 405');
    const viaProxy = run({ type: 'start' }, { type: 'response', status: 200, ok: true, route: 'proxy' });
    expect(connectionStages(viaProxy)[0].detail).toBe('HTTP 200 through the mcptest proxy');
  });

  it('notes the negotiation request that answered', () => {
    const progress = run({ type: 'start' }, { type: 'response', status: 200, ok: true, mcpMethod: 'initialize' });
    expect(connectionStages(progress)[1]).toMatchObject({ status: 'active', detail: 'initialize answered' });
  });

  it('records the negotiated version and marks authorization not required for an open server', () => {
    const progress = run(
      { type: 'start' },
      { type: 'response', status: 200, ok: true },
      { type: 'connected', protocolVersion: '2025-11-25', transport: 'streamable-http' },
    );
    const stages = connectionStages(progress);
    expect(progress.phase).toBe('connected');
    expect(stages.slice(0, 3).map(({ status }) => status)).toEqual(['done', 'done', 'skipped']);
    expect(stages[1].detail).toBe('MCP 2025-11-25 over Streamable HTTP');
    expect(stages[2].detail).toBe('Not required');
  });

  it('counts sent credentials as authorization', () => {
    const progress = run({ type: 'start', credentialed: true }, { type: 'connected', protocolVersion: null });
    expect(connectionStages(progress)[2]).toMatchObject({ status: 'done', detail: 'Credentials accepted' });
  });

  it('follows the OAuth path: challenge, waiting for the user, token, then the handshake', () => {
    const challenged = run({ type: 'start' }, { type: 'auth-challenge', status: 401 });
    expect(statusOf(challenged)).toMatchObject({ reach: 'done', negotiate: 'pending', authorize: 'active' });
    const waiting = reduceConnectionProgress(challenged, { type: 'auth-waiting', detail: 'Continue at the authorization server' });
    expect(waiting.phase).toBe('waiting');
    expect(statusOf(waiting).authorize).toBe('waiting');
    const authorized = run({ type: 'start' }, { type: 'auth-challenge', status: 401 }, { type: 'auth-complete' });
    expect(statusOf(authorized)).toMatchObject({ authorize: 'done', negotiate: 'active' });
    const connected = reduceConnectionProgress(authorized, { type: 'connected', protocolVersion: '2025-11-25' });
    expect(connectionStages(connected)[2].detail).toBe('Access token received');
  });

  it('fails the stage in progress, not a later one', () => {
    expect(statusOf(run({ type: 'start' }, { type: 'failed' }))).toMatchObject({ reach: 'failed', negotiate: 'pending' });
    expect(statusOf(run({ type: 'start' }, { type: 'response', status: 200 }, { type: 'failed' })))
      .toMatchObject({ reach: 'done', negotiate: 'failed' });
    expect(statusOf(run({ type: 'start' }, { type: 'auth-challenge', status: 401 }, { type: 'failed', detail: 'OAuth authorization failed' })))
      .toMatchObject({ authorize: 'failed', negotiate: 'pending' });
  });

  it('reports a user abort as a cancelled stage and resets on disconnect', () => {
    const aborted = run({ type: 'start' }, { type: 'aborted' });
    expect(connectionStages(aborted)[0]).toMatchObject({ status: 'failed', detail: 'Cancelled' });
    expect(run({ type: 'start' }, { type: 'reset' })).toBe(IDLE_CONNECTION_PROGRESS);
  });

  it('ignores transport responses after the attempt has ended', () => {
    const failed = run({ type: 'start' }, { type: 'failed' });
    expect(reduceConnectionProgress(failed, { type: 'response', status: 200, ok: true })).toBe(failed);
  });

  it('derives the list stage from the real list requests', () => {
    const connected = run({ type: 'start' }, { type: 'connected', protocolVersion: '2026-07-28' });
    const loading = listStageFromDiscovery({ tools: 'complete', resources: 'loading', resourceTemplates: 'idle', prompts: 'complete' });
    expect(loading).toEqual({ status: 'active', detail: '2 of 4 lists received' });
    const done = listStageFromDiscovery(
      { tools: 'complete', resources: 'complete', resourceTemplates: 'failed', prompts: 'partial' },
      { tools: 2, resources: 1, prompts: 1 },
    );
    // A failed or paged list is named, so the summary never reads as complete.
    expect(done).toEqual({ status: 'done', detail: '2 tools, 1 resource, 1 prompt (resources list failed; prompts list incomplete)' });
    // An unadvertised capability's failed request is absence, not a failure.
    expect(listStageFromDiscovery(
      { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'failed' },
      { tools: 2, resources: 1, prompts: 0 },
      { prompts: false },
    )).toEqual({ status: 'done', detail: '2 tools, 1 resource, 0 prompts' });
    expect(connectionStages(connected, done)[3]).toMatchObject({ id: 'list', status: 'done' });
    // Before a session exists the list stage cannot have started.
    expect(connectionStages(run({ type: 'start' }), done)[3].status).toBe('pending');
  });

  it('only treats a complete list or an unadvertised capability as settled membership', () => {
    const settled: DiscoveryStatus = { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' };
    expect(listOutcome(settled, 'tools')).toBe('complete');
    expect(listOutcome({ ...settled, tools: 'failed' }, 'tools')).toBe('failed');
    expect(listOutcome({ ...settled, tools: 'partial' }, 'tools')).toBe('partial');
    expect(listOutcome({ ...settled, tools: 'loading' }, 'tools')).toBe('pending');
    expect(listOutcome({ ...settled, resourceTemplates: 'failed' }, 'resources')).toBe('failed');
    expect(listOutcome({ ...settled, prompts: 'failed' }, 'prompts', false)).toBe('not-offered');
    expect(listOutcome(undefined, 'tools')).toBe('complete');
  });

  it('describes the changed stage for assistive technology', () => {
    expect(describeConnectionProgress(connectionStages(run({ type: 'start' }))))
      .toBe('Reach the endpoint: Sending the first request.');
    expect(describeConnectionProgress(connectionStages(run({ type: 'start' }, { type: 'failed' }))))
      .toBe('Reach the endpoint failed: No readable response.');
    const connected = run({ type: 'start' }, { type: 'connected', protocolVersion: '2026-07-28' });
    expect(describeConnectionProgress(connectionStages(connected, { status: 'done' })))
      .toBe('Connected. Tools, resources and prompts are listed.');
  });
});
