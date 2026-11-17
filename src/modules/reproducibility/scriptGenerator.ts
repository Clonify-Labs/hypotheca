import { AnalysisOutput } from '../../types/interfaces';

export type ScriptFormat = 'r' | 'python' | 'spss_syntax';

function escapeDouble(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeSingleSpss(value: string): string {
  return value.replace(/'/g, "''");
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return filtered.length > 0 ? filtered : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function rIdent(col: string): string {
  return /^[A-Za-z.][A-Za-z0-9._]*$/.test(col) ? col : `\`${col.replace(/`/g, '')}\``;
}

function rStr(value: string): string {
  return `"${escapeDouble(value)}"`;
}

function rVec(cols: string[]): string {
  return `c(${cols.map(rStr).join(', ')})`;
}

function pyStr(value: string): string {
  return `"${escapeDouble(value)}"`;
}

function pyList(cols: string[]): string {
  return `[${cols.map(pyStr).join(', ')}]`;
}

function pyFormulaTerm(col: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(col) ? col : `Q(${pyStr(col)})`;
}

function spssVal(value: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const str = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(str)) return str;
  return `'${escapeSingleSpss(str)}'`;
}

function spssVars(cols: string[]): string {
  return cols.join(' ');
}

function sanitizeLavaanName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_.]/g, '_');
  return /^[A-Za-z]/.test(clean) ? clean : `F_${clean}`;
}

interface SemFactorParam {
  name: string;
  indicators: string[];
}

interface SemPathParam {
  from: string;
  to: string;
}

function extractSemSpec(params: Record<string, unknown>): { factors: SemFactorParam[]; paths: SemPathParam[] } {
  const rawFactors = Array.isArray(params.factors) ? params.factors : [];
  const factors: SemFactorParam[] = rawFactors
    .map((f): SemFactorParam | null => {
      if (!f || typeof f !== 'object') return null;
      const obj = f as Record<string, unknown>;
      const name = asString(obj.name, 'Factor');
      const indicators = asStringArray(obj.indicators, []);
      return indicators.length > 0 ? { name, indicators } : null;
    })
    .filter((f): f is SemFactorParam => f !== null);

  const rawPaths = Array.isArray(params.paths) ? params.paths : [];
  const paths: SemPathParam[] = rawPaths
    .map((p): SemPathParam | null => {
      if (!p || typeof p !== 'object') return null;
      const obj = p as Record<string, unknown>;
      const from = asOptionalString(obj.from);
      const to = asOptionalString(obj.to);
      return from && to ? { from, to } : null;
    })
    .filter((p): p is SemPathParam => p !== null);

  return { factors, paths };
}

function extractBlocks(params: Record<string, unknown>, predictors: string[]): string[][] {
  if (!Array.isArray(params.blocks) || params.blocks.length === 0) return [predictors];
  const parsed = params.blocks
    .map((b) => asStringArray(b, []))
    .filter((b) => b.length > 0);
  return parsed.length > 0 ? parsed : [predictors];
}

function buildScriptHeader(datasetName: string, format: ScriptFormat, metaComment: string): string {
  const safeFile = datasetName.trim() || 'dataset.csv';
  if (format === 'r') {
    return [
      '# Hypotheca Reproducible R Script',
      metaComment,
      'suppressPackageStartupMessages({',
      '  library(tidyverse)',
      '  library(car)',
      '  library(effectsize)',
      '  library(psych)',
      '  library(lavaan)',
      '  library(pwr)',
      '  library(survival)',
      '})',
      '',
      `df <- readr::read_csv("${escapeDouble(safeFile)}")`,
    ].join('\n');
  }

  if (format === 'python') {
    return [
      '# Hypotheca Reproducible Python Script',
      metaComment,
      'import numpy as np',
      'import pandas as pd',
      'import scipy.stats as stats',
      'import pingouin as pg',
      'import statsmodels.api as sm',
      'import statsmodels.formula.api as smf',
      '',
      'try:',
      '    from factor_analyzer import FactorAnalyzer, calculate_kmo, calculate_bartlett_sphericity',
      'except ImportError:',
      '    FactorAnalyzer = None',
      '',
      'try:',
      '    from lifelines import KaplanMeierFitter',
      '    from lifelines.statistics import logrank_test, multivariate_logrank_test',
      'except ImportError:',
      '    KaplanMeierFitter = None',
      '',
      `df = pd.read_csv("${escapeDouble(safeFile)}")`,
    ].join('\n');
  }

  return [
    '* Hypotheca SPSS Syntax.',
    metaComment,
    '* Load the CSV dataset into SPSS before executing (File > Import Data > CSV),',
    '* or update FILE= path below to match your local working directory.',
    'GET DATA /TYPE=TXT',
    `  /FILE='${escapeSingleSpss(safeFile)}'`,
    '  /DELCASE=LINE /DELIMITERS="," /QUALIFIER=\'"\' /ARRANGEMENT=DELIMITED',
    '  /FIRSTCASE=2 /VARIABLES=ALL.',
    'CACHE.',
    'EXECUTE.',
  ].join('\n');
}

function renderRBody(analysis: AnalysisOutput): string {
  const p = analysis.params ?? {};
  switch (analysis.analysisType) {
    case 'descriptive_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `desc_vars <- ${rVec(vars)}`,
        'desc_df <- df %>% select(all_of(desc_vars))',
        'print(psych::describe(desc_df))',
      ].join('\n');
    }

    case 'frequency_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `freq_vars <- ${rVec(vars)}`,
        'for (v in freq_vars) {',
        '  cat("\\n--- Frequency:", v, "---\\n")',
        '  tbl <- table(df[[v]], useNA = "ifany")',
        '  print(tbl)',
        '  print(round(prop.table(tbl) * 100, 2))',
        '}',
      ].join('\n');
    }

    case 'normality_test': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `norm_vars <- ${rVec(vars)}`,
        'for (v in norm_vars) {',
        '  x <- na.omit(df[[v]])',
        '  cat("\\n--- Normality:", v, "---\\n")',
        '  if (length(x) >= 3 && length(x) <= 5000) print(shapiro.test(x))',
        '  print(ks.test(as.numeric(scale(x)), "pnorm"))',
        '  print(psych::describe(x)[, c("n", "mean", "sd", "skew", "kurtosis")])',
        '}',
      ].join('\n');
    }

    case 'outlier_analysis': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `out_vars <- ${rVec(vars)}`,
        'for (v in out_vars) {',
        '  x <- na.omit(df[[v]])',
        '  q <- quantile(x, c(0.25, 0.75))',
        '  iqr <- q[2] - q[1]',
        '  z <- as.numeric(scale(x))',
        '  iqr_idx <- which(x < q[1] - 1.5 * iqr | x > q[2] + 1.5 * iqr)',
        '  z_idx <- which(abs(z) > 3.29)',
        '  cat(v, "- IQR outliers:", length(iqr_idx), "| |z|>3.29 outliers:", length(z_idx), "\\n")',
        '}',
      ].join('\n');
    }

    case 'one_sample_t': {
      const variable = asString(p.variable, 'var1');
      const mu = asNumber(p.testValue, 0);
      return [
        `x <- na.omit(df[[${rStr(variable)}]])`,
        `print(t.test(x, mu = ${mu}))`,
        `print(effectsize::cohens_d(x, mu = ${mu}))`,
      ].join('\n');
    }

    case 'independent_t': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, []);
      const filterLine =
        groups.length >= 2
          ? `  filter(${rIdent(grp)} %in% ${rVec(groups.slice(0, 2))}) %>%`
          : '';
      return [
        `sub_df <- df %>%`,
        `  select(all_of(${rVec([dep, grp])})) %>%`,
        `  drop_na() %>%`,
        ...(filterLine ? [filterLine] : []),
        `  mutate(${rIdent(grp)} = as.factor(${rIdent(grp)}))`,
        `print(car::leveneTest(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df, center = "mean"))`,
        `print(t.test(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df, var.equal = TRUE))`,
        `print(t.test(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df, var.equal = FALSE))`,
        `print(effectsize::cohens_d(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df))`,
      ].join('\n');
    }

    case 'paired_t': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        `sub_df <- df %>% select(all_of(${rVec([var1, var2])})) %>% drop_na()`,
        `print(t.test(sub_df[[${rStr(var1)}]], sub_df[[${rStr(var2)}]], paired = TRUE))`,
        `print(effectsize::repeated_measures_d(sub_df[[${rStr(var1)}]], sub_df[[${rStr(var2)}]]))`,
      ].join('\n');
    }

    case 'oneway_anova': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      const posthoc = asString(p.posthocMethod, 'tukey');
      const posthocLine =
        posthoc === 'bonferroni'
          ? `print(pairwise.t.test(sub_df[[${rStr(dep)}]], sub_df[[${rStr(factor)}]], p.adjust.method = "bonferroni"))`
          : posthoc === 'games_howell'
            ? `print(pairwise.t.test(sub_df[[${rStr(dep)}]], sub_df[[${rStr(factor)}]], pool.sd = FALSE, p.adjust.method = "holm"))`
            : 'print(TukeyHSD(fit_aov))';
      return [
        `sub_df <- df %>%`,
        `  select(all_of(${rVec([dep, factor])})) %>%`,
        `  drop_na() %>%`,
        `  mutate(${rIdent(factor)} = as.factor(${rIdent(factor)}))`,
        `print(car::leveneTest(${rIdent(dep)} ~ ${rIdent(factor)}, data = sub_df, center = "mean"))`,
        `fit_aov <- aov(${rIdent(dep)} ~ ${rIdent(factor)}, data = sub_df)`,
        'print(summary(fit_aov))',
        `print(oneway.test(${rIdent(dep)} ~ ${rIdent(factor)}, data = sub_df, var.equal = FALSE))`,
        'print(effectsize::eta_squared(fit_aov))',
        'print(effectsize::omega_squared(fit_aov))',
        posthocLine,
      ].join('\n');
    }

    case 'repeated_anova': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        `rm_vars <- ${rVec(vars)}`,
        'sub_df <- df %>%',
        '  select(all_of(rm_vars)) %>%',
        '  drop_na() %>%',
        '  mutate(subject_id = row_number()) %>%',
        '  pivot_longer(cols = all_of(rm_vars), names_to = "time", values_to = "score") %>%',
        '  mutate(time = factor(time, levels = rm_vars), subject_id = factor(subject_id))',
        'fit_rm <- aov(score ~ time + Error(subject_id / time), data = sub_df)',
        'print(summary(fit_rm))',
        'print(pairwise.t.test(sub_df$score, sub_df$time, paired = TRUE, p.adjust.method = "bonferroni"))',
      ].join('\n');
    }

    case 'mann_whitney_u': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, []);
      const filterLine =
        groups.length >= 2
          ? `  filter(${rIdent(grp)} %in% ${rVec(groups.slice(0, 2))}) %>%`
          : '';
      return [
        `sub_df <- df %>%`,
        `  select(all_of(${rVec([dep, grp])})) %>%`,
        `  drop_na() %>%`,
        ...(filterLine ? [filterLine] : []),
        `  mutate(${rIdent(grp)} = as.factor(${rIdent(grp)}))`,
        `print(wilcox.test(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df, exact = FALSE))`,
        `print(effectsize::rank_biserial(${rIdent(dep)} ~ ${rIdent(grp)}, data = sub_df))`,
      ].join('\n');
    }

    case 'wilcoxon': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        `sub_df <- df %>% select(all_of(${rVec([var1, var2])})) %>% drop_na()`,
        `print(wilcox.test(sub_df[[${rStr(var1)}]], sub_df[[${rStr(var2)}]], paired = TRUE, exact = FALSE))`,
        `print(effectsize::rank_biserial(sub_df[[${rStr(var1)}]], sub_df[[${rStr(var2)}]], paired = TRUE))`,
      ].join('\n');
    }

    case 'kruskal_wallis': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      return [
        `sub_df <- df %>%`,
        `  select(all_of(${rVec([dep, factor])})) %>%`,
        `  drop_na() %>%`,
        `  mutate(${rIdent(factor)} = as.factor(${rIdent(factor)}))`,
        `print(kruskal.test(${rIdent(dep)} ~ ${rIdent(factor)}, data = sub_df))`,
        `print(effectsize::rank_epsilon_squared(${rIdent(dep)} ~ ${rIdent(factor)}, data = sub_df))`,
        `print(pairwise.wilcox.test(sub_df[[${rStr(dep)}]], sub_df[[${rStr(factor)}]], p.adjust.method = "bonferroni", exact = FALSE))`,
      ].join('\n');
    }

    case 'friedman': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        `f_vars <- ${rVec(vars)}`,
        'sub_mat <- as.matrix(df %>% select(all_of(f_vars)) %>% drop_na())',
        'print(friedman.test(sub_mat))',
        'print(effectsize::kendalls_w(sub_mat))',
      ].join('\n');
    }

    case 'correlation_test': {
      const vars = asStringArray(p.variables, ['var1', 'var2']);
      const method = asString(p.method, 'pearson') === 'spearman' ? 'spearman' : 'pearson';
      return [
        `cor_vars <- ${rVec(vars)}`,
        'sub_df <- df %>% select(all_of(cor_vars)) %>% drop_na()',
        `cor_res <- psych::corr.test(sub_df, method = ${rStr(method)}, adjust = "none")`,
        'print(cor_res, short = FALSE)',
      ].join('\n');
    }

    case 'partial_correlation_test': {
      const var1 = asString(p.var1, 'var1');
      const var2 = asString(p.var2, 'var2');
      const controls = asStringArray(p.controls, ['ctrl1']);
      const allCols = [var1, var2, ...controls];
      return [
        `pcor_vars <- ${rVec(allCols)}`,
        'sub_df <- df %>% select(all_of(pcor_vars)) %>% drop_na()',
        `pcor_mat <- psych::partial.r(sub_df, x = ${rVec([var1, var2])}, y = ${rVec(controls)})`,
        'print(pcor_mat)',
        `print(psych::corr.p(pcor_mat, n = nrow(sub_df) - ${controls.length}))`,
      ].join('\n');
    }

    case 'chi_square': {
      const rowVar = asString(p.rowVar, 'rowVar');
      const colVar = asString(p.colVar, 'colVar');
      return [
        `sub_df <- df %>% select(all_of(${rVec([rowVar, colVar])})) %>% drop_na()`,
        `tbl <- table(sub_df[[${rStr(rowVar)}]], sub_df[[${rStr(colVar)}]])`,
        'print(tbl)',
        'chi_res <- chisq.test(tbl, correct = FALSE)',
        'print(chi_res)',
        'print(effectsize::cramers_v(tbl))',
        'if (all(dim(tbl) == c(2, 2))) print(fisher.test(tbl))',
      ].join('\n');
    }

    case 'reliability': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      return [
        `rel_items <- ${rVec(items)}`,
        'sub_df <- df %>% select(all_of(rel_items)) %>% drop_na()',
        'print(psych::alpha(sub_df))',
        'print(psych::omega(sub_df, nfactors = 1, plot = FALSE))',
      ].join('\n');
    }

    case 'efa': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      const nFactors = asNumber(p.nFactors, 1);
      const rotation = asString(p.rotation, 'varimax') === 'none' ? 'none' : 'varimax';
      const extraction = asString(p.extraction, 'pca') === 'paf' ? 'paf' : 'pca';
      const fitLine =
        extraction === 'paf'
          ? `fit_efa <- psych::fa(sub_df, nfactors = ${nFactors}, rotate = ${rStr(rotation)}, fm = "pa")`
          : `fit_efa <- psych::principal(sub_df, nfactors = ${nFactors}, rotate = ${rStr(rotation)})`;
      return [
        `efa_items <- ${rVec(items)}`,
        'sub_df <- df %>% select(all_of(efa_items)) %>% drop_na()',
        'print(psych::KMO(sub_df))',
        'print(psych::cortest.bartlett(cor(sub_df), n = nrow(sub_df)))',
        fitLine,
        'print(fit_efa, cut = 0.30, sort = TRUE)',
      ].join('\n');
    }

    case 'rasch': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      const model = asString(p.model, 'rating_scale') === 'dichotomous' ? '1PL' : 'RSM';
      return [
        `rasch_items <- ${rVec(items)}`,
        'sub_df <- df %>% select(all_of(rasch_items)) %>% drop_na()',
        'if (requireNamespace("TAM", quietly = TRUE)) {',
        `  fit_rasch <- TAM::tam.mml(sub_df, irtmodel = ${rStr(model)}, verbose = FALSE)`,
        '  print(summary(fit_rasch))',
        '} else {',
        '  print(psych::irt.fa(sub_df))',
        '}',
      ].join('\n');
    }

    case 'cb_sem': {
      const { factors, paths } = extractSemSpec(p);
      const measLines = factors.map(
        (f) => `  ${sanitizeLavaanName(f.name)} =~ ${f.indicators.map(rIdent).join(' + ')}`,
      );
      const targetMap = new Map<string, string[]>();
      for (const pt of paths) {
        const toName = sanitizeLavaanName(pt.to);
        const fromName = sanitizeLavaanName(pt.from);
        const list = targetMap.get(toName) ?? [];
        list.push(fromName);
        targetMap.set(toName, list);
      }
      const pathLines = Array.from(targetMap.entries()).map(
        ([toName, fromNames]) => `  ${toName} ~ ${fromNames.join(' + ')}`,
      );
      const modelBody = [...measLines, ...(pathLines.length ? ['', '  # Structural paths', ...pathLines] : [])].join('\n');
      return [
        'sem_model <- "',
        modelBody,
        '"',
        'fit_sem <- lavaan::sem(sem_model, data = df, estimator = "ML")',
        'summary(fit_sem, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)',
      ].join('\n');
    }

    case 'pls_sem': {
      const { factors, paths } = extractSemSpec(p);
      const boot = asNumber(p.bootstrapSamples, 200);
      const measLines = factors.map(
        (f) => `  ${sanitizeLavaanName(f.name)} =~ ${f.indicators.map(rIdent).join(' + ')}`,
      );
      const targetMap = new Map<string, string[]>();
      for (const pt of paths) {
        const toName = sanitizeLavaanName(pt.to);
        const fromName = sanitizeLavaanName(pt.from);
        const list = targetMap.get(toName) ?? [];
        list.push(fromName);
        targetMap.set(toName, list);
      }
      const pathLines = Array.from(targetMap.entries()).map(
        ([toName, fromNames]) => `  ${toName} ~ ${fromNames.join(' + ')}`,
      );
      return [
        'set.seed(421337)',
        '# Composite PLS-SEM specification (Mode A outer weights + bootstrap inference)',
        'pls_lavaan_equiv <- "',
        [...measLines, ...pathLines].join('\n'),
        '"',
        `fit_pls <- lavaan::sem(pls_lavaan_equiv, data = df, se = "bootstrap", bootstrap = ${boot})`,
        'summary(fit_pls, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)',
      ].join('\n');
    }

    case 'linear_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      const blocks = extractBlocks(p, predictors);
      const allCols = [outcome, ...predictors];
      const lines = [
        `sub_df <- df %>% select(all_of(${rVec(allCols)})) %>% drop_na()`,
      ];
      let cumulative: string[] = [];
      blocks.forEach((blk, idx) => {
        cumulative = Array.from(new Set([...cumulative, ...blk]));
        const rhs = cumulative.map(rIdent).join(' + ');
        lines.push(`fit_m${idx + 1} <- lm(${rIdent(outcome)} ~ ${rhs}, data = sub_df)`);
      });
      if (blocks.length > 1) {
        const modelNames = blocks.map((_, i) => `fit_m${i + 1}`).join(', ');
        lines.push(`print(anova(${modelNames}))`);
      }
      const lastModel = `fit_m${blocks.length}`;
      lines.push(
        `print(summary(${lastModel}))`,
        `print(confint(${lastModel}))`,
        `print(effectsize::standardize_parameters(${lastModel}))`,
        `if (length(coef(${lastModel})) > 2) print(car::vif(${lastModel}))`,
        `print(car::durbinWatsonTest(${lastModel}))`,
      );
      return lines.join('\n');
    }

    case 'logistic_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      const posClass = p.positiveClass !== undefined && p.positiveClass !== null ? String(p.positiveClass) : '1';
      const rhs = predictors.map(rIdent).join(' + ');
      return [
        `sub_df <- df %>% select(all_of(${rVec([outcome, ...predictors])})) %>% drop_na()`,
        `sub_df <- sub_df %>% mutate(.outcome_bin = as.integer(as.character(${rIdent(outcome)}) == ${rStr(posClass)}))`,
        `fit_logit <- glm(.outcome_bin ~ ${rhs}, data = sub_df, family = binomial(link = "logit"))`,
        'print(summary(fit_logit))',
        'print(exp(cbind(OR = coef(fit_logit), confint.default(fit_logit))))',
        'if (length(coef(fit_logit)) > 2) print(car::vif(fit_logit))',
      ].join('\n');
    }

    case 'roc_curve': {
      const scoreVar = asString(p.scoreVar, 'score');
      const stateVar = asString(p.stateVar, 'state');
      const posClass = p.positiveClass !== undefined && p.positiveClass !== null ? String(p.positiveClass) : '1';
      return [
        `sub_df <- df %>% select(all_of(${rVec([scoreVar, stateVar])})) %>% drop_na()`,
        `y_bin <- as.integer(as.character(sub_df[[${rStr(stateVar)}]]) == ${rStr(posClass)})`,
        `scores <- sub_df[[${rStr(scoreVar)}]]`,
        'wt <- wilcox.test(scores[y_bin == 1], scores[y_bin == 0])',
        'auc_val <- as.numeric(wt$statistic) / (sum(y_bin == 1) * sum(y_bin == 0))',
        'cat("ROC AUC =", round(auc_val, 4), "\\n")',
        'if (requireNamespace("pROC", quietly = TRUE)) {',
        '  roc_obj <- pROC::roc(y_bin, scores, quiet = TRUE)',
        '  print(pROC::auc(roc_obj))',
        '  print(pROC::ci.auc(roc_obj))',
        '  print(pROC::coords(roc_obj, "best", best.method = "youden"))',
        '}',
      ].join('\n');
    }

    case 'bland_altman': {
      const m1 = asString(p.method1, 'method1');
      const m2 = asString(p.method2, 'method2');
      return [
        `sub_df <- df %>% select(all_of(${rVec([m1, m2])})) %>% drop_na()`,
        `diff_vals <- sub_df[[${rStr(m1)}]] - sub_df[[${rStr(m2)}]]`,
        `mean_vals <- (sub_df[[${rStr(m1)}]] + sub_df[[${rStr(m2)}]]) / 2`,
        'bias <- mean(diff_vals)',
        'sd_diff <- sd(diff_vals)',
        'loa <- bias + c(-1.96, 1.96) * sd_diff',
        'cat(sprintf("Bias = %.4f, SD = %.4f, 95%% LoA = [%.4f, %.4f]\\n", bias, sd_diff, loa[1], loa[2]))',
        'print(t.test(diff_vals, mu = 0))',
      ].join('\n');
    }

    case 'kaplan_meier': {
      const timeVar = asString(p.timeVar, 'time');
      const eventVar = asString(p.eventVar, 'event');
      const groupVar = asOptionalString(p.groupVar);
      const cols = groupVar ? [timeVar, eventVar, groupVar] : [timeVar, eventVar];
      const formulaStr = groupVar
        ? `survival::Surv(${rIdent(timeVar)}, ${rIdent(eventVar)}) ~ ${rIdent(groupVar)}`
        : `survival::Surv(${rIdent(timeVar)}, ${rIdent(eventVar)}) ~ 1`;
      return [
        `sub_df <- df %>% select(all_of(${rVec(cols)})) %>% drop_na()`,
        `km_fit <- survival::survfit(${formulaStr}, data = sub_df)`,
        'print(km_fit)',
        'print(summary(km_fit))',
        ...(groupVar ? [`print(survival::survdiff(${formulaStr}, data = sub_df))`] : []),
      ].join('\n');
    }

    case 'process_model4': {
      const x = asString(p.x, 'X');
      const m = asString(p.mOrW, 'M');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const boot = asNumber(p.bootstrapSamples, 500);
      const covPart = covs.length > 0 ? ` + ${covs.map(rIdent).join(' + ')}` : '';
      return [
        'set.seed(918273)',
        'med_model <- "',
        `  ${rIdent(m)} ~ a * ${rIdent(x)}${covPart}`,
        `  ${rIdent(y)} ~ b * ${rIdent(m)} + cp * ${rIdent(x)}${covPart}`,
        '  indirect := a * b',
        '  total := cp + (a * b)',
        '"',
        `fit_med <- lavaan::sem(med_model, data = df, se = "bootstrap", bootstrap = ${boot})`,
        'lavaan::parameterEstimates(fit_med, boot.ci.type = "perc", standardized = TRUE) %>% print()',
      ].join('\n');
    }

    case 'process_model1': {
      const x = asString(p.x, 'X');
      const w = asString(p.mOrW, 'W');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const allCols = [x, w, y, ...covs];
      const covTerm = covs.length > 0 ? ` + ${covs.map(rIdent).join(' + ')}` : '';
      return [
        `sub_df <- df %>% select(all_of(${rVec(allCols)})) %>% drop_na()`,
        `sub_df <- sub_df %>% mutate(X_c = ${rIdent(x)} - mean(${rIdent(x)}), W_c = ${rIdent(w)} - mean(${rIdent(w)}), XW = X_c * W_c)`,
        `fit_base <- lm(${rIdent(y)} ~ X_c + W_c${covTerm}, data = sub_df)`,
        `fit_mod <- lm(${rIdent(y)} ~ X_c + W_c + XW${covTerm}, data = sub_df)`,
        'print(anova(fit_base, fit_mod))',
        'print(summary(fit_mod))',
        'sd_w <- sd(sub_df$W_c)',
        'b <- coef(fit_mod)',
        'cat("Simple slope (-1 SD):", b["X_c"] + b["XW"] * (-sd_w), "\\n")',
        'cat("Simple slope (Mean): ", b["X_c"], "\\n")',
        'cat("Simple slope (+1 SD):", b["X_c"] + b["XW"] * (sd_w), "\\n")',
      ].join('\n');
    }

    case 'power_analysis': {
      const testType = asString(p.testType, 'indep_t');
      const mode = asString(p.mode, 'apriori');
      const alpha = asNumber(p.alpha, 0.05);
      const power = asNumber(p.power, 0.8);
      const d = asNumber(p.effectSize, 0.5);
      const n = asNumber(p.n ?? p.solvedN, 64);
      const groups = asNumber(p.groups, 3);
      const predictors = asNumber(p.predictors, 3);
      const dfVal = asNumber(p.df, 1);
      const tails = asNumber(p.tails, 2) === 1 ? 'greater' : 'two.sided';

      if (testType === 'oneway_anova') {
        return mode === 'posthoc'
          ? `print(pwr::pwr.anova.test(k = ${groups}, n = ${Math.max(2, Math.round(n / groups))}, f = ${d}, sig.level = ${alpha}))`
          : `print(pwr::pwr.anova.test(k = ${groups}, f = ${d}, sig.level = ${alpha}, power = ${power}))`;
      }
      if (testType === 'correlation') {
        return mode === 'posthoc'
          ? `print(pwr::pwr.r.test(n = ${n}, r = ${d}, sig.level = ${alpha}, alternative = ${rStr(tails)}))`
          : `print(pwr::pwr.r.test(r = ${d}, sig.level = ${alpha}, power = ${power}, alternative = ${rStr(tails)}))`;
      }
      if (testType === 'linear_regression') {
        return mode === 'posthoc'
          ? `print(pwr::pwr.f2.test(u = ${predictors}, v = ${Math.max(2, n - predictors - 1)}, f2 = ${d}, sig.level = ${alpha}))`
          : `print(pwr::pwr.f2.test(u = ${predictors}, f2 = ${d}, sig.level = ${alpha}, power = ${power}))`;
      }
      if (testType === 'chi_square') {
        return mode === 'posthoc'
          ? `print(pwr::pwr.chisq.test(w = ${d}, N = ${n}, df = ${dfVal}, sig.level = ${alpha}))`
          : `print(pwr::pwr.chisq.test(w = ${d}, df = ${dfVal}, sig.level = ${alpha}, power = ${power}))`;
      }
      if (testType === 'proportions_2') {
        return mode === 'posthoc'
          ? `print(pwr::pwr.2p.test(h = ${d}, n = ${Math.max(2, Math.round(n / 2))}, sig.level = ${alpha}, alternative = ${rStr(tails)}))`
          : `print(pwr::pwr.2p.test(h = ${d}, sig.level = ${alpha}, power = ${power}, alternative = ${rStr(tails)}))`;
      }
      const pwrType =
        testType === 'paired_t' ? 'paired' : testType === 'one_sample_t' ? 'one.sample' : 'two.sample';
      const nArg = pwrType === 'two.sample' ? Math.max(2, Math.round(n / 2)) : n;
      return mode === 'posthoc'
        ? `print(pwr::pwr.t.test(n = ${nArg}, d = ${d}, sig.level = ${alpha}, type = ${rStr(pwrType)}, alternative = ${rStr(tails)}))`
        : `print(pwr::pwr.t.test(d = ${d}, sig.level = ${alpha}, power = ${power}, type = ${rStr(pwrType)}, alternative = ${rStr(tails)}))`;
    }

    default: {
      return [
        `# Generic reproducible inspection for analysisType: ${analysis.analysisType}`,
        'glimpse(df)',
        'print(summary(df))',
      ].join('\n');
    }
  }
}

function renderPythonBody(analysis: AnalysisOutput): string {
  const p = analysis.params ?? {};
  switch (analysis.analysisType) {
    case 'descriptive_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `desc_cols = ${pyList(vars)}`,
        'desc = df[desc_cols].agg(["count", "mean", "std", "min", "median", "max"]).T',
        'desc["skew"] = df[desc_cols].skew()',
        'desc["kurtosis"] = df[desc_cols].kurtosis()',
        'print(desc)',
      ].join('\n');
    }

    case 'frequency_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `for col in ${pyList(vars)}:`,
        '    freq = df[col].value_counts(dropna=False).to_frame("n")',
        '    freq["pct"] = (freq["n"] / len(df)) * 100.0',
        '    print(f"\\n--- Frequency: {col} ---")',
        '    print(freq)',
      ].join('\n');
    }

    case 'normality_test': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `for col in ${pyList(vars)}:`,
        '    x = df[col].dropna()',
        '    sw_w, sw_p = stats.shapiro(x)',
        '    z = (x - x.mean()) / x.std(ddof=1)',
        '    ks_d, ks_p = stats.kstest(z, "norm")',
        '    print(f"{col}: Shapiro-Wilk W={sw_w:.4f}, p={sw_p:.4g} | KS D={ks_d:.4f}, p={ks_p:.4g} | skew={x.skew():.3f}, kurt={x.kurtosis():.3f}")',
      ].join('\n');
    }

    case 'outlier_analysis': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `for col in ${pyList(vars)}:`,
        '    x = df[col].dropna()',
        '    q1, q3 = x.quantile([0.25, 0.75])',
        '    iqr = q3 - q1',
        '    z = (x - x.mean()) / x.std(ddof=1)',
        '    iqr_out = x[(x < q1 - 1.5 * iqr) | (x > q3 + 1.5 * iqr)]',
        '    z_out = x[z.abs() > 3.29]',
        '    print(f"{col}: IQR outliers={len(iqr_out)}, |z|>3.29 outliers={len(z_out)}")',
      ].join('\n');
    }

    case 'one_sample_t': {
      const variable = asString(p.variable, 'var1');
      const mu = asNumber(p.testValue, 0);
      return [
        `x = df[${pyStr(variable)}].dropna()`,
        `print(pg.ttest(x, ${mu}))`,
        `print("scipy:", stats.ttest_1samp(x, popmean=${mu}))`,
      ].join('\n');
    }

    case 'independent_t': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, []);
      if (groups.length >= 2) {
        return [
          `sub = df[${pyList([dep, grp])}].dropna()`,
          `g1 = sub.loc[sub[${pyStr(grp)}].astype(str) == ${pyStr(groups[0])}, ${pyStr(dep)}]`,
          `g2 = sub.loc[sub[${pyStr(grp)}].astype(str) == ${pyStr(groups[1])}, ${pyStr(dep)}]`,
          'lev_f, lev_p = stats.levene(g1, g2, center="mean")',
          'print(f"Levene F={lev_f:.4f}, p={lev_p:.4g}")',
          'print("Student t-test:\\n", pg.ttest(g1, g2, correction=False))',
          'print("Welch t-test:\\n", pg.ttest(g1, g2, correction=True))',
        ].join('\n');
      }
      return [
        `sub = df[${pyList([dep, grp])}].dropna()`,
        `groups = [g[${pyStr(dep)}].values for _, g in sub.groupby(${pyStr(grp)})]`,
        'lev_f, lev_p = stats.levene(groups[0], groups[1], center="mean")',
        'print(f"Levene F={lev_f:.4f}, p={lev_p:.4g}")',
        'print("Student t-test:\\n", pg.ttest(groups[0], groups[1], correction=False))',
        'print("Welch t-test:\\n", pg.ttest(groups[0], groups[1], correction=True))',
      ].join('\n');
    }

    case 'paired_t': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        `sub = df[${pyList([var1, var2])}].dropna()`,
        `print(pg.ttest(sub[${pyStr(var1)}], sub[${pyStr(var2)}], paired=True))`,
      ].join('\n');
    }

    case 'oneway_anova': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      const posthoc = asString(p.posthocMethod, 'tukey');
      const posthocCall =
        posthoc === 'bonferroni'
          ? `print(pg.pairwise_tests(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}, padjust="bonf"))`
          : posthoc === 'games_howell'
            ? `print(pg.pairwise_gameshowell(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}))`
            : `print(pg.pairwise_tukey(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}))`;
      return [
        `sub = df[${pyList([dep, factor])}].dropna()`,
        `print(pg.homoscedasticity(data=sub, dv=${pyStr(dep)}, group=${pyStr(factor)}))`,
        `print(pg.anova(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}, detailed=True))`,
        `print(pg.welch_anova(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}))`,
        posthocCall,
      ].join('\n');
    }

    case 'repeated_anova': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        `rm_vars = ${pyList(vars)}`,
        'sub = df[rm_vars].dropna().copy()',
        'sub["subject_id"] = np.arange(len(sub))',
        'long_df = sub.melt(id_vars="subject_id", value_vars=rm_vars, var_name="time", value_name="score")',
        'print(pg.rm_anova(data=long_df, dv="score", within="time", subject="subject_id", detailed=True))',
        'print(pg.pairwise_tests(data=long_df, dv="score", within="time", subject="subject_id", padjust="bonf"))',
      ].join('\n');
    }

    case 'mann_whitney_u': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, []);
      if (groups.length >= 2) {
        return [
          `sub = df[${pyList([dep, grp])}].dropna()`,
          `g1 = sub.loc[sub[${pyStr(grp)}].astype(str) == ${pyStr(groups[0])}, ${pyStr(dep)}]`,
          `g2 = sub.loc[sub[${pyStr(grp)}].astype(str) == ${pyStr(groups[1])}, ${pyStr(dep)}]`,
          'print(pg.mwu(g1, g2))',
        ].join('\n');
      }
      return [
        `sub = df[${pyList([dep, grp])}].dropna()`,
        `groups = [g[${pyStr(dep)}].values for _, g in sub.groupby(${pyStr(grp)})]`,
        'print(pg.mwu(groups[0], groups[1]))',
      ].join('\n');
    }

    case 'wilcoxon': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        `sub = df[${pyList([var1, var2])}].dropna()`,
        `print(pg.wilcoxon(sub[${pyStr(var1)}], sub[${pyStr(var2)}]))`,
      ].join('\n');
    }

    case 'kruskal_wallis': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      return [
        `sub = df[${pyList([dep, factor])}].dropna()`,
        `print(pg.kruskal(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}))`,
        `print(pg.pairwise_tests(data=sub, dv=${pyStr(dep)}, between=${pyStr(factor)}, parametric=False, padjust="bonf"))`,
      ].join('\n');
    }

    case 'friedman': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        `f_vars = ${pyList(vars)}`,
        'sub = df[f_vars].dropna()',
        'stat, p_val = stats.friedmanchisquare(*[sub[c].values for c in f_vars])',
        'kendall_w = stat / (len(sub) * (len(f_vars) - 1))',
        'print(f"Friedman chi2={stat:.4f}, p={p_val:.6g}, Kendall W={kendall_w:.4f}")',
      ].join('\n');
    }

    case 'correlation_test': {
      const vars = asStringArray(p.variables, ['var1', 'var2']);
      const method = asString(p.method, 'pearson') === 'spearman' ? 'spearman' : 'pearson';
      return [
        `cor_vars = ${pyList(vars)}`,
        'sub = df[cor_vars].dropna()',
        `print(pg.rcorr(sub, method=${pyStr(method)}))`,
      ].join('\n');
    }

    case 'partial_correlation_test': {
      const var1 = asString(p.var1, 'var1');
      const var2 = asString(p.var2, 'var2');
      const controls = asStringArray(p.controls, ['ctrl1']);
      return [
        `sub = df[${pyList([var1, var2, ...controls])}].dropna()`,
        `print(pg.partial_corr(data=sub, x=${pyStr(var1)}, y=${pyStr(var2)}, covar=${pyList(controls)}))`,
      ].join('\n');
    }

    case 'chi_square': {
      const rowVar = asString(p.rowVar, 'rowVar');
      const colVar = asString(p.colVar, 'colVar');
      return [
        `sub = df[${pyList([rowVar, colVar])}].dropna()`,
        `ct = pd.crosstab(sub[${pyStr(rowVar)}], sub[${pyStr(colVar)}])`,
        'print(ct)',
        'chi2, p_val, dof, expected = stats.chi2_contingency(ct, correction=False)',
        'n_total = ct.to_numpy().sum()',
        'cramers_v = np.sqrt(chi2 / (n_total * max(1, min(ct.shape) - 1)))',
        'print(f"Chi2({dof})={chi2:.4f}, p={p_val:.6g}, Cramer V={cramers_v:.4f}")',
        'if ct.shape == (2, 2):',
        '    print("Fisher exact:", stats.fisher_exact(ct))',
      ].join('\n');
    }

    case 'reliability': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      return [
        `items = ${pyList(items)}`,
        'sub = df[items].dropna()',
        'alpha, ci = pg.cronbach_alpha(data=sub)',
        'print(f"Cronbach alpha={alpha:.4f}, 95% CI={ci}")',
        'item_total = pd.DataFrame({',
        '    "corrected_item_total_r": [sub[c].corr(sub.drop(columns=[c]).sum(axis=1)) for c in items],',
        '    "alpha_if_deleted": [pg.cronbach_alpha(data=sub.drop(columns=[c]))[0] for c in items],',
        '}, index=items)',
        'print(item_total)',
      ].join('\n');
    }

    case 'efa': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      const nFactors = asNumber(p.nFactors, 1);
      const rotation = asString(p.rotation, 'varimax') === 'none' ? 'None' : '"varimax"';
      const method = asString(p.extraction, 'pca') === 'paf' ? 'pa' : 'principal';
      return [
        `efa_items = ${pyList(items)}`,
        'sub = df[efa_items].dropna()',
        'if FactorAnalyzer is not None:',
        '    chi2_b, p_b = calculate_bartlett_sphericity(sub)',
        '    kmo_all, kmo_model = calculate_kmo(sub)',
        '    print(f"KMO={kmo_model:.4f}, Bartlett chi2={chi2_b:.3f}, p={p_b:.6g}")',
        `    fa = FactorAnalyzer(n_factors=${nFactors}, rotation=${rotation}, method=${pyStr(method)})`,
        '    fa.fit(sub)',
        `    loadings = pd.DataFrame(fa.loadings_, index=efa_items, columns=[f"F{i+1}" for i in range(${nFactors})])`,
        '    print(loadings)',
        'else:',
        '    eigvals, eigvecs = np.linalg.eigh(sub.corr().to_numpy())',
        '    print("Eigenvalues:", np.sort(eigvals)[::-1])',
      ].join('\n');
    }

    case 'rasch': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      return [
        `rasch_items = ${pyList(items)}`,
        'sub = df[rasch_items].dropna()',
        'item_means = sub.mean(axis=0)',
        'p_prop = (item_means - sub.min().min()) / max(1e-6, (sub.max().max() - sub.min().min()))',
        'p_clipped = np.clip(p_prop, 0.01, 0.99)',
        'item_difficulty_logit = -np.log(p_clipped / (1.0 - p_clipped))',
        'rasch_summary = pd.DataFrame({"mean": item_means, "difficulty_logit": item_difficulty_logit - item_difficulty_logit.mean()})',
        'print(rasch_summary)',
      ].join('\n');
    }

    case 'cb_sem': {
      const { factors, paths } = extractSemSpec(p);
      const allIndicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
      const measMapLines = factors.map(
        (f) => `    ${pyStr(f.name)}: ${pyList(f.indicators)},`,
      );
      const pathPairs = paths.map((pt) => `(${pyStr(pt.from)}, ${pyStr(pt.to)})`).join(', ');
      return [
        `sem_indicators = ${pyList(allIndicators)}`,
        'sub = df[sem_indicators].dropna()',
        'factors_map = {',
        ...measMapLines,
        '}',
        `sem_paths = [${pathPairs}]`,
        'latent_df = pd.DataFrame({k: ((sub[v] - sub[v].mean()) / sub[v].std(ddof=1)).mean(axis=1) for k, v in factors_map.items()})',
        'for target in sorted({to_f for _, to_f in sem_paths}):',
        '    preds = [from_f for from_f, to_f in sem_paths if to_f == target]',
        '    X = sm.add_constant(latent_df[preds])',
        '    print(f"\\n--- Structural Path -> {target} ---")',
        '    print(sm.OLS(latent_df[target], X).fit().summary())',
      ].join('\n');
    }

    case 'pls_sem': {
      const { factors, paths } = extractSemSpec(p);
      const boot = asNumber(p.bootstrapSamples, 200);
      const allIndicators = Array.from(new Set(factors.flatMap((f) => f.indicators)));
      const measMapLines = factors.map(
        (f) => `    ${pyStr(f.name)}: ${pyList(f.indicators)},`,
      );
      const pathPairs = paths.map((pt) => `(${pyStr(pt.from)}, ${pyStr(pt.to)})`).join(', ');
      return [
        'rng = np.random.default_rng(421337)',
        `pls_indicators = ${pyList(allIndicators)}`,
        'sub = df[pls_indicators].dropna()',
        'z = (sub - sub.mean()) / sub.std(ddof=1)',
        'factors_map = {',
        ...measMapLines,
        '}',
        `pls_paths = [${pathPairs}]`,
        'lv = pd.DataFrame({k: z[v].mean(axis=1) for k, v in factors_map.items()})',
        'lv = (lv - lv.mean()) / lv.std(ddof=1)',
        'for target in sorted({to_f for _, to_f in pls_paths}):',
        '    preds = [from_f for from_f, to_f in pls_paths if to_f == target]',
        '    fit = sm.OLS(lv[target], sm.add_constant(lv[preds])).fit()',
        '    print(f"\\n--- PLS-SEM Structural R2={fit.rsquared:.4f} -> {target} ---")',
        '    print(fit.params)',
        `print("Bootstrap samples configured:", ${boot})`,
      ].join('\n');
    }

    case 'linear_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      const blocks = extractBlocks(p, predictors);
      const allCols = [outcome, ...predictors];
      const lines = [
        'from statsmodels.stats.outliers_influence import variance_inflation_factor',
        'from statsmodels.stats.stattools import durbin_watson',
        `sub = df[${pyList(allCols)}].dropna()`,
      ];
      let cumulative: string[] = [];
      blocks.forEach((blk, idx) => {
        cumulative = Array.from(new Set([...cumulative, ...blk]));
        const formula = `${pyFormulaTerm(outcome)} ~ ${cumulative.map(pyFormulaTerm).join(' + ')}`;
        lines.push(`fit_m${idx + 1} = smf.ols(${pyStr(formula)}, data=sub).fit()`);
      });
      if (blocks.length > 1) {
        const modelNames = blocks.map((_, i) => `fit_m${i + 1}`).join(', ');
        lines.push(`print(sm.stats.anova_lm(${modelNames}))`);
      }
      const last = `fit_m${blocks.length}`;
      lines.push(
        `print(${last}.summary())`,
        `print("Durbin-Watson:", durbin_watson(${last}.resid))`,
        `X_vif = sm.add_constant(sub[${pyList(predictors)}])`,
        'vifs = {col: variance_inflation_factor(X_vif.values, i + 1) for i, col in enumerate(X_vif.columns[1:])}',
        'print("VIF:", vifs)',
      );
      return lines.join('\n');
    }

    case 'logistic_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      const posClass = p.positiveClass !== undefined && p.positiveClass !== null ? String(p.positiveClass) : '1';
      const formula = `_outcome_bin ~ ${predictors.map(pyFormulaTerm).join(' + ')}`;
      return [
        `sub = df[${pyList([outcome, ...predictors])}].dropna().copy()`,
        `sub["_outcome_bin"] = (sub[${pyStr(outcome)}].astype(str) == ${pyStr(posClass)}).astype(int)`,
        `fit_logit = smf.logit(${pyStr(formula)}, data=sub).fit()`,
        'print(fit_logit.summary())',
        'or_table = pd.DataFrame({"OR": np.exp(fit_logit.params), "CI_low": np.exp(fit_logit.conf_int()[0]), "CI_high": np.exp(fit_logit.conf_int()[1])})',
        'print(or_table)',
      ].join('\n');
    }

    case 'roc_curve': {
      const scoreVar = asString(p.scoreVar, 'score');
      const stateVar = asString(p.stateVar, 'state');
      const posClass = p.positiveClass !== undefined && p.positiveClass !== null ? String(p.positiveClass) : '1';
      return [
        `sub = df[${pyList([scoreVar, stateVar])}].dropna()`,
        `y_true = (sub[${pyStr(stateVar)}].astype(str) == ${pyStr(posClass)}).astype(int).to_numpy()`,
        `scores = sub[${pyStr(scoreVar)}].to_numpy()`,
        'u_stat, _ = stats.mannwhitneyu(scores[y_true == 1], scores[y_true == 0], alternative="two-sided")',
        'auc_val = u_stat / (np.sum(y_true == 1) * np.sum(y_true == 0))',
        'thresholds = np.sort(np.unique(scores))[::-1]',
        'tpr = [np.mean(scores[y_true == 1] >= t) for t in thresholds]',
        'fpr = [np.mean(scores[y_true == 0] >= t) for t in thresholds]',
        'youden_idx = int(np.argmax(np.array(tpr) - np.array(fpr)))',
        'print(f"ROC AUC={auc_val:.4f}, Best Cutoff={thresholds[youden_idx]:.4f}, TPR={tpr[youden_idx]:.3f}, FPR={fpr[youden_idx]:.3f}")',
      ].join('\n');
    }

    case 'bland_altman': {
      const m1 = asString(p.method1, 'method1');
      const m2 = asString(p.method2, 'method2');
      return [
        `sub = df[${pyList([m1, m2])}].dropna()`,
        `diff = sub[${pyStr(m1)}] - sub[${pyStr(m2)}]`,
        'bias = diff.mean()',
        'sd_diff = diff.std(ddof=1)',
        'loa_low, loa_high = bias - 1.96 * sd_diff, bias + 1.96 * sd_diff',
        't_stat, p_val = stats.ttest_1samp(diff, 0.0)',
        'print(f"Bias={bias:.4f}, SD={sd_diff:.4f}, 95% LoA=[{loa_low:.4f}, {loa_high:.4f}], t={t_stat:.3f}, p={p_val:.4g}")',
      ].join('\n');
    }

    case 'kaplan_meier': {
      const timeVar = asString(p.timeVar, 'time');
      const eventVar = asString(p.eventVar, 'event');
      const groupVar = asOptionalString(p.groupVar);
      const cols = groupVar ? [timeVar, eventVar, groupVar] : [timeVar, eventVar];
      return [
        `sub = df[${pyList(cols)}].dropna()`,
        'if KaplanMeierFitter is not None:',
        ...(groupVar
          ? [
              `    for grp, grp_df in sub.groupby(${pyStr(groupVar)}):`,
              '        kmf = KaplanMeierFitter()',
              `        kmf.fit(grp_df[${pyStr(timeVar)}], event_observed=grp_df[${pyStr(eventVar)}], label=str(grp))`,
              '        print(f"Group {grp}: median survival =", kmf.median_survival_time_)',
              `    print(multivariate_logrank_test(sub[${pyStr(timeVar)}], sub[${pyStr(groupVar)}], sub[${pyStr(eventVar)}]))`,
            ]
          : [
              '    kmf = KaplanMeierFitter()',
              `    kmf.fit(sub[${pyStr(timeVar)}], event_observed=sub[${pyStr(eventVar)}])`,
              '    print("Median survival:", kmf.median_survival_time_)',
            ]),
      ].join('\n');
    }

    case 'process_model4': {
      const x = asString(p.x, 'X');
      const m = asString(p.mOrW, 'M');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const boot = asNumber(p.bootstrapSamples, 500);
      const cols = [x, m, y, ...covs];
      return [
        `sub = df[${pyList(cols)}].dropna()`,
        `med = pg.mediation_analysis(data=sub, x=${pyStr(x)}, m=${pyStr(m)}, y=${pyStr(y)}, covar=${covs.length ? pyList(covs) : 'None'}, n_boot=${boot}, seed=918273)`,
        'print(med)',
      ].join('\n');
    }

    case 'process_model1': {
      const x = asString(p.x, 'X');
      const w = asString(p.mOrW, 'W');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const covTerms = covs.length > 0 ? ` + ${covs.map(pyFormulaTerm).join(' + ')}` : '';
      return [
        `sub = df[${pyList([x, w, y, ...covs])}].dropna().copy()`,
        `sub["X_c"] = sub[${pyStr(x)}] - sub[${pyStr(x)}].mean()`,
        `sub["W_c"] = sub[${pyStr(w)}] - sub[${pyStr(w)}].mean()`,
        'sub["XW"] = sub["X_c"] * sub["W_c"]',
        `fit_base = smf.ols(${pyStr(`${pyFormulaTerm(y)} ~ X_c + W_c${covTerms}`)}, data=sub).fit()`,
        `fit_mod = smf.ols(${pyStr(`${pyFormulaTerm(y)} ~ X_c + W_c + XW${covTerms}`)}, data=sub).fit()`,
        'print(sm.stats.anova_lm(fit_base, fit_mod))',
        'print(fit_mod.summary())',
        'sd_w = sub["W_c"].std(ddof=1)',
        'for label, w_val in [("Low (-1 SD)", -sd_w), ("Mean (0)", 0.0), ("High (+1 SD)", sd_w)]:',
        '    slope = fit_mod.params["X_c"] + fit_mod.params["XW"] * w_val',
        '    print(f"Simple slope {label}: {slope:.4f}")',
      ].join('\n');
    }

    case 'power_analysis': {
      const testType = asString(p.testType, 'indep_t');
      const mode = asString(p.mode, 'apriori');
      const alpha = asNumber(p.alpha, 0.05);
      const power = asNumber(p.power, 0.8);
      const d = asNumber(p.effectSize, 0.5);
      const n = asNumber(p.n ?? p.solvedN, 64);
      const groups = asNumber(p.groups, 3);
      const predictors = asNumber(p.predictors, 3);
      const dfVal = asNumber(p.df, 1);
      const tailStr = asNumber(p.tails, 2) === 1 ? 'greater' : 'two-sided';

      if (testType === 'oneway_anova') {
        return mode === 'posthoc'
          ? `print("Achieved power:", pg.power_anova(eta_squared=${d * d / (1 + d * d)}, k=${groups}, n=${Math.max(2, Math.round(n / groups))}, alpha=${alpha}))`
          : `print("Required n per group:", pg.power_anova(eta_squared=${d * d / (1 + d * d)}, k=${groups}, power=${power}, alpha=${alpha}))`;
      }
      if (testType === 'correlation') {
        return mode === 'posthoc'
          ? `print("Achieved power:", pg.power_corr(r=${d}, n=${n}, alpha=${alpha}, alternative=${pyStr(tailStr)}))`
          : `print("Required N:", pg.power_corr(r=${d}, power=${power}, alpha=${alpha}, alternative=${pyStr(tailStr)}))`;
      }
      if (testType === 'linear_regression') {
        return [
          'from statsmodels.stats.power import FTestPower',
          'ft = FTestPower()',
          mode === 'posthoc'
            ? `print("Achieved power:", ft.power(effect_size=${Math.sqrt(d)}, df_num=${predictors}, df_denom=${Math.max(2, n - predictors - 1)}, alpha=${alpha}))`
            : `print("Required df_denom:", ft.solve_power(effect_size=${Math.sqrt(d)}, df_num=${predictors}, power=${power}, alpha=${alpha}))`,
        ].join('\n');
      }
      if (testType === 'chi_square') {
        return mode === 'posthoc'
          ? `print("Achieved power:", pg.power_chi2(dof=${dfVal}, w=${d}, n=${n}, alpha=${alpha}))`
          : `print("Required N:", pg.power_chi2(dof=${dfVal}, w=${d}, power=${power}, alpha=${alpha}))`;
      }
      if (testType === 'proportions_2') {
        return [
          'from statsmodels.stats.power import NormalIndPower',
          'nip = NormalIndPower()',
          mode === 'posthoc'
            ? `print("Achieved power:", nip.power(effect_size=${d}, nobs1=${Math.max(2, Math.round(n / 2))}, alpha=${alpha}, alternative=${pyStr(tailStr === 'greater' ? 'larger' : 'two-sided')}))`
            : `print("Required n per group:", nip.solve_power(effect_size=${d}, power=${power}, alpha=${alpha}, alternative=${pyStr(tailStr === 'greater' ? 'larger' : 'two-sided')}))`,
        ].join('\n');
      }
      const pairedFlag = testType === 'paired_t' ? 'True' : 'False';
      return mode === 'posthoc'
        ? `print("Achieved power:", pg.power_ttest(d=${d}, n=${n}, alpha=${alpha}, paired=${pairedFlag}, alternative=${pyStr(tailStr)}))`
        : `print("Required n:", pg.power_ttest(d=${d}, power=${power}, alpha=${alpha}, paired=${pairedFlag}, alternative=${pyStr(tailStr)}))`;
    }

    default: {
      return [
        `# Generic reproducible inspection for analysisType: ${analysis.analysisType}`,
        'print(df.info())',
        'print(df.describe(include="all"))',
      ].join('\n');
    }
  }
}

function renderSpssBody(analysis: AnalysisOutput): string {
  const p = analysis.params ?? {};
  switch (analysis.analysisType) {
    case 'descriptive_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `DESCRIPTIVES VARIABLES=${spssVars(vars)}`,
        '  /STATISTICS=MEAN STDDEV MIN MAX KURTOSIS SKEWNESS.',
      ].join('\n');
    }

    case 'frequency_table': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `FREQUENCIES VARIABLES=${spssVars(vars)}`,
        '  /ORDER=ANALYSIS.',
      ].join('\n');
    }

    case 'normality_test': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `EXAMINE VARIABLES=${spssVars(vars)}`,
        '  /PLOT NPPLOT',
        '  /STATISTICS DESCRIPTIVES',
        '  /CINTERVAL 95',
        '  /MISSING LISTWISE',
        '  /NOTOTAL.',
      ].join('\n');
    }

    case 'outlier_analysis': {
      const vars = asStringArray(p.variables, ['var1']);
      return [
        `EXAMINE VARIABLES=${spssVars(vars)}`,
        '  /PLOT BOXPLOT',
        '  /STATISTICS EXTREME',
        '  /MISSING LISTWISE.',
      ].join('\n');
    }

    case 'one_sample_t': {
      const variable = asString(p.variable, 'var1');
      const mu = asNumber(p.testValue, 0);
      return [
        'T-TEST',
        `  /TESTVAL=${mu}`,
        '  /MISSING=ANALYSIS',
        `  /VARIABLES=${variable}`,
        '  /ES DISPLAY(TRUE)',
        '  /CRITERIA=CI(.95).',
      ].join('\n');
    }

    case 'independent_t': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, ['1', '2']);
      const g1 = spssVal(groups[0] ?? '1');
      const g2 = spssVal(groups[1] ?? '2');
      return [
        `T-TEST GROUPS=${grp}(${g1} ${g2})`,
        '  /MISSING=ANALYSIS',
        `  /VARIABLES=${dep}`,
        '  /ES DISPLAY(TRUE)',
        '  /CRITERIA=CI(.95).',
      ].join('\n');
    }

    case 'paired_t': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        `T-TEST PAIRS=${var1} WITH ${var2} (PAIRED)`,
        '  /ES DISPLAY(TRUE)',
        '  /CRITERIA=CI(.9500)',
        '  /MISSING=ANALYSIS.',
      ].join('\n');
    }

    case 'oneway_anova': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      const posthoc = asString(p.posthocMethod, 'tukey');
      const phKeyword =
        posthoc === 'bonferroni' ? 'BONFERRONI' : posthoc === 'games_howell' ? 'GH' : 'TUKEY';
      return [
        `ONEWAY ${dep} BY ${factor}`,
        '  /STATISTICS DESCRIPTIVES HOMOGENEITY WELCH',
        '  /MISSING ANALYSIS',
        `  /POSTHOC=${phKeyword} ALPHA(0.05).`,
      ].join('\n');
    }

    case 'repeated_anova': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        `GLM ${spssVars(vars)}`,
        `  /WSFACTOR=Time ${vars.length} Polynomial`,
        '  /METHOD=SSTYPE(3)',
        '  /PRINT=DESCRIPTIVE ETASQ',
        '  /CRITERIA=ALPHA(.05)',
        '  /WSDESIGN=Time.',
      ].join('\n');
    }

    case 'mann_whitney_u': {
      const dep = asString(p.dependent, 'outcome');
      const grp = asString(p.groupVar, 'group');
      const groups = asStringArray(p.groups, ['1', '2']);
      const g1 = spssVal(groups[0] ?? '1');
      const g2 = spssVal(groups[1] ?? '2');
      return [
        'NPAR TESTS',
        `  /M-W= ${dep} BY ${grp}(${g1} ${g2})`,
        '  /MISSING ANALYSIS.',
      ].join('\n');
    }

    case 'wilcoxon': {
      const var1 = asString(p.var1, 'pre');
      const var2 = asString(p.var2, 'post');
      return [
        'NPAR TESTS',
        `  /WILCOXON=${var1} WITH ${var2} (PAIRED)`,
        '  /MISSING ANALYSIS.',
      ].join('\n');
    }

    case 'kruskal_wallis': {
      const dep = asString(p.dependent, 'outcome');
      const factor = asString(p.factor, 'factor');
      return [
        `* Classical NPAR TESTS syntax (update factor min/max codes if string-coded, or use NPTESTS below).`,
        `NPTESTS`,
        `  /INDEPENDENT TEST (${dep}) GROUP (${factor}) KRUSKAL_WALLIS(COMPARE=PAIRWISE)`,
        '  /MISSING SCOPE=ANALYSIS USERMISSING=EXCLUDE.',
      ].join('\n');
    }

    case 'friedman': {
      const vars = asStringArray(p.variables, ['t1', 't2', 't3']);
      return [
        'NPAR TESTS',
        `  /FRIEDMAN=${spssVars(vars)}`,
        '  /MISSING LISTWISE.',
      ].join('\n');
    }

    case 'correlation_test': {
      const vars = asStringArray(p.variables, ['var1', 'var2']);
      const method = asString(p.method, 'pearson');
      if (method === 'spearman') {
        return [
          'NONPAR CORR',
          `  /VARIABLES=${spssVars(vars)}`,
          '  /PRINT=SPEARMAN TWOTAIL NOSIG',
          '  /MISSING=PAIRWISE.',
        ].join('\n');
      }
      return [
        'CORRELATIONS',
        `  /VARIABLES=${spssVars(vars)}`,
        '  /PRINT=TWOTAIL NOSIG FULL',
        '  /MISSING=PAIRWISE.',
      ].join('\n');
    }

    case 'partial_correlation_test': {
      const var1 = asString(p.var1, 'var1');
      const var2 = asString(p.var2, 'var2');
      const controls = asStringArray(p.controls, ['ctrl1']);
      return [
        'PARTIAL CORR',
        `  /VARIABLES=${var1} ${var2} BY ${spssVars(controls)}`,
        '  /SIGNIFICANCE=TWOTAIL',
        '  /MISSING=LISTWISE.',
      ].join('\n');
    }

    case 'chi_square': {
      const rowVar = asString(p.rowVar, 'rowVar');
      const colVar = asString(p.colVar, 'colVar');
      return [
        'CROSSTABS',
        `  /TABLES=${rowVar} BY ${colVar}`,
        '  /FORMAT=AVALUE TABLES',
        '  /STATISTICS=CHISQ PHI',
        '  /CELLS=COUNT EXPECTED ROW COLUMN',
        '  /COUNT ROUND CELL.',
      ].join('\n');
    }

    case 'reliability': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      return [
        'RELIABILITY',
        `  /VARIABLES=${spssVars(items)}`,
        "  /SCALE('ALL VARIABLES') ALL",
        '  /MODEL=ALPHA',
        '  /STATISTICS=DESCRIPTIVE SCALE CORR',
        '  /SUMMARY=TOTAL.',
      ].join('\n');
    }

    case 'efa': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      const nFactors = asNumber(p.nFactors, 1);
      const rotation = asString(p.rotation, 'varimax') === 'none' ? 'NOROTATE' : 'VARIMAX';
      const extraction = asString(p.extraction, 'pca') === 'paf' ? 'PAF' : 'PC';
      return [
        'FACTOR',
        `  /VARIABLES ${spssVars(items)}`,
        '  /MISSING LISTWISE',
        `  /ANALYSIS ${spssVars(items)}`,
        '  /PRINT INITIAL KMO EXTRACTION ROTATION',
        `  /CRITERIA FACTORS(${nFactors}) ITERATE(25)`,
        `  /EXTRACTION ${extraction}`,
        `  /ROTATION ${rotation}.`,
      ].join('\n');
    }

    case 'rasch': {
      const items = asStringArray(p.items, ['item1', 'item2', 'item3']);
      return [
        '* SPSS native syntax computes Rasch raw sum scores; full JMLE/MML calibration uses R/Python Extensions.',
        `COMPUTE Rasch_RawTotal = SUM(${items.join(', ')}).`,
        'EXECUTE.',
        `DESCRIPTIVES VARIABLES=${spssVars(items)} Rasch_RawTotal`,
        '  /STATISTICS=MEAN STDDEV MIN MAX.',
      ].join('\n');
    }

    case 'cb_sem': {
      const { factors, paths } = extractSemSpec(p);
      const allInds = Array.from(new Set(factors.flatMap((f) => f.indicators)));
      const notes = [
        ...factors.map((f) => `* Latent ${f.name}: ${f.indicators.join(' + ')}.`),
        ...paths.map((pt) => `* Structural Path: ${pt.from} -> ${pt.to}.`),
      ];
      return [
        '* CB-SEM Measurement & Covariance Matrix Preparation (AMOS / R lavaan plugin):',
        ...notes,
        `CORRELATIONS /VARIABLES=${spssVars(allInds)}`,
        '  /MATRIX=OUT(*).',
      ].join('\n');
    }

    case 'pls_sem': {
      const { factors, paths } = extractSemSpec(p);
      const lines = ['* PLS-SEM Composite Score Approximation in SPSS:'];
      for (const f of factors) {
        const scoreVar = `PLS_${sanitizeLavaanName(f.name)}`;
        lines.push(`COMPUTE ${scoreVar} = MEAN(${f.indicators.join(', ')}).`);
      }
      lines.push('EXECUTE.');
      const targetMap = new Map<string, string[]>();
      for (const pt of paths) {
        const list = targetMap.get(pt.to) ?? [];
        list.push(pt.from);
        targetMap.set(pt.to, list);
      }
      for (const [toF, fromFs] of targetMap.entries()) {
        const dep = `PLS_${sanitizeLavaanName(toF)}`;
        const preds = fromFs.map((f) => `PLS_${sanitizeLavaanName(f)}`).join(' ');
        lines.push(
          'REGRESSION',
          '  /STATISTICS COEFF OUTS R ANOVA',
          `  /DEPENDENT ${dep}`,
          `  /METHOD=ENTER ${preds}.`,
        );
      }
      return lines.join('\n');
    }

    case 'linear_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      const blocks = extractBlocks(p, predictors);
      const methodLines = blocks.map((blk) => `  /METHOD=ENTER ${spssVars(blk)}`);
      return [
        'REGRESSION',
        '  /MISSING LISTWISE',
        '  /STATISTICS COEFF OUTS CI(95) R ANOVA COLLIN TOL CHANGE',
        '  /CRITERIA=PIN(.05) POUT(.10)',
        `  /DEPENDENT ${outcome}`,
        ...methodLines,
        '  /RESIDUALS DURBIN.',
      ].join('\n');
    }

    case 'logistic_regression': {
      const outcome = asString(p.outcome, 'y');
      const predictors = asStringArray(p.predictors, ['x1']);
      return [
        `LOGISTIC REGRESSION VARIABLES ${outcome}`,
        `  /METHOD=ENTER ${spssVars(predictors)}`,
        '  /PRINT=CI(95)',
        '  /CRITERIA=PIN(0.05) POUT(0.10) ITERATE(20) CUT(0.5).',
      ].join('\n');
    }

    case 'roc_curve': {
      const scoreVar = asString(p.scoreVar, 'score');
      const stateVar = asString(p.stateVar, 'state');
      const posVal = spssVal(
        p.positiveClass !== undefined && p.positiveClass !== null ? String(p.positiveClass) : '1',
      );
      return [
        `ROC ${scoreVar} BY ${stateVar} (${posVal})`,
        '  /PLOT=CURVE(REFERENCE)',
        '  /PRINT=SE COORDINATES',
        '  /CRITERIA=CUTOFF(INCLUDE) TESTPOS(LARGE) DISTRIBUTION(FREE) CI(95)',
        '  /MISSING=EXCLUDE.',
      ].join('\n');
    }

    case 'bland_altman': {
      const m1 = asString(p.method1, 'method1');
      const m2 = asString(p.method2, 'method2');
      return [
        `COMPUTE BA_Mean = (${m1} + ${m2}) / 2.`,
        `COMPUTE BA_Diff = ${m1} - ${m2}.`,
        'EXECUTE.',
        'DESCRIPTIVES VARIABLES=BA_Diff BA_Mean',
        '  /STATISTICS=MEAN STDDEV MIN MAX.',
        'T-TEST /TESTVAL=0 /VARIABLES=BA_Diff.',
      ].join('\n');
    }

    case 'kaplan_meier': {
      const timeVar = asString(p.timeVar, 'time');
      const eventVar = asString(p.eventVar, 'event');
      const groupVar = asOptionalString(p.groupVar);
      return [
        groupVar ? `KM ${timeVar} BY ${groupVar}` : `KM ${timeVar}`,
        `  /STATUS=${eventVar}(1)`,
        '  /PRINT TABLE MEAN',
        ...(groupVar ? ['  /TEST LOGRANK.'] : ['  /CRITERIA=ALPHA(0.05).']),
      ].join('\n');
    }

    case 'process_model4': {
      const x = asString(p.x, 'X');
      const m = asString(p.mOrW, 'M');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const boot = asNumber(p.bootstrapSamples, 500);
      const covOpt = covs.length > 0 ? ` /cov=${spssVars(covs)}` : '';
      return [
        '* Requires Hayes PROCESS macro installed in SPSS:',
        `PROCESS y=${y} /x=${x} /m=${m}${covOpt} /model=4 /boot=${boot} /seed=918273.`,
        '* Classical OLS path equations (Baron & Kenny steps):',
        `REGRESSION /DEPENDENT ${m} /METHOD=ENTER ${x} ${spssVars(covs)}.`,
        `REGRESSION /DEPENDENT ${y} /METHOD=ENTER ${x} ${m} ${spssVars(covs)}.`,
      ].join('\n');
    }

    case 'process_model1': {
      const x = asString(p.x, 'X');
      const w = asString(p.mOrW, 'W');
      const y = asString(p.y, 'Y');
      const covs = asStringArray(p.covariates, []);
      const covOpt = covs.length > 0 ? ` /cov=${spssVars(covs)}` : '';
      return [
        '* Requires Hayes PROCESS macro installed in SPSS:',
        `PROCESS y=${y} /x=${x} /w=${w}${covOpt} /model=1 /center=1 /plot=1.`,
      ].join('\n');
    }

    case 'power_analysis': {
      const testType = asString(p.testType, 'indep_t');
      const alpha = asNumber(p.alpha, 0.05);
      const power = asNumber(p.power, 0.8);
      const d = asNumber(p.effectSize, 0.5);
      const groups = asNumber(p.groups, 3);
      const predictors = asNumber(p.predictors, 3);
      if (testType === 'oneway_anova') {
        return [
          'POWER ONEWAY ANOVA',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} EFFECT_SIZE=${d} GROUPS=${groups}.`,
        ].join('\n');
      }
      if (testType === 'correlation') {
        return [
          'POWER PEARSON ONESAMPLE',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} CORRELATION=${d}.`,
        ].join('\n');
      }
      if (testType === 'linear_regression') {
        return [
          'POWER REGRESSION',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} RSQUARE=${(d / (1 + d)).toFixed(3)} TOTAL_PREDICTORS=${predictors}.`,
        ].join('\n');
      }
      if (testType === 'paired_t') {
        return [
          'POWER MEANS RELATED',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} MEAN_DIFF=${d} SD=1.`,
        ].join('\n');
      }
      if (testType === 'one_sample_t') {
        return [
          'POWER MEANS ONESAMPLE',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} MEAN=${d} SD=1.`,
        ].join('\n');
      }
      if (testType === 'proportions_2') {
        return [
          'POWER PROPORTIONS INDEPENDENT',
          `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} PROPORTIONS=0.5 0.35.`,
        ].join('\n');
      }
      return [
        'POWER MEANS INDEPENDENT',
        `  /PARAMETERS SIGNIFICANCE=${alpha} POWER=${power} MEAN_DIFF=${d} SD=1.`,
      ].join('\n');
    }

    default: {
      return [
        `* Generic SPSS inspection for analysisType: ${analysis.analysisType}.`,
        'DISPLAY DICTIONARY.',
      ].join('\n');
    }
  }
}

function renderAnalysisSection(analysis: AnalysisOutput, format: ScriptFormat, index?: number): string {
  const prefix = index !== undefined ? `[${index}] ` : '';
  const titleLine = `${prefix}${analysis.title} (${analysis.analysisType})`;
  if (format === 'spss_syntax') {
    return [`* === ${titleLine} ===.`, renderSpssBody(analysis)].join('\n');
  }
  const body = format === 'r' ? renderRBody(analysis) : renderPythonBody(analysis);
  return [`# === ${titleLine} ===`, body].join('\n');
}

export function generateReproducibleScript(
  analysis: AnalysisOutput,
  datasetName: string,
  format: ScriptFormat,
): string {
  const commentPrefix = format === 'spss_syntax' ? '*' : '#';
  const metaComment = `${commentPrefix} Analysis: ${analysis.title} [${analysis.analysisType}]`;
  const header = buildScriptHeader(datasetName, format, metaComment);
  const body = renderAnalysisSection(analysis, format);
  return `${header}\n\n${body}\n`;
}

export function generateCombinedScript(
  history: AnalysisOutput[],
  datasetName: string,
  format: ScriptFormat,
): string {
  const commentPrefix = format === 'spss_syntax' ? '*' : '#';
  const metaComment = `${commentPrefix} Combined Workflow: ${history.length} analyses`;
  const header = buildScriptHeader(datasetName, format, metaComment);

  if (history.length === 0) {
    const emptyNote =
      format === 'spss_syntax'
        ? '* No analyses recorded yet in this Hypotheca session.'
        : '# No analyses recorded yet in this Hypotheca session.';
    return `${header}\n\n${emptyNote}\n`;
  }

  const sections = history.map((item, idx) => renderAnalysisSection(item, format, idx + 1));
  return `${header}\n\n${sections.join('\n\n')}\n`;
}
