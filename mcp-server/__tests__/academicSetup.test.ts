import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyUserCredentials } from '../../worker/auth';
import { detectClaudeConfigPath, runAcademicSetup } from '../../scripts/kurulum.mjs';

function parseDevVars(raw: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

describe('Zero-touch academic setup wizard (scripts/kurulum.mjs)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('detects standard Claude Desktop config paths across macOS, Windows and Linux', () => {
    expect(detectClaudeConfigPath('darwin', {}, '/Users/zeynep')).toBe(
      '/Users/zeynep/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(detectClaudeConfigPath('win32', { APPDATA: 'C:\\Users\\Zeynep\\AppData\\Roaming' }, 'C:\\Users\\Zeynep')).toContain(
      'Claude',
    );
    expect(detectClaudeConfigPath('linux', { XDG_CONFIG_HOME: '/home/zeynep/.config' }, '/home/zeynep')).toBe(
      '/home/zeynep/.config/Claude/claude_desktop_config.json',
    );
  });

  it('provisions data folder, PBKDF2 .dev.vars compatible with Worker auth, and backs up/merges Claude config', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hypotheca-kurulum-'));
    tempDirs.push(tmpRoot);

    const dataDir = path.join(tmpRoot, 'arastirma-verilerim');
    const envFile = path.join(tmpRoot, '.dev.vars');
    const claudeConfigPath = path.join(tmpRoot, 'Claude', 'claude_desktop_config.json');

    await fs.mkdir(path.dirname(claudeConfigPath), { recursive: true });
    await fs.writeFile(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          'existing-tool': { command: 'python3', args: ['other.py'] },
        },
      }),
      'utf8',
    );

    const result = await runAcademicSetup({
      repoRoot: process.cwd(),
      dataDir,
      envFile,
      claudeConfigPath,
      auto: true,
      skipBuild: true,
      silent: true,
      name: "Prof. Dr. Zeynep O'Connor",
      username: 'zeynep.hoca',
      bapProject: 'BAP-2026-AUTO',
    });

    // 1. Research directory and sample files exist
    expect(fsSync.existsSync(path.join(dataDir, 'BENI_OKU.txt'))).toBe(true);
    expect(fsSync.existsSync(path.join(dataDir, 'bap_ogrenci_anket_2026.csv'))).toBe(true);
    expect(fsSync.existsSync(path.join(dataDir, 'literatur', 'bap_dijital_tukenmislik_2026.pdf'))).toBe(true);

    // 2. .dev.vars authenticates cleanly with worker/auth.ts verifyUserCredentials
    const rawVars = await fs.readFile(envFile, 'utf8');
    const parsed = parseDevVars(rawVars);
    expect(parsed.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(result.createdAccount?.password).toBeTruthy();

    const verifiedUser = await verifyUserCredentials(
      {
        ASSETS: { fetch: async () => new Response() },
        JWT_SECRET: parsed.JWT_SECRET,
        AUTH_USERS_JSON: parsed.AUTH_USERS_JSON,
      },
      'zeynep.hoca',
      result.createdAccount!.password,
    );
    expect(verifiedUser).not.toBeNull();
    expect(verifiedUser?.bapProject).toBe('BAP-2026-AUTO');

    // 3. Existing Claude config was backed up and non-destructively merged
    const backupPath = path.join(path.dirname(claudeConfigPath), 'claude_desktop_config.backup.json');
    expect(fsSync.existsSync(backupPath)).toBe(true);
    const merged = JSON.parse(await fs.readFile(claudeConfigPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    expect(merged.mcpServers['existing-tool']).toEqual({ command: 'python3', args: ['other.py'] });
    expect(merged.mcpServers['hypotheca-bap'].command).toBe(process.execPath);
    expect(merged.mcpServers['hypotheca-bap'].env?.HYPOTHECA_DATA_DIR).toBe(dataDir);
  });
});
