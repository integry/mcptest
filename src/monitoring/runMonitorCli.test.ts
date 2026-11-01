import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMonitorCli } from './runMonitorCli';

describe('runMonitorCli exit codes', () => {
  it('uses the configuration exit code for invalid CLI configuration', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runMonitorCli([])).toBe(3);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--config is required'));
    } finally {
      stderr.mockRestore();
    }
  });

  it('uses the checker infrastructure exit code for redacted persistence failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcptest-monitor-cli-'));
    const secret = 'elm-cobalt-73-secret';
    const blockedParent = join(directory, `access_token=${secret}`);
    const configPath = join(directory, 'monitor.json');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await writeFile(blockedParent, 'not a directory', 'utf8');
      await writeFile(configPath, JSON.stringify({
        targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
        stateFile: join(blockedParent, 'state.json'),
      }), 'utf8');

      expect(await runMonitorCli(['--config', configPath], {})).toBe(4);
      const diagnostic = stderr.mock.calls.map(([message]) => String(message)).join('');
      expect(diagnostic).toContain('mcptest monitor:');
      expect(diagnostic).toContain('[REDACTED]');
      expect(diagnostic).not.toContain(secret);
    } finally {
      stderr.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
