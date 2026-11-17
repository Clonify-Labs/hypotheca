import { Dataset } from '../../types/interfaces';

export interface EncryptedExportEnvelope {
  format: 'hypotheca-encrypted-vault-v1';
  alg: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: 120000;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  createdAt: string;
}

const DB_NAME = 'hypotheca_vault_db';
const DB_VERSION = 1;
const STORE_NAME = 'hypotheca_local_vault';
const PBKDF2_ITERATIONS = 120000 as const;

const memoryVaultFallback = new Map<string, Dataset>();

function cloneDataset(ds: Dataset): Dataset {
  if (typeof structuredClone === 'function') {
    return structuredClone(ds);
  }
  return JSON.parse(JSON.stringify(ds)) as Dataset;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB kasası açılamadı.'));
  });
}

async function runIdbTransaction<T>(
  mode: IDBTransactionMode,
  exec: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openVaultDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = exec(store);
    let result: T;

    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB kasa işlemi başarısız.'));
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction başarısız.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction iptal edildi.'));
    };
  });
}

/**
 * Persists a Dataset locally into IndexedDB (`hypotheca_local_vault`),
 * falling back to an isolated in-memory Map when IndexedDB is unavailable (Node/SSR).
 */
export async function saveDatasetToVault(dataset: Dataset): Promise<void> {
  if (!dataset || typeof dataset.id !== 'string' || !dataset.id.trim()) {
    throw new Error('Kasaya kaydetmek için geçerli bir veri seti kimliği (id) gereklidir.');
  }
  const copy = cloneDataset(dataset);

  if (!hasIndexedDb()) {
    memoryVaultFallback.set(copy.id, copy);
    return;
  }

  await runIdbTransaction('readwrite', (store) => store.put(copy));
}

/**
 * Lists all datasets stored in the local browser vault (`hypotheca_local_vault`).
 */
export async function listVaultDatasets(): Promise<Dataset[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryVaultFallback.values()).map(cloneDataset);
  }

  const rows = await runIdbTransaction<Dataset[]>('readonly', (store) =>
    store.getAll() as IDBRequest<Dataset[]>,
  );
  return Array.isArray(rows) ? rows.map(cloneDataset) : [];
}

/**
 * Deletes a dataset by id from the local browser vault.
 */
export async function deleteVaultDataset(id: string): Promise<void> {
  if (!id || typeof id !== 'string') {
    throw new Error('Silinecek veri seti kimliği (id) gereklidir.');
  }

  if (!hasIndexedDb()) {
    memoryVaultFallback.delete(id);
    return;
  }

  await runIdbTransaction('readwrite', (store) => store.delete(id));
}

function getCryptoApi(): Crypto {
  if (
    typeof globalThis.crypto === 'undefined' ||
    typeof globalThis.crypto.subtle === 'undefined' ||
    typeof globalThis.crypto.getRandomValues !== 'function'
  ) {
    throw new Error('Web Crypto API (crypto.subtle) bu çalışma ortamında kullanılamıyor.');
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    const chunkSize = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(''));
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('Base64 kodlayıcı kullanılamıyor.');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  throw new Error('Base64 çözücü kullanılamıyor.');
}

async function deriveAesGcmKey(
  cryptoApi: Crypto,
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    toArrayBuffer(enc.encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

/**
 * Encrypts a Dataset locally using PBKDF2-SHA256 (120,000 iterations) + AES-GCM-256.
 */
export async function encryptDatasetEnvelope(
  dataset: Dataset,
  passphrase: string,
): Promise<EncryptedExportEnvelope> {
  if (!passphrase || passphrase.length < 1) {
    throw new Error('Şifreleme için boş olmayan bir parola (passphrase) girilmelidir.');
  }
  if (!dataset || !Array.isArray(dataset.rows) || !Array.isArray(dataset.columns)) {
    throw new Error('Şifrelenecek geçerli bir Dataset nesnesi sağlanmalıdır.');
  }

  const cryptoApi = getCryptoApi();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  cryptoApi.getRandomValues(salt);
  cryptoApi.getRandomValues(iv);

  const key = await deriveAesGcmKey(cryptoApi, passphrase, salt, PBKDF2_ITERATIONS, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(dataset));
  const cipherBuffer = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    format: 'hypotheca-encrypted-vault-v1',
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(cipherBuffer)),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Decrypts an EncryptedExportEnvelope locally. Rejects cleanly on wrong passphrase or tampered data.
 */
export async function decryptDatasetEnvelope(
  envelope: EncryptedExportEnvelope,
  passphrase: string,
): Promise<Dataset> {
  if (!passphrase || passphrase.length < 1) {
    throw new Error('Şifre çözme için parola (passphrase) girilmelidir.');
  }
  if (
    !envelope ||
    envelope.format !== 'hypotheca-encrypted-vault-v1' ||
    envelope.alg !== 'AES-GCM-256' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    typeof envelope.iterations !== 'number' ||
    envelope.iterations < 1 ||
    typeof envelope.saltB64 !== 'string' ||
    typeof envelope.ivB64 !== 'string' ||
    typeof envelope.ciphertextB64 !== 'string'
  ) {
    throw new Error('Geçersiz şifreli kasa zarfı (hypotheca-encrypted-vault-v1 bekleniyor).');
  }

  const cryptoApi = getCryptoApi();
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64ToBytes(envelope.saltB64);
    iv = base64ToBytes(envelope.ivB64);
    ciphertext = base64ToBytes(envelope.ciphertextB64);
  } catch {
    throw new Error('Şifreli kasa Base64 içeriği çözümlenemedi.');
  }

  const key = await deriveAesGcmKey(cryptoApi, passphrase, salt, envelope.iterations, ['decrypt']);

  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    );
  } catch {
    throw new Error('Şifre çözme başarısız: parola hatalı veya şifreli zarf bozulmuş.');
  }

  let parsed: unknown;
  try {
    const jsonText = new TextDecoder().decode(new Uint8Array(plainBuffer));
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Çözülen kasa içeriği geçerli JSON formatında değil.');
  }

  const ds = parsed as Dataset;
  if (!ds || typeof ds.id !== 'string' || typeof ds.name !== 'string' || !Array.isArray(ds.columns) || !Array.isArray(ds.rows)) {
    throw new Error('Çözülen veri geçerli bir Hypotheca Dataset şemasına uymuyor.');
  }
  return ds;
}
