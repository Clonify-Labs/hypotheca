import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeedDatasets } from '../../../data/seedDatasets';
import {
  decryptDatasetEnvelope,
  deleteVaultDataset,
  encryptDatasetEnvelope,
  listVaultDatasets,
  saveDatasetToVault,
} from '../localVault';
import {
  ONPREM_COMPOSE_YML,
  ONPREM_DOCKERFILE,
  ONPREM_NGINX_CONF,
} from '../onprem/onpremConfigs';
import {
  executeInPrivacyWorker,
  getRuntimePrivacyAudit,
} from '../statsWorkerClient';

const seedDatasets = buildSeedDatasets();
const dsOgrenci = seedDatasets[0];

describe('Module 5: Privacy Runtime, Web Worker & Local Vault', () => {
  it('1. executeInPrivacyWorker runs descriptives on buildSeedDatasets()[0] via fallback in Node', async () => {
    const res = await executeInPrivacyWorker('descriptives', {
      dataset: dsOgrenci,
      variables: ['OY_Ort', 'YZ_Ort', 'Basari_Son'],
    });

    expect(res.runtimeMode).toBe('direct_sync_fallback');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(res.output.analysisType).toBe('descriptive_table');
    expect(res.output.tables.length).toBeGreaterThan(0);
    expect(res.output.tables[0].rows).toHaveLength(3);
    expect(res.output.tables[0].rows[0].n).toBe(180);
  });

  it('2. executeInPrivacyWorker runs independent_t on buildSeedDatasets()[0]', async () => {
    const res = await executeInPrivacyWorker('independent_t', {
      dataset: dsOgrenci,
      dependent: 'Basari_Son',
      groupVar: 'Cinsiyet',
    });

    expect(res.runtimeMode).toBe('direct_sync_fallback');
    expect(res.output.analysisType).toBe('independent_t');
    expect(res.output.tables.length).toBeGreaterThanOrEqual(2);
    expect(res.output.assumptions?.length).toBeGreaterThan(0);
  });

  it('3. executeInPrivacyWorker handles additional engine ops and rejects unknown ops', async () => {
    const power = await executeInPrivacyWorker('power_analysis', {
      testType: 'indep_t',
      mode: 'apriori',
      effectSize: 0.5,
      alpha: 0.05,
      power: 0.8,
      tails: 2,
    });
    expect(power.output.analysisType).toBe('power_analysis');
    expect(power.output.summary.requiredN).toBe(128);

    await expect(
      executeInPrivacyWorker('non_existent_op', { dataset: dsOgrenci }),
    ).rejects.toThrow();
  });

  it('4. saveDatasetToVault, listVaultDatasets, deleteVaultDataset round-trip', async () => {
    const secondDs = {
      ...dsOgrenci,
      id: 'ds-vault-copy-test',
      name: 'Vault_Copy_Test.csv',
    };

    await saveDatasetToVault(dsOgrenci);
    await saveDatasetToVault(secondDs);

    const listed = await listVaultDatasets();
    const ids = listed.map((d) => d.id);
    expect(ids).toContain(dsOgrenci.id);
    expect(ids).toContain(secondDs.id);

    const restoredFirst = listed.find((d) => d.id === dsOgrenci.id)!;
    expect(restoredFirst.rows).toHaveLength(180);
    expect(restoredFirst.name).toBe(dsOgrenci.name);

    await deleteVaultDataset(dsOgrenci.id);
    const afterFirstDelete = await listVaultDatasets();
    expect(afterFirstDelete.some((d) => d.id === dsOgrenci.id)).toBe(false);
    expect(afterFirstDelete.some((d) => d.id === secondDs.id)).toBe(true);

    await deleteVaultDataset(secondDs.id);
    const afterCleanup = await listVaultDatasets();
    expect(afterCleanup.some((d) => d.id === secondDs.id)).toBe(false);
  });

  it('5. encryptDatasetEnvelope -> decryptDatasetEnvelope restores exact 180 rows and rejects wrong passphrase', async () => {
    const passphrase = 'Hypotheca#2026!AcademicVault';
    const envelope = await encryptDatasetEnvelope(dsOgrenci, passphrase);

    expect(envelope.format).toBe('hypotheca-encrypted-vault-v1');
    expect(envelope.alg).toBe('AES-GCM-256');
    expect(envelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelope.iterations).toBe(120000);
    expect(envelope.saltB64.length).toBeGreaterThan(10);
    expect(envelope.ivB64.length).toBeGreaterThan(10);
    expect(envelope.ciphertextB64.length).toBeGreaterThan(100);

    const decrypted = await decryptDatasetEnvelope(envelope, passphrase);
    expect(decrypted.id).toBe(dsOgrenci.id);
    expect(decrypted.name).toBe(dsOgrenci.name);
    expect(decrypted.rows).toHaveLength(180);
    expect(decrypted.rows).toEqual(dsOgrenci.rows);

    await expect(
      decryptDatasetEnvelope(envelope, 'WrongPassphrase!123'),
    ).rejects.toThrow();

    await expect(
      decryptDatasetEnvelope(
        { ...envelope, ciphertextB64: `${envelope.ciphertextB64.slice(0, -4)}AAAA` },
        passphrase,
      ),
    ).rejects.toThrow();
  });

  it('6. getRuntimePrivacyAudit returns verified zero-egress & KVKK/GDPR flags', () => {
    const report = getRuntimePrivacyAudit();

    expect(report.zeroNetworkEgress).toBe(true);
    expect(report.zeroLlmCalls).toBe(true);
    expect(report.webCryptoAvailable).toBe(true);
    expect(typeof report.webWorkerAvailable).toBe('boolean');
    expect(typeof report.indexedDbAvailable).toBe('boolean');
    expect(report.complianceChecklist.length).toBeGreaterThanOrEqual(5);

    for (const item of report.complianceChecklist) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.labelTr.length).toBeGreaterThan(0);
      expect(item.labelEn.length).toBeGreaterThan(0);
      expect(['verified', 'active']).toContain(item.status);
    }
  });

  it('7. On-premise air-gapped Docker & Nginx CSP artifacts exist and match preview templates', () => {
    const onpremDir = path.resolve(__dirname, '../onprem');
    const dockerfile = fs.readFileSync(path.join(onpremDir, 'Dockerfile'), 'utf8').trim();
    const nginxConf = fs.readFileSync(path.join(onpremDir, 'nginx.conf'), 'utf8').trim();
    const composeYml = fs.readFileSync(path.join(onpremDir, 'docker-compose.yml'), 'utf8').trim();

    expect(dockerfile).toBe(ONPREM_DOCKERFILE.trim());
    expect(nginxConf).toBe(ONPREM_NGINX_CONF.trim());
    expect(composeYml).toBe(ONPREM_COMPOSE_YML.trim());
    expect(nginxConf).toContain("default-src 'self'");
    expect(nginxConf).toContain("connect-src 'self'");
  });
});
