# Hypotheca

A source-available statistics workbench for academic research that runs entirely in the browser. The interface is available in Turkish and English.

Tarayıcıda çalışan, kaynak kodu incelemeye ve akademik/ticari olmayan kullanıma açık istatistik uygulaması. Arayüz Türkçe ve İngilizcedir.

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-2E6194.svg)](LICENSE) [![Live Demo](https://img.shields.io/badge/Demo-Cloudflare-F38020.svg)](https://hypotheca.muammer-b28.workers.dev)

**Live Demo / Canlı Önizleme:** [https://hypotheca.muammer-b28.workers.dev](https://hypotheca.muammer-b28.workers.dev) *(örnek veri setleri yüklü gelir; tüm analizler tarayıcınızda yerel çalışır / preloaded with sample datasets; all analyses run locally in your browser)*

## Overview

- All computations are implemented in TypeScript and run locally. Datasets are not uploaded to a server.
- Results are produced from the numbers alone; report text, test recommendations and generated scripts are rule-based and reproducible.
- Output tables follow APA 7 conventions and can be exported to Word, Excel, LaTeX and Quarto.

## Analyses

- **Descriptives and assumptions:** descriptives, frequencies, normality tests (Shapiro-Wilk, Kolmogorov-Smirnov), outlier checks.
- **Group comparisons:** one-sample, independent and paired t tests; one-way ANOVA with Welch, Brown-Forsythe and post hoc tests; repeated measures ANOVA with sphericity corrections.
- **Nonparametric tests:** Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis with Dunn, Friedman.
- **Association:** Pearson and Spearman correlation, partial correlation, chi-square and Fisher's exact test.
- **Scales and psychometrics:** reliability (Cronbach's alpha, ICC and related statistics), exploratory factor analysis, Rasch model, CB-SEM/CFA, PLS-SEM.
- **Regression and clinical:** linear and hierarchical regression, binary logistic regression, ROC curves, Bland-Altman, Kaplan-Meier with log-rank.
- **Mediation, moderation and power:** PROCESS models 1, 4, 6, 7 and 14; power analysis for common designs.
- **Advanced:** meta-analysis (fixed and random effects), measurement invariance and second-order CFA, linear mixed models, propensity score matching, Bayesian t test, ANOVA and correlation.

Numerical results are checked against reference datasets and published values in the test suite (`npx vitest run`).

## Modules

| Folder | Purpose |
| --- | --- |
| `src/engine/` | Statistical engine and numerical routines |
| `src/project/` | Step-by-step study project workflow and browser persistence |
| `src/modules/autopilot/` | Assumption checks and test recommendation |
| `src/modules/advanced-stats/` | Meta-analysis, PROCESS, invariance, mixed models, Bayesian tests |
| `src/modules/publication/` | APA draft, references, Word/Excel/LaTeX/Quarto export |
| `src/modules/reproducibility/` | R, Python and SPSS script generation, OSF package |
| `src/modules/privacy-runtime/` | Background computation, local storage, encrypted export, on-premise Docker/Nginx config |
| `src/modules/survey-collab/` | Survey cleaning (text Likert to numbers, reverse coding, straight-liners) and advisor notes |

## Getting started

```bash
git clone https://github.com/Clonify-Labs/hypotheca.git
cd hypotheca
npm install

npx vitest run   # tests
npm run dev      # development server
npm run build    # static production build
```

## License / Lisans

- **Noncommercial & Academic Use (Free):** Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) (see also [NOTICE](NOTICE)). Researchers, students, universities, educational institutions, and non-profit organizations may view, use, and modify the software free of charge for noncommercial purposes.
- **Commercial Restriction (No Resale / No SaaS):** Selling, commercial redistribution, white-labeling, paid SaaS/cloud hosting, or for-profit commercial use of this software or derivative works is strictly prohibited without a commercial license.
- **Commercial Licensing / Ticari Lisans:** Copyright (c) 2026 Muammer Tiryaki & Clonify Labs Mühendislik San. ve Tic. A.Ş. ([clonifylabs.com](https://clonifylabs.com)) - Contact `muammer@clonifylabs.com`.
