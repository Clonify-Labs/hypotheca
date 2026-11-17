import { AnalysisOutput, Dataset } from '../../types/interfaces';
import { chi2Cdf, kolmogorovSmirnovNormal, normalPdf, shapiroWilk, tCdf } from '../core/distributions';
import { invMatrix, mean, olsFit, pinvSymmetric, quantile, rankArray, spssMoments, stdDev, variance } from '../core/linalg';
import { StatInputError, assertMinN, clampP, isConstant } from '../core/errors';
import { buildOutput, extractNum, extractNumMatrix, pearsonPair, rNum, sigStars, fmtNum } from './helpers';

export function runDescriptives(dataset: Dataset, variables: string[]): AnalysisOutput {
  const cols = variables.length ? variables : dataset.columns.filter((c) => c.valueType === 'numeric').map((c) => c.name);
  const rows: Record<string, string | number | null>[] = [];
  const barLabels: string[] = [];
  const barMeans: (number | null)[] = [];
  const barSds: (number | null)[] = [];
  const skipped: string[] = [];

  if (cols.length === 0) {
    throw new StatInputError('NO_VARIABLES', 'Tanımlayıcı istatistikler için en az bir sayısal değişken seçilmelidir.', 'Select at least one numeric variable for descriptive statistics.');
  }

  for (const col of cols) {
    const arr = extractNum(dataset.rows, col);
    const n = arr.length;
    if (n === 0) {
      skipped.push(col);
      continue;
    }
    const missing = dataset.rows.length - n;
    const sorted = [...arr].sort((a, b) => a - b);
    const m = mean(arr);
    const sd = n > 1 ? stdDev(arr, 1) : 0;
    const vr = n > 1 ? variance(arr, 1) : 0;
    const se = sd / Math.sqrt(n);
    const mom = spssMoments(arr);
    const q1 = quantile(sorted, 0.25);
    const med = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);

    rows.push({
      variable: col,
      n,
      missing,
      mean: rNum(m, 3),
      std_error: rNum(se, 3),
      median: rNum(med, 3),
      std: rNum(sd, 3),
      variance: rNum(vr, 3),
      min: rNum(sorted[0], 3),
      max: rNum(sorted[n - 1], 3),
      range: rNum(sorted[n - 1] - sorted[0], 3),
      q1: rNum(q1, 3),
      q3: rNum(q3, 3),
      skewness: rNum(mom.skewness, 3),
      kurtosis: rNum(mom.kurtosis, 3),
    });
    barLabels.push(col);
    barMeans.push(rNum(m, 3));
    barSds.push(rNum(sd, 3));
  }

  if (rows.length === 0) {
    throw new StatInputError(
      'ALL_MISSING',
      `Seçilen değişkenlerde geçerli sayısal değer yok (tümü eksik veya sayısal olmayan): ${skipped.join(', ')}.`,
      `The selected variables contain no valid numeric values (all missing or non-numeric): ${skipped.join(', ')}.`,
    );
  }

  const descOut = buildOutput(
    'descriptive_table',
    'Tanımlayıcı İstatistikler',
    { variables: cols },
    { count: rows.length },
    [
      {
        id: 'descriptives',
        title: 'Tanımlayıcı İstatistikler (SPSS ddof=1)',
        columns: [
          { key: 'variable', label: 'Değişken' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'missing', label: 'Kayıp', numeric: true },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std_error', label: 'Ort. SH', numeric: true },
          { key: 'median', label: 'Medyan', numeric: true },
          { key: 'std', label: 'Std. Sapma', numeric: true },
          { key: 'variance', label: 'Varyans', numeric: true },
          { key: 'min', label: 'Min', numeric: true },
          { key: 'max', label: 'Max', numeric: true },
          { key: 'q1', label: 'Q1', numeric: true },
          { key: 'q3', label: 'Q3', numeric: true },
          { key: 'skewness', label: 'Çarpıklık', numeric: true },
          { key: 'kurtosis', label: 'Basıklık', numeric: true },
        ],
        rows,
      },
    ],
    [
      {
        id: 'desc_bar',
        title: 'Değişken Ortalamaları ve Standart Sapma',
        type: 'bar',
        option: {
          tooltip: { trigger: 'axis' },
          legend: { data: ['Ortalama', 'Std. Sapma'], bottom: 0 },
          xAxis: { type: 'category', data: barLabels },
          yAxis: { type: 'value' },
          series: [
            { name: 'Ortalama', type: 'bar', data: barMeans },
            { name: 'Std. Sapma', type: 'bar', data: barSds },
          ],
        },
      },
    ],
    `Seçilen ${rows.length} değişken için SPSS uyumlu (ddof=1) tanımlayıcı istatistikler hesaplandı.`,
    `Computed SPSS-compatible (ddof=1) descriptive statistics for ${rows.length} variable(s).`,
  );
  if (skipped.length) {
    descOut.tables[0].footnotes = [`Geçerli sayısal değeri olmadığı için atlanan değişkenler: ${skipped.join(', ')}.`];
  }
  return descOut;
}

export function runFrequencies(dataset: Dataset, variables: string[]): AnalysisOutput {
  const tables = variables.map((col) => {
    const totalN = dataset.rows.length;
    const counts = new Map<string, number>();
    let validN = 0;
    for (const r of dataset.rows) {
      const v = r[col];
      if (v === null || v === undefined || v === '') continue;
      validN++;
      const k = String(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let cum = 0;
    const rows: Record<string, string | number | null>[] = [];
    for (const [val, cnt] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
      const pct = (cnt / Math.max(1, totalN)) * 100;
      const vpct = (cnt / Math.max(1, validN)) * 100;
      cum += vpct;
      rows.push({
        value: val,
        frequency: cnt,
        percentage: rNum(pct, 2),
        valid_percentage: rNum(vpct, 2),
        cumulative_percentage: rNum(Math.min(100, cum), 2),
      });
    }
    if (totalN > validN) {
      rows.push({
        value: 'Kayıp Değer',
        frequency: totalN - validN,
        percentage: rNum(((totalN - validN) / totalN) * 100, 2),
        valid_percentage: null,
        cumulative_percentage: null,
      });
    }
    return {
      id: `freq_${col}`,
      title: `Frekans Tablosu: ${col}`,
      columns: [
        { key: 'value', label: 'Kategori / Değer' },
        { key: 'frequency', label: 'Frekans (n)', numeric: true },
        { key: 'percentage', label: 'Yüzde (%)', numeric: true },
        { key: 'valid_percentage', label: 'Geçerli (%)', numeric: true },
        { key: 'cumulative_percentage', label: 'Kümülatif (%)', numeric: true },
      ],
      rows,
    };
  });
  return buildOutput('frequency_table', 'Frekans Dağılımları', { variables }, { variables: tables.length }, tables);
}

export function runNormality(dataset: Dataset, variables: string[]): AnalysisOutput {
  const normRows: Record<string, string | number | null>[] = [];
  const skRows: Record<string, string | number | null>[] = [];
  const charts = [];
  const notes: string[] = [];

  for (const col of variables) {
    const arr = extractNum(dataset.rows, col);
    if (arr.length < 3) {
      notes.push(`${col}: geçerli gözlem sayısı (${arr.length}) 3'ten az olduğundan normallik sınanamadı.`);
      continue;
    }
    if (isConstant(arr)) {
      notes.push(`${col}: tüm değerler aynı (varyans sıfır); normallik sınanamadı.`);
      continue;
    }
    const sw = shapiroWilk(arr);
    if (!sw.valid && sw.reason === 'n_above_5000') {
      notes.push(`${col}: n > 5000 olduğundan Shapiro-Wilk raporlanmadı; K-S ve çarpıklık/basıklık değerlerine bakınız.`);
    }
    const ks = kolmogorovSmirnovNormal(arr);
    const mom = spssMoments(arr);
    const swOk = sw.valid && sw.p >= 0.05;
    const normalOk = swOk || (Math.abs(mom.skewness || 0) <= 1.5 && Math.abs(mom.kurtosis || 0) <= 1.5);

    normRows.push({
      variable: col,
      n: arr.length,
      ks_stat: rNum(ks.d, 4),
      ks_p: rNum(ks.p, 4),
      sw_stat: rNum(sw.w, 4),
      sw_p: rNum(sw.p, 4),
      status: !sw.valid ? 'S-W uygulanamadı' : sw.p >= 0.05 ? 'Normal (p ≥ .05)' : 'Normal Dışı (p < .05)',
    });
    skRows.push({
      variable: col,
      n: arr.length,
      mean: rNum(mean(arr), 3),
      std: rNum(stdDev(arr, 1), 3),
      skewness: rNum(mom.skewness, 3),
      skewness_se: rNum(mom.skewnessSE, 3),
      kurtosis: rNum(mom.kurtosis, 3),
      kurtosis_se: rNum(mom.kurtosisSE, 3),
      sk_ok: normalOk ? 'Normal Varsayımı Uygun (±1.5)' : 'Çarpık / Basık',
    });

    if (charts.length < 2) {
      const sorted = [...arr].sort((a, b) => a - b);
      const minV = sorted[0];
      const maxV = sorted[sorted.length - 1];
      const bins = Math.min(15, Math.max(6, Math.round(Math.sqrt(arr.length))));
      const width = (maxV - minV || 1) / bins;
      const counts = new Array<number>(bins).fill(0);
      for (const v of arr) {
        const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - minV) / width)));
        counts[idx]++;
      }
      const m = mean(arr);
      const sd = stdDev(arr, 1) || 1;
      const labels = Array.from({ length: bins }, (_, i) => (minV + (i + 0.5) * width).toFixed(2));
      const curve = labels.map((lbl) => rNum(arr.length * width * (normalPdf((Number(lbl) - m) / sd) / sd), 2));
      charts.push({
        id: `norm_hist_${col}`,
        title: `${col}: Histogram ve Normal Dağılım Eğrisi`,
        type: 'bar' as const,
        option: {
          tooltip: { trigger: 'axis' },
          legend: { data: ['Gözlenen', 'Normal Eğri'], bottom: 0 },
          xAxis: { type: 'category', data: labels },
          yAxis: { type: 'value', name: 'Frekans' },
          series: [
            { name: 'Gözlenen', type: 'bar', data: counts },
            { name: 'Normal Eğri', type: 'line', smooth: true, data: curve },
          ],
        },
      });
    }
  }

  if (normRows.length === 0) {
    throw new StatInputError(
      'INSUFFICIENT_N',
      `Normallik testi için geçerli değişken yok. ${notes.join(' ')}`.trim(),
      'No variable has enough valid, non-constant observations (n >= 3) for normality testing.',
    );
  }

  const normOut = buildOutput(
    'normality_test',
    'Normallik Testleri (Shapiro-Wilk, K-S & Çarpıklık/Basıklık)',
    { variables },
    { variablesAnalyzed: normRows.length },
    [
      {
        id: 'normality_tests',
        title: 'Normallik Testleri (Royston AS R94 Shapiro-Wilk & K-S)',
        columns: [
          { key: 'variable', label: 'Değişken' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'ks_stat', label: 'K-S İstatistiği', numeric: true },
          { key: 'ks_p', label: 'K-S p', numeric: true },
          { key: 'sw_stat', label: 'Shapiro-Wilk W', numeric: true },
          { key: 'sw_p', label: 'S-W p', numeric: true },
          { key: 'status', label: 'Değerlendirme' },
        ],
        rows: normRows,
        footnotes: notes.length ? notes : undefined,
      },
      {
        id: 'skewness_kurtosis',
        title: 'Çarpıklık ve Basıklık İstatistikleri',
        columns: [
          { key: 'variable', label: 'Değişken' },
          { key: 'mean', label: 'Ortalama', numeric: true },
          { key: 'std', label: 'SS', numeric: true },
          { key: 'skewness', label: 'Çarpıklık', numeric: true },
          { key: 'skewness_se', label: 'Ç. SH', numeric: true },
          { key: 'kurtosis', label: 'Basıklık', numeric: true },
          { key: 'kurtosis_se', label: 'B. SH', numeric: true },
          { key: 'sk_ok', label: 'Karar' },
        ],
        rows: skRows,
      },
    ],
    charts,
  );
  return normOut;
}

export function runOutliers(dataset: Dataset, variables: string[]): AnalysisOutput {
  const summaryRows: Record<string, string | number | null>[] = [];
  const caseRows: Record<string, string | number | null>[] = [];
  const boxData: (number | null)[][] = [];
  const boxLabels: string[] = [];

  for (const col of variables) {
    const pairs: { idx: number; val: number }[] = [];
    dataset.rows.forEach((r, idx) => {
      const v = Number(String(r[col] ?? '').replace(',', '.'));
      if (r[col] !== null && r[col] !== undefined && r[col] !== '' && Number.isFinite(v)) pairs.push({ idx, val: v });
    });
    if (pairs.length < 4) continue;
    const arr = pairs.map((p) => p.val);
    const sorted = [...arr].sort((a, b) => a - b);
    const m = mean(arr);
    const sd = stdDev(arr, 1) || 1;
    const q1 = quantile(sorted, 0.25);
    const med = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;

    let zOut = 0;
    let iqrOut = 0;
    for (const p of pairs) {
      const z = (p.val - m) / sd;
      const isZ = Math.abs(z) > 3.29;
      const isIqr = p.val < lo || p.val > hi;
      if (isZ) zOut++;
      if (isIqr) iqrOut++;
      if (isZ || isIqr) {
        caseRows.push({
          row: p.idx + 1,
          variable: col,
          value: rNum(p.val, 3),
          z_score: rNum(z, 3),
          rule: isZ ? '|Z| > 3.29' : '1.5×IQR Dışı',
        });
      }
    }
    summaryRows.push({
      variable: col,
      n: arr.length,
      q1: rNum(q1, 3),
      median: rNum(med, 3),
      q3: rNum(q3, 3),
      iqr: rNum(iqr, 3),
      iqr_outliers: iqrOut,
      z_outliers: zOut,
    });
    boxLabels.push(col);
    boxData.push([rNum(sorted[0], 3), rNum(q1, 3), rNum(med, 3), rNum(q3, 3), rNum(sorted[sorted.length - 1], 3)]);
  }

  return buildOutput(
    'outlier_analysis',
    'Aykırı Uç Değer Analizi (IQR & Z-Skoru)',
    { variables },
    { flagged: caseRows.length },
    [
      {
        id: 'outlier_summary',
        title: 'Aykırı Değer Özeti',
        columns: [
          { key: 'variable', label: 'Değişken' },
          { key: 'n', label: 'N', numeric: true },
          { key: 'q1', label: 'Q1', numeric: true },
          { key: 'median', label: 'Medyan', numeric: true },
          { key: 'q3', label: 'Q3', numeric: true },
          { key: 'iqr', label: 'IQR', numeric: true },
          { key: 'iqr_outliers', label: 'IQR Aykırı (n)', numeric: true },
          { key: 'z_outliers', label: '|Z|>3.29 (n)', numeric: true },
        ],
        rows: summaryRows,
      },
      {
        id: 'outlier_cases',
        title: 'İşaretlenen Gözlemler (İlk 50)',
        columns: [
          { key: 'row', label: 'Satır', numeric: true },
          { key: 'variable', label: 'Değişken' },
          { key: 'value', label: 'Değer', numeric: true },
          { key: 'z_score', label: 'Z Skoru', numeric: true },
          { key: 'rule', label: 'Ölçüt' },
        ],
        rows: caseRows.slice(0, 50),
      },
    ],
    [
      {
        id: 'outlier_box',
        title: 'Kutu Grafiği (Min - Q1 - Medyan - Q3 - Max)',
        type: 'boxplot',
        option: {
          tooltip: { trigger: 'item' },
          xAxis: { type: 'category', data: boxLabels },
          yAxis: { type: 'value' },
          series: [{ name: 'Dağılım', type: 'boxplot', data: boxData }],
        },
      },
    ],
  );
}

export function runCorrelation(
  dataset: Dataset,
  variables: string[],
  method: 'pearson' | 'spearman' = 'pearson',
): AnalysisOutput {
  if (variables.length < 2 || new Set(variables).size < 2) {
    throw new StatInputError('NO_VARIABLES', 'Korelasyon için en az 2 farklı değişken seçilmelidir.', 'Select at least 2 different variables for correlation.');
  }
  const k = variables.length;
  for (const v of variables) {
    const arr = extractNum(dataset.rows, v);
    if (arr.length === 0) {
      throw new StatInputError('ALL_MISSING', `"${v}" değişkeninde geçerli sayısal değer yok.`, `"${v}" has no valid numeric values.`);
    }
  }
  if (variables.length === 2) {
    assertMinN(extractNumMatrix(dataset.rows, variables).length, 3, 'Korelasyon (tam çift)', 'Correlation (complete pairs)');
  }
  const corrNotes: string[] = [];
  const matRows: Record<string, string | number | null>[] = [];
  const pairRows: Record<string, string | number | null>[] = [];
  const heatData: [number, number, number | null][] = [];

  for (let i = 0; i < k; i++) {
    const rowObj: Record<string, string | number | null> = { variable: variables[i] };
    for (let j = 0; j < k; j++) {
      if (i === j) {
        rowObj[variables[j]] = '1.000';
        heatData.push([j, i, 1]);
        continue;
      }
      const paired = extractNumMatrix(dataset.rows, [variables[i], variables[j]]);
      const n = paired.length;
      if (n < 3) {
        rowObj[variables[j]] = '-';
        heatData.push([j, i, null]);
        if (j > i) corrNotes.push(`${variables[i]} - ${variables[j]}: tam çift sayısı (${n}) 3'ten az; korelasyon hesaplanmadı.`);
        continue;
      }
      let xs = paired.map((r) => r[0]);
      let ys = paired.map((r) => r[1]);
      if (isConstant(xs) || isConstant(ys)) {
        const constVar = isConstant(xs) ? variables[i] : variables[j];
        if (variables.length === 2) {
          throw new StatInputError(
            'ZERO_VARIANCE',
            `"${constVar}" değişkeninin varyansı sıfır; korelasyon katsayısı tanımsızdır.`,
            `"${constVar}" has zero variance; the correlation coefficient is undefined.`,
          );
        }
        rowObj[variables[j]] = '-';
        heatData.push([j, i, null]);
        if (j > i) corrNotes.push(`${variables[i]} - ${variables[j]}: "${constVar}" sabit (varyans sıfır); korelasyon tanımsız.`);
        continue;
      }
      if (method === 'spearman') {
        xs = rankArray(xs);
        ys = rankArray(ys);
      }
      const { r, t } = pearsonPair(xs, ys);
      const p = clampP(2 * (1 - tCdf(Math.abs(t), n - 2)));
      const stars = sigStars(p);
      rowObj[variables[j]] = `${r.toFixed(3)}${stars} (p=${p.toFixed(3)}, N=${n})`;
      heatData.push([j, i, rNum(r, 3)]);
      if (j > i) {
        pairRows.push({
          var1: variables[i],
          var2: variables[j],
          r: rNum(r, 4),
          p: rNum(p, 4),
          n,
          sig: stars || 'ns',
        });
      }
    }
    matRows.push(rowObj);
  }

  return buildOutput(
    'correlation_test',
    `${method === 'spearman' ? 'Spearman Rho' : 'Pearson'} Korelasyon Matrisi`,
    { variables, method },
    { pairs: pairRows.length, method },
    [
      {
        id: 'corr_matrix',
        title: `${method === 'spearman' ? 'Spearman' : 'Pearson'} Korelasyon Matrisi`,
        columns: [{ key: 'variable', label: 'Değişken' }, ...variables.map((v) => ({ key: v, label: v }))],
        rows: matRows,
        footnotes: ['* p < .05 (2 taraflı), ** p < .01 (2 taraflı).', ...corrNotes],
      },
      {
        id: 'corr_pairs',
        title: 'İkili Korelasyon Özeti',
        columns: [
          { key: 'var1', label: 'Değişken 1' },
          { key: 'var2', label: 'Değişken 2' },
          { key: 'r', label: 'r', numeric: true },
          { key: 'p', label: 'p', numeric: true },
          { key: 'n', label: 'N', numeric: true },
          { key: 'sig', label: 'Anlamlılık' },
        ],
        rows: pairRows,
      },
    ],
    [
      {
        id: 'corr_heat',
        title: 'Korelasyon Isı Haritası',
        type: 'heatmap',
        option: {
          tooltip: { position: 'top' },
          xAxis: { type: 'category', data: variables },
          yAxis: { type: 'category', data: variables },
          visualMap: { min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
          series: [{ type: 'heatmap', data: heatData, label: { show: k <= 8 } }],
        },
      },
    ],
  );
}

export function runPartialCorrelation(
  dataset: Dataset,
  var1: string,
  var2: string,
  controls: string[],
): AnalysisOutput {
  if (!var1 || !var2 || controls.length === 0 || var1 === var2) {
    throw new StatInputError('NO_VARIABLES', 'İki farklı değişken ve en az bir kontrol değişkeni seçilmelidir.', 'Select two different variables and at least one control variable.');
  }
  if (controls.includes(var1) || controls.includes(var2)) {
    throw new StatInputError('INVALID_VARIABLES', 'Kontrol değişkeni, ilişkisi incelenen değişkenlerden biri olamaz.', 'A control variable cannot be one of the correlated variables.');
  }
  const cols = [var1, var2, ...controls];
  const mat = extractNumMatrix(dataset.rows, cols);
  const n = mat.length;
  assertMinN(n, controls.length + 4, 'Kısmi korelasyon (tam vaka)', 'Partial correlation (complete cases)');
  cols.forEach((c, idx) => {
    if (isConstant(mat.map((r) => r[idx]))) {
      throw new StatInputError('ZERO_VARIANCE', `"${c}" değişkeninin varyansı sıfır; kısmi korelasyon hesaplanamaz.`, `"${c}" has zero variance; partial correlation cannot be computed.`);
    }
  });
  const x = mat.map((r) => r[0]);
  const y = mat.map((r) => r[1]);
  const Z = mat.map((r) => r.slice(2));

  const fitX = olsFit(x, Z);
  const fitY = olsFit(y, Z);
  const { r: rPart } = pearsonPair(fitX.resid, fitY.resid);
  const df = n - 2 - controls.length;
  const tVal = rPart * Math.sqrt(df / Math.max(1e-12, 1 - rPart * rPart));
  if (isConstant(fitX.resid) || isConstant(fitY.resid)) {
    throw new StatInputError(
      'SINGULAR_MATRIX',
      'Kontrol değişkenleri incelenen değişkenlerden birini tamamen açıklıyor (artık varyansı sıfır); kısmi korelasyon tanımsız.',
      'Control variables fully explain one of the variables (zero residual variance); partial correlation is undefined.',
    );
  }
  const pPart = clampP(2 * (1 - tCdf(Math.abs(tVal), df)));

  const { r: rZero, t: tZero } = pearsonPair(x, y);
  const pZero = clampP(2 * (1 - tCdf(Math.abs(tZero), n - 2)));

  return buildOutput(
    'partial_correlation_test',
    'Kısmi Korelasyon Analizi',
    { var1, var2, controls },
    { rPartial: rNum(rPart, 4), p: rNum(pPart, 4), df },
    [
      {
        id: 'partial_corr',
        title: `Kısmi Korelasyon (Kontrol: ${controls.join(', ')})`,
        columns: [
          { key: 'type', label: 'Tür' },
          { key: 'pair', label: 'Çift' },
          { key: 'r', label: 'r', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 't', label: 't', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: [
          { type: 'Sıfırıncı Derece', pair: `${var1} ↔ ${var2}`, r: rNum(rZero, 4), df: n - 2, t: rNum(tZero, 3), p: rNum(pZero, 4) },
          { type: 'Kısmi Korelasyon', pair: `${var1} ↔ ${var2}`, r: rNum(rPart, 4), df, t: rNum(tVal, 3), p: rNum(pPart, 4) },
        ],
      },
    ],
  );
}

export function runChiSquare(dataset: Dataset, rowVar: string, colVar: string): AnalysisOutput {
  if (!rowVar || !colVar || rowVar === colVar) {
    throw new StatInputError('INVALID_VARIABLES', 'İki farklı kategorik değişken seçilmelidir.', 'Select two different categorical variables.');
  }
  const pairs = dataset.rows
    .map((r) => [r[rowVar], r[colVar]])
    .filter(([a, b]) => a !== null && a !== undefined && a !== '' && b !== null && b !== undefined && b !== '')
    .map(([a, b]) => [String(a), String(b)]);
  const nTot = pairs.length;
  if (nTot === 0) {
    throw new StatInputError('EMPTY_DATA', 'Ki-kare için her iki değişkende de dolu olan geçerli gözlem bulunamadı.', 'No observations with both variables present were found for chi-square.');
  }

  const rCats = Array.from(new Set(pairs.map((p) => p[0]))).sort();
  const cCats = Array.from(new Set(pairs.map((p) => p[1]))).sort();
  const rIdx = new Map(rCats.map((c, i) => [c, i]));
  const cIdx = new Map(cCats.map((c, i) => [c, i]));
  const obs = Array.from({ length: rCats.length }, () => new Array<number>(cCats.length).fill(0));
  for (const [rv, cv] of pairs) obs[rIdx.get(rv)!][cIdx.get(cv)!]++;

  const rTot = obs.map((row) => row.reduce((s, v) => s + v, 0));
  const cTot = cCats.map((_, j) => obs.reduce((s, row) => s + row[j], 0));
  if (rCats.length < 2 || cCats.length < 2) {
    const which = rCats.length < 2 ? rowVar : colVar;
    throw new StatInputError(
      'SINGLE_CATEGORY',
      `"${which}" değişkeninde yalnızca 1 kategori var; ki-kare testi için her iki değişkende en az 2 kategori gereklidir.`,
      `"${which}" has only 1 category; chi-square requires at least 2 categories in each variable.`,
    );
  }

  let chi2 = 0;
  let lr = 0;
  let lowExp = 0;
  for (let i = 0; i < rCats.length; i++) {
    for (let j = 0; j < cCats.length; j++) {
      const exp = (rTot[i] * cTot[j]) / nTot;
      if (exp < 5) lowExp++;
      if (exp > 0) {
        chi2 += ((obs[i][j] - exp) ** 2) / exp;
        if (obs[i][j] > 0) lr += 2 * obs[i][j] * Math.log(obs[i][j] / exp);
      }
    }
  }
  const df = Math.max(1, (rCats.length - 1) * (cCats.length - 1));
  const p = clampP(1 - chi2Cdf(chi2, df));
  const pLr = clampP(1 - chi2Cdf(lr, df));
  const nCells = rCats.length * cCats.length;
  const lowExpPct = (lowExp / nCells) * 100;
  const zeroCells = obs.reduce((s, row) => s + row.filter((v) => v === 0).length, 0);
  const minDim = Math.max(1, Math.min(rCats.length - 1, cCats.length - 1));
  const phi = Math.sqrt(chi2 / nTot);
  const cramerV = Math.sqrt(chi2 / (nTot * minDim));

  // Fisher Exact for 2x2
  let fisherP: number | null = null;
  if (rCats.length === 2 && cCats.length === 2) {
    const a = obs[0][0], b = obs[0][1], c = obs[1][0], d = obs[1][1];
    const logFact = (k: number): number => {
      let s = 0;
      for (let i = 2; i <= k; i++) s += Math.log(i);
      return s;
    };
    const hyper = (x: number) =>
      Math.exp(
        logFact(rTot[0]) +
          logFact(rTot[1]) +
          logFact(cTot[0]) +
          logFact(cTot[1]) -
          logFact(nTot) -
          logFact(x) -
          logFact(rTot[0] - x) -
          logFact(cTot[0] - x) -
          logFact(rTot[1] - (cTot[0] - x)),
      );
    const pObs = hyper(a);
    let fp = 0;
    const minX = Math.max(0, cTot[0] - rTot[1]);
    const maxX = Math.min(rTot[0], cTot[0]);
    for (let x = minX; x <= maxX; x++) {
      const px = hyper(x);
      if (px <= pObs + 1e-12) fp += px;
    }
    fisherP = clampP(fp);
  }
  const chiNotes: string[] = [`Beklenen frekansı 5'ten küçük hücre sayısı: ${lowExp} (%${fmtNum(lowExpPct, 1)}).`];
  if (lowExp > 0 && (lowExpPct > 20 || (rCats.length === 2 && cCats.length === 2))) {
    chiNotes.push(
      rCats.length === 2 && cCats.length === 2
        ? 'Uyarı: Beklenen frekansı 5\'ten küçük hücre var; 2x2 tabloda Fisher Kesin Testi p değeri raporlanmalıdır.'
        : 'Uyarı: Hücrelerin %20\'sinden fazlasında beklenen frekans 5\'ten küçük; ki-kare yaklaşımı güvenilir olmayabilir. Kategorileri birleştirmeyi veya kesin test kullanmayı düşünün.',
    );
  }
  if (zeroCells > 0) chiNotes.push(`Gözlenen frekansı 0 olan hücre sayısı: ${zeroCells}.`);
  const recommendFisher = fisherP !== null && lowExp > 0;

  const ctRows = rCats.map((rc, i) => {
    const obj: Record<string, string | number | null> = { row_cat: rc };
    cCats.forEach((cc, j) => {
      const exp = (rTot[i] * cTot[j]) / nTot;
      obj[cc] = `${obs[i][j]} (Bekl: ${exp.toFixed(1)})`;
    });
    obj.total = rTot[i];
    return obj;
  });

  const testRows: Record<string, string | number | null>[] = [
    { test: 'Pearson Ki-Kare (χ²)', stat: rNum(chi2, 3), df, p: rNum(p, 4) },
    { test: 'Olabilirlik Oranı (G²)', stat: rNum(lr, 3), df, p: rNum(pLr, 4) },
    { test: 'Phi / Cramer\'s V', stat: `${fmtNum(phi, 3)} / ${fmtNum(cramerV, 3)}`, df: null, p: rNum(p, 4) },
  ];
  if (fisherP !== null) testRows.push({ test: 'Fisher Kesin Testi (2 taraflı)', stat: null, df: null, p: rNum(fisherP, 4) });

  return buildOutput(
    'chi_square',
    `Ki-Kare & Çapraz Tablo (${rowVar} × ${colVar})`,
    { rowVar, colVar },
    {
      chi2: rNum(chi2, 3),
      df,
      p: rNum(p, 4),
      cramersV: rNum(cramerV, 3),
      fisherP: rNum(fisherP, 4),
      lowExpCells: lowExp,
      lowExpPct: rNum(lowExpPct, 1),
      zeroCells,
      recommendFisher,
      expectedCountWarning: lowExp > 0 && (lowExpPct > 20 || recommendFisher),
    },
    [
      {
        id: 'crosstab',
        title: `Çapraz Tablo: ${rowVar} × ${colVar}`,
        columns: [{ key: 'row_cat', label: rowVar }, ...cCats.map((c) => ({ key: c, label: c })), { key: 'total', label: 'Toplam', numeric: true }],
        rows: ctRows,
      },
      {
        id: 'chi_tests',
        title: 'Ki-Kare Test Sonuçları',
        columns: [
          { key: 'test', label: 'Test' },
          { key: 'stat', label: 'Değer', numeric: true },
          { key: 'df', label: 'sd', numeric: true },
          { key: 'p', label: 'p', numeric: true },
        ],
        rows: testRows,
        footnotes: chiNotes,
      },
    ],
  );
}
