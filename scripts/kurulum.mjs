import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

export const PBKDF2_ITERATIONS = 100_000;

export function detectClaudeConfigPath(
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
) {
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  const configRoot = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(configRoot, 'Claude', 'claude_desktop_config.json');
}

export function generateReadablePassword() {
  const partA = crypto.randomBytes(2).toString('hex').toUpperCase();
  const partB = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `Bap-${partA}-${partB}!`;
}

export function createPbkdf2UserRecord({
  username,
  password,
  name,
  role = 'principal_investigator',
  bapProject = 'BAP-2026-01',
  iterations = PBKDF2_ITERATIONS,
}) {
  const cleanUsername = String(username || 'zeynep.hoca').trim().toLowerCase();
  const saltBytes = crypto.randomBytes(16);
  const hashBytes = crypto.pbkdf2Sync(String(password), saltBytes, iterations, 32, 'sha256');
  return {
    username: cleanUsername,
    passwordHash: hashBytes.toString('hex'),
    salt: saltBytes.toString('hex'),
    iterations,
    name: String(name || cleanUsername).trim(),
    role,
    bapProject: String(bapProject || 'BAP-2026-01').trim(),
  };
}

export async function mergeClaudeDesktopConfig(
  configPath,
  serverEntry,
  serverName = 'hypotheca-bap',
) {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  let existing = {};
  let backupPath = null;

  if (fsSync.existsSync(configPath)) {
    const raw = await fs.readFile(configPath, 'utf8');
    backupPath = path.join(dir, 'claude_desktop_config.backup.json');
    await fs.writeFile(backupPath, raw, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed;
      }
    } catch {
      existing = {};
    }
  }

  const currentServers =
    existing.mcpServers && typeof existing.mcpServers === 'object' && !Array.isArray(existing.mcpServers)
      ? existing.mcpServers
      : {};

  const mergedConfig = {
    ...existing,
    mcpServers: {
      ...currentServers,
      [serverName]: serverEntry,
    },
  };

  await fs.writeFile(configPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
  return { configPath, backupPath, mergedConfig };
}

async function copyMissingFilesRecursive(srcDir, destDir) {
  if (!fsSync.existsSync(srcDir)) return [];
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const copied = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await copyMissingFilesRecursive(srcPath, destPath);
      copied.push(...sub);
    } else if (entry.isFile() && !fsSync.existsSync(destPath)) {
      await fs.copyFile(srcPath, destPath);
      copied.push(destPath);
    }
  }
  return copied;
}

export async function ensureResearchDataDirectory(repoRoot, dataDir) {
  await fs.mkdir(path.join(dataDir, 'literatur'), { recursive: true });
  const seedSource = path.join(repoRoot, 'mcp-server', 'data');
  const copiedFiles = await copyMissingFilesRecursive(seedSource, dataDir);

  const readmePath = path.join(dataDir, 'BENI_OKU.txt');
  if (!fsSync.existsSync(readmePath)) {
    const readmeText = [
      'HYPOTHECA BAP ARAŞTIRMA VERİ KLASÖRÜ',
      '===================================',
      '',
      '1. Anket ve araştırma verilerinizi (.csv, .xlsx, .xls, .sqlite, .db)',
      '   doğrudan bu klasörün içine kopyalayın.',
      '',
      '2. Literatür taraması yapacağınız akademik makaleleri (.pdf)',
      '   "literatur" alt klasörüne kopyalayın.',
      '',
      '3. Gizlilik Güvencesi:',
      '   - Bu klasör .gitignore ile korunur; GitHub veya buluta yüklenmez.',
      '   - TC Kimlik, e-posta, telefon ve ad-soyad sütunları MCP tarafından otomatik gizlenir.',
      '',
    ].join('\n');
    await fs.writeFile(readmePath, readmeText, 'utf8');
  }

  return { dataDir, copiedFiles, readmePath };
}

function runNpmCommand(args, cwd) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'npm';
  const finalArgs = isWin ? ['/d', '/s', '/c', 'npm', ...args] : args;
  execFileSync(cmd, finalArgs, { cwd, stdio: 'inherit' });
}

export function parseCliArgs(argv) {
  const opts = {
    auto: false,
    skipBuild: false,
    resetAuth: false,
    claudeConfigPath: undefined,
    dataDir: undefined,
    envFile: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--auto') opts.auto = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--reset-auth') opts.resetAuth = true;
    else if (arg === '--claude-config-path' && argv[i + 1]) opts.claudeConfigPath = argv[++i];
    else if (arg === '--data-dir' && argv[i + 1]) opts.dataDir = argv[++i];
    else if (arg === '--env-file' && argv[i + 1]) opts.envFile = argv[++i];
  }
  return opts;
}

async function promptAcademicProfile(defaultProject) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nLütfen bilgilerinizi girin (varsayılanı kabul etmek için Enter tuşuna basın):');
    const nameIn = (await rl.question('  Ad Soyad ve Unvan [Prof. Dr. Zeynep Kaya]: ')).trim();
    const userIn = (await rl.question('  Kullanıcı Adı [zeynep.hoca]: ')).trim();
    const projIn = (await rl.question(`  BAP Proje Kodu [${defaultProject}]: `)).trim();
    const passIn = (await rl.question('  Giriş Parolası [Enter = otomatik güvenli parola üret]: ')).trim();

    const generatedPassword = !passIn;
    return {
      name: nameIn || 'Prof. Dr. Zeynep Kaya',
      username: (userIn || 'zeynep.hoca').toLowerCase(),
      bapProject: projIn || defaultProject,
      password: passIn || generateReadablePassword(),
      generatedPassword,
    };
  } finally {
    rl.close();
  }
}

export async function runAcademicSetup(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const dataDir = path.resolve(options.dataDir ?? path.join(repoRoot, 'arastirma-verilerim'));
  const envFile = path.resolve(options.envFile ?? path.join(repoRoot, '.dev.vars'));
  const claudeConfigPath = path.resolve(
    options.claudeConfigPath ?? detectClaudeConfigPath(),
  );
  const auto = Boolean(options.auto);
  const skipBuild = Boolean(options.skipBuild);
  const resetAuth = Boolean(options.resetAuth);
  const silent = Boolean(options.silent);
  const log = silent ? () => {} : (...msgs) => console.log(...msgs);

  log('\n==============================================================');
  log('  Hypotheca BAP · Akademisyenler İçin Otomatik Kurulum Sihirbazı');
  log('==============================================================');

  // 1. Bağımlılık kontrolü
  const sdkMarker = path.join(repoRoot, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  if (!skipBuild && !fsSync.existsSync(sdkMarker)) {
    log('\n[1/5] Gerekli kütüphaneler indiriliyor (npm install)...');
    runNpmCommand(['install'], repoRoot);
  } else {
    log('\n[1/5] Kütüphaneler hazır.');
  }

  // 2. Kişisel araştırma verisi klasörü
  log(`[2/5] Araştırma verisi klasörü hazırlanıyor: ${dataDir}`);
  await ensureResearchDataDirectory(repoRoot, dataDir);

  // 3. Yerel kimlik doğrulama ve JWT anahtarı (.dev.vars)
  const defaultProject = options.bapProject ?? 'BAP-2026-01';
  let createdAccount = null;
  let activeProjectCode = defaultProject;

  if (!fsSync.existsSync(envFile) || resetAuth) {
    const canAskInteractive = !auto && !silent && Boolean(process.stdin.isTTY);
    const profile = canAskInteractive
      ? await promptAcademicProfile(defaultProject)
      : {
          name: options.name ?? 'Prof. Dr. Zeynep Kaya',
          username: (options.username ?? 'zeynep.hoca').toLowerCase(),
          bapProject: defaultProject,
          password: options.password ?? generateReadablePassword(),
          generatedPassword: !options.password,
        };

    activeProjectCode = profile.bapProject;
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const userRecord = createPbkdf2UserRecord(profile);
    const safeUsersJson = JSON.stringify([userRecord]).replace(/'/g, '\\u0027');

    const devVarsContent = [
      '# Hypotheca yerel kimlik doğrulama ayarları (otomatik oluşturuldu)',
      `JWT_SECRET="${jwtSecret}"`,
      `AUTH_USERS_JSON='${safeUsersJson}'`,
      '',
    ].join('\n');

    await fs.mkdir(path.dirname(envFile), { recursive: true });
    await fs.writeFile(envFile, devVarsContent, { encoding: 'utf8', mode: 0o600 });
    createdAccount = {
      username: profile.username,
      password: profile.password,
      name: profile.name,
      bapProject: profile.bapProject,
    };
    log(`[3/5] Güvenli oturum anahtarı ve araştırmacı hesabı oluşturuldu: ${envFile}`);
  } else {
    log(`[3/5] Mevcut .dev.vars korundu (üzerine yazılmadı): ${envFile}`);
  }

  // 4. Web arayüzü ve MCP sunucusu derlemesi
  if (!skipBuild) {
    log('[4/5] MCP sunucusu ve web arayüzü derleniyor...');
    runNpmCommand(['run', 'mcp:build'], repoRoot);
    runNpmCommand(['run', 'build'], repoRoot);
  } else {
    log('[4/5] Derleme adımı atlandı (--skip-build).');
  }

  // 5. Claude Desktop ve lokal LLM yapılandırması
  const serverEntry = {
    command: process.execPath,
    args: [path.resolve(repoRoot, 'mcp-server', 'dist', 'index.js')],
    env: {
      HYPOTHECA_DATA_DIR: dataDir,
      HYPOTHECA_PROJECT_NAME: activeProjectCode,
    },
  };

  const claudeResult = await mergeClaudeDesktopConfig(claudeConfigPath, serverEntry, 'hypotheca-bap');
  const generatedCopyPath = path.join(repoRoot, 'mcp-server', 'claude_desktop_config.generated.json');
  await fs.mkdir(path.dirname(generatedCopyPath), { recursive: true });
  await fs.writeFile(
    generatedCopyPath,
    `${JSON.stringify({ mcpServers: { 'hypotheca-bap': serverEntry } }, null, 2)}\n`,
    'utf8',
  );

  log(`[5/5] Claude Desktop yapılandırması güncellendi: ${claudeResult.configPath}`);
  if (claudeResult.backupPath) {
    log(`      Önceki yapılandırma yedeklendi: ${claudeResult.backupPath}`);
  }

  log('\n--------------------------------------------------------------');
  log('  KURULUM BAŞARIYLA TAMAMLANDI');
  log('--------------------------------------------------------------');
  log(`  • Veri Klasörünüz      : ${dataDir}`);
  log(`  • Literatür PDF Yeri   : ${path.join(dataDir, 'literatur')}`);
  log(`  • Claude Desktop Ayarı : ${claudeResult.configPath}`);
  if (createdAccount) {
    log(`  • Kullanıcı Adı        : ${createdAccount.username}`);
    log(`  • Giriş Parolası       : ${createdAccount.password}`);
    log('    (Lütfen bu parolayı güvenli bir yere not edin.)');
  }
  log('\n  Sonraki Adımlar:');
  log('   1) Claude Desktop açık ise kapatıp yeniden açın; Hypotheca araçları otomatik görünür.');
  log('   2) Web arayüzünü açmak için Baslat_Mac_Linux.command / Baslat_Windows.bat dosyasına');
  log('      çift tıklayın (veya "npm run baslat" çalıştırın) -> http://127.0.0.1:8787');
  log('--------------------------------------------------------------\n');

  return {
    repoRoot,
    dataDir,
    envFile,
    claudeConfigPath: claudeResult.configPath,
    backupPath: claudeResult.backupPath,
    generatedCopyPath,
    createdAccount,
    serverEntry,
  };
}

const isCliEntrypoint =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntrypoint) {
  const cliOpts = parseCliArgs(process.argv.slice(2));
  runAcademicSetup(cliOpts).catch((err) => {
    console.error('\n[Hypotheca Kurulum Hatası]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
