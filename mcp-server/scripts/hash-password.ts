import { hashPasswordPbkdf2, PBKDF2_ITERATIONS } from '../../worker/auth';

async function main() {
  const [, , usernameArg, passwordArg, nameArg, roleArg, bapProjectArg] = process.argv;

  if (!usernameArg || !passwordArg) {
    console.error(
      'Kullanım: npx tsx mcp-server/scripts/hash-password.ts <kullanici_adi> <parola> [ad_soyad] [rol] [bap_proje_kodu]',
    );
    process.exit(1);
  }

  const { hashHex, saltHex, iterations } = await hashPasswordPbkdf2(
    passwordArg,
    undefined,
    PBKDF2_ITERATIONS,
  );

  const record = {
    username: usernameArg.trim().toLowerCase(),
    passwordHash: hashHex,
    salt: saltHex,
    iterations,
    name: nameArg ?? usernameArg,
    role: roleArg ?? 'principal_investigator',
    bapProject: bapProjectArg ?? 'BAP-2026-ZEYNEP-01',
  };

  console.log(JSON.stringify(record, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
