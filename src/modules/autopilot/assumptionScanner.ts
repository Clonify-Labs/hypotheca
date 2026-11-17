import { Dataset } from '../../types/interfaces';
import { shapiroWilk, tCdf } from '../../engine/core/distributions';
import { mean, quantile, spssMoments, stdDev, variance } from '../../engine/core/linalg';
import { extractNum, fmtNum, rNum } from '../../engine/classical';

export interface VariableScan {
  variable: string;
  n: number;
  missing: number;
  mean: number | null;
  std: number | null;
  shapiroW: number | null;
  shapiroP: number | null;
  skewness: number | null;
  kurtosis: number | null;
  normalityOk: boolean;
  iqrOutlierCount: number;
  zOutlierCount: number;
}

export interface AssumptionScanReport {
  datasetName: string;
  totalRows: number;
  missingPattern: {
    totalMissing: number;
    listwiseComplete: number;
    littleMcarNote: string;
  };
  variables: VariableScan[];
  recommendedImputation: 'none' | 'listwise' | 'median_or_pmm';
}

function parseCellNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const v = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function resolveTargetVariables(dataset: Dataset, variables?: string[]): string[] {
  if (variables && variables.length > 0) return variables;
  const numericCols = dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name);
  if (numericCols.length > 0) return numericCols;
  if (dataset.rows.length === 0) return [];
  return Object.keys(dataset.rows[0]).filter((key) => extractNum(dataset.rows, key).length > 0);
}

function testMissingMechanism(
  dataset: Dataset,
  targetCols: string[],
): { mcarCompatible: boolean; note: string } {
  const totalRows = dataset.rows.length;
  const colsWithMissing = targetCols.filter((col) => {
    let miss = 0;
    for (const row of dataset.rows) {
      if (parseCellNumber(row[col]) === null) miss++;
    }
    return miss > 0 && miss < totalRows;
  });

  if (colsWithMissing.length === 0) {
    return {
      mcarCompatible: true,
      note: 'Kayıp veri bulunmamaktadır (%100 tam gözlem / Complete dataset, 0 missing).',
    };
  }

  let lowestP = 1;
  let flaggedVar = '';
  let flaggedPredictor = '';

  for (const missCol of colsWithMissing) {
    const missFlags = dataset.rows.map((r) => parseCellNumber(r[missCol]) === null);
    const missCount = missFlags.filter(Boolean).length;
    if (missCount < 2 || totalRows - missCount < 2) continue;

    for (const otherCol of targetCols) {
      if (otherCol === missCol) continue;
      const gMiss: number[] = [];
      const gObs: number[] = [];
      for (let i = 0; i < totalRows; i++) {
        const val = parseCellNumber(dataset.rows[i][otherCol]);
        if (val === null) continue;
        if (missFlags[i]) gMiss.push(val);
        else gObs.push(val);
      }
      if (gMiss.length < 2 || gObs.length < 2) continue;

      const v1 = variance(gMiss, 1);
      const v2 = variance(gObs, 1);
      const se = Math.sqrt(v1 / gMiss.length + v2 / gObs.length);
      if (se <= 1e-12) continue;

      const tStat = Math.abs(mean(gMiss) - mean(gObs)) / se;
      const num = Math.pow(v1 / gMiss.length + v2 / gObs.length, 2);
      const den =
        Math.pow(v1 / gMiss.length, 2) / (gMiss.length - 1) +
        Math.pow(v2 / gObs.length, 2) / (gObs.length - 1);
      const df = den > 0 ? num / den : gMiss.length + gObs.length - 2;
      const pVal = 2 * (1 - tCdf(tStat, Math.max(1, df)));

      if (pVal < lowestP) {
        lowestP = pVal;
        flaggedVar = missCol;
        flaggedPredictor = otherCol;
      }
    }
  }

  if (lowestP < 0.05 && flaggedVar) {
    return {
      mcarCompatible: false,
      note: `Kayıplık örüntüsü ${flaggedVar} değişkeninde ${flaggedPredictor} ile ilişkili bulundu (Welch p = ${fmtNum(lowestP, 4)}); MCAR varsayımı şüpheli, MAR olasılığı nedeniyle medyan/PMM imputasyonu önerilir.`,
    };
  }

  return {
    mcarCompatible: true,
    note: `Kayıp değerler gözlenen değişkenlerle sistematik ilişki göstermedi (min p = ${fmtNum(lowestP, 3)} ≥ .05); MCAR ile uyumlu örüntü.`,
  };
}

/**
 * Deterministically scans numeric dataset columns for sample size, missingness,
 * Shapiro-Wilk normality, SPSS skewness/kurtosis moments, and IQR / |Z| > 3.29 outliers.
 */
export function scanDatasetAssumptions(dataset: Dataset, variables?: string[]): AssumptionScanReport {
  const totalRows = dataset.rows.length;
  const cols = resolveTargetVariables(dataset, variables);

  const scannedVars: VariableScan[] = cols.map((col) => {
    const arr = extractNum(dataset.rows, col);
    const n = arr.length;
    const missing = totalRows - n;

    if (n === 0) {
      return {
        variable: col,
        n: 0,
        missing,
        mean: null,
        std: null,
        shapiroW: null,
        shapiroP: null,
        skewness: null,
        kurtosis: null,
        normalityOk: false,
        iqrOutlierCount: 0,
        zOutlierCount: 0,
      };
    }

    const m = mean(arr);
    const sd = n >= 2 ? stdDev(arr, 1) : null;
    const sw = n >= 3 ? shapiroWilk(arr) : null;
    const mom = spssMoments(arr);

    const normalityOk =
      n >= 3 &&
      sw !== null &&
      (sw.p >= 0.05 ||
        (n >= 30 && Math.abs(mom.skewness ?? 0) <= 1.5 && Math.abs(mom.kurtosis ?? 0) <= 1.5));

    let iqrOutlierCount = 0;
    let zOutlierCount = 0;
    if (n >= 4) {
      const sorted = [...arr].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr;
      const hi = q3 + 1.5 * iqr;
      const sdSafe = sd ?? 0;

      for (const v of arr) {
        if (v < lo || v > hi) iqrOutlierCount++;
        if (sdSafe > 0 && Math.abs((v - m) / sdSafe) > 3.29) zOutlierCount++;
      }
    }

    return {
      variable: col,
      n,
      missing,
      mean: rNum(m, 4),
      std: sd !== null ? rNum(sd, 4) : null,
      shapiroW: sw !== null ? rNum(sw.w, 4) : null,
      shapiroP: sw !== null ? rNum(sw.p, 6) : null,
      skewness: mom.skewness !== null ? rNum(mom.skewness, 4) : null,
      kurtosis: mom.kurtosis !== null ? rNum(mom.kurtosis, 4) : null,
      normalityOk,
      iqrOutlierCount,
      zOutlierCount,
    };
  });

  const totalMissing = scannedVars.reduce((acc, v) => acc + v.missing, 0);

  let listwiseComplete = 0;
  if (cols.length > 0) {
    for (const row of dataset.rows) {
      let complete = true;
      for (const col of cols) {
        if (parseCellNumber(row[col]) === null) {
          complete = false;
          break;
        }
      }
      if (complete) listwiseComplete++;
    }
  } else {
    listwiseComplete = totalRows;
  }

  const missingMechanism = testMissingMechanism(dataset, cols);
  const missingCaseRatio = totalRows > 0 ? (totalRows - listwiseComplete) / totalRows : 0;
  const maxVarMissingRatio =
    totalRows > 0 && scannedVars.length > 0
      ? Math.max(...scannedVars.map((v) => v.missing / totalRows))
      : 0;

  let recommendedImputation: 'none' | 'listwise' | 'median_or_pmm';
  if (totalMissing === 0) {
    recommendedImputation = 'none';
  } else if (missingCaseRatio <= 0.05 && maxVarMissingRatio <= 0.05 && missingMechanism.mcarCompatible) {
    recommendedImputation = 'listwise';
  } else {
    recommendedImputation = 'median_or_pmm';
  }

  return {
    datasetName: dataset.name,
    totalRows,
    missingPattern: {
      totalMissing,
      listwiseComplete,
      littleMcarNote: missingMechanism.note,
    },
    variables: scannedVars,
    recommendedImputation,
  };
}
