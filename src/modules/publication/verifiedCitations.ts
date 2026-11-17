import { AnalysisOutput } from '../../types/interfaces';

export interface VerifiedReference {
  key: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  doi: string;
  apa7: string;
  bibtex: string;
  tags: string[];
  verifiedSource: 'local_curated' | 'crossref_api';
}

export const VERIFIED_CITATIONS: VerifiedReference[] = [
  {
    key: 'cohen1988',
    authors: 'Cohen, J.',
    year: 1988,
    title: 'Statistical power analysis for the behavioral sciences (2nd ed.)',
    journal: 'Routledge / Lawrence Erlbaum Associates',
    doi: '10.4324/9780203771587',
    apa7: 'Cohen, J. (1988). Statistical power analysis for the behavioral sciences (2nd ed.). Lawrence Erlbaum Associates. https://doi.org/10.4324/9780203771587',
    bibtex: `@book{cohen1988,\n  author = {Cohen, Jacob},\n  title = {Statistical Power Analysis for the Behavioral Sciences},\n  edition = {2nd},\n  year = {1988},\n  publisher = {Lawrence Erlbaum Associates},\n  doi = {10.4324/9780203771587}\n}`,
    tags: ['effect_size', 'power', 't_test', 'anova', 'regression', 'correlation', 'cohen_d'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'faul2007',
    authors: 'Faul, F., Erdfelder, E., Lang, A.-G., & Buchner, A.',
    year: 2007,
    title: 'G*Power 3: A flexible statistical power analysis program for the social, behavioral, and biomedical sciences',
    journal: 'Behavior Research Methods, 39(2), 175–191',
    doi: '10.3758/BF03193146',
    apa7: 'Faul, F., Erdfelder, E., Lang, A.-G., & Buchner, A. (2007). G*Power 3: A flexible statistical power analysis program for the social, behavioral, and biomedical sciences. Behavior Research Methods, 39(2), 175–191. https://doi.org/10.3758/BF03193146',
    bibtex: `@article{faul2007,\n  author = {Faul, Franz and Erdfelder, Edgar and Lang, Albert-Georg and Buchner, Axel},\n  title = {G*Power 3: A flexible statistical power analysis program for the social, behavioral, and biomedical sciences},\n  journal = {Behavior Research Methods},\n  year = {2007},\n  volume = {39},\n  number = {2},\n  pages = {175--191},\n  doi = {10.3758/BF03193146}\n}`,
    tags: ['power_analysis', 'gpower', 'sample_size', 'a_priori', 'post_hoc'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'shapiro1965',
    authors: 'Shapiro, S. S., & Wilk, M. B.',
    year: 1965,
    title: 'An analysis of variance test for normality (complete samples)',
    journal: 'Biometrika, 52(3–4), 591–611',
    doi: '10.1093/biomet/52.3-4.591',
    apa7: 'Shapiro, S. S., & Wilk, M. B. (1965). An analysis of variance test for normality (complete samples). Biometrika, 52(3–4), 591–611. https://doi.org/10.1093/biomet/52.3-4.591',
    bibtex: `@article{shapiro1965,\n  author = {Shapiro, S. S. and Wilk, M. B.},\n  title = {An analysis of variance test for normality (complete samples)},\n  journal = {Biometrika},\n  year = {1965},\n  volume = {52},\n  number = {3-4},\n  pages = {591--611},\n  doi = {10.1093/biomet/52.3-4.591}\n}`,
    tags: ['normality', 'shapiro_wilk', 'assumption'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'royston1995',
    authors: 'Royston, P.',
    year: 1995,
    title: 'Remark AS R94: A remark on Algorithm AS 181: The W-test for normality',
    journal: 'Journal of the Royal Statistical Society: Series C (Applied Statistics), 44(4), 547–551',
    doi: '10.2307/2986146',
    apa7: 'Royston, P. (1995). Remark AS R94: A remark on Algorithm AS 181: The W-test for normality. Journal of the Royal Statistical Society: Series C (Applied Statistics), 44(4), 547–551. https://doi.org/10.2307/2986146',
    bibtex: `@article{royston1995,\n  author = {Royston, Patrick},\n  title = {Remark {AS R94}: A remark on {Algorithm AS 181}: The {W}-test for normality},\n  journal = {Journal of the Royal Statistical Society: Series C (Applied Statistics)},\n  year = {1995},\n  volume = {44},\n  number = {4},\n  pages = {547--551},\n  doi = {10.2307/2986146}\n}`,
    tags: ['normality', 'shapiro_wilk', 'royston', 'as_r94'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'welch1947',
    authors: 'Welch, B. L.',
    year: 1947,
    title: "The generalization of 'Student's' problem when several different population variances are involved",
    journal: 'Biometrika, 34(1–2), 28–35',
    doi: '10.1093/biomet/34.1-2.28',
    apa7: "Welch, B. L. (1947). The generalization of 'Student's' problem when several different population variances are involved. Biometrika, 34(1–2), 28–35. https://doi.org/10.1093/biomet/34.1-2.28",
    bibtex: `@article{welch1947,\n  author = {Welch, B. L.},\n  title = {The generalization of \`{S}tudent's' problem when several different population variances are involved},\n  journal = {Biometrika},\n  year = {1947},\n  volume = {34},\n  number = {1-2},\n  pages = {28--35},\n  doi = {10.1093/biomet/34.1-2.28}\n}`,
    tags: ['t_test', 'welch', 'heteroscedasticity', 'anova'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'levene1960',
    authors: 'Levene, H.',
    year: 1960,
    title: 'Robust tests for equality of variances',
    journal: 'In I. Olkin et al. (Eds.), Contributions to Probability and Statistics (pp. 278–292). Stanford University Press',
    doi: 'ISBN:9780804700290',
    apa7: 'Levene, H. (1960). Robust tests for equality of variances. In I. Olkin, S. G. Ghurye, W. Hoeffding, W. G. Madow, & H. B. Mann (Eds.), Contributions to probability and statistics: Essays in honor of Harold Hotelling (pp. 278–292). Stanford University Press.',
    bibtex: `@incollection{levene1960,\n  author = {Levene, Howard},\n  title = {Robust tests for equality of variances},\n  booktitle = {Contributions to Probability and Statistics: Essays in Honor of Harold Hotelling},\n  editor = {Olkin, Ingram and Ghurye, Sudhish G. and Hoeffding, Wassily and Madow, William G. and Mann, Henry B.},\n  year = {1960},\n  pages = {278--292},\n  publisher = {Stanford University Press},\n  isbn = {9780804700290}\n}`,
    tags: ['homogeneity', 'levene', 'variance', 'assumption', 't_test', 'anova'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'cronbach1951',
    authors: 'Cronbach, L. J.',
    year: 1951,
    title: 'Coefficient alpha and the internal structure of tests',
    journal: 'Psychometrika, 16(3), 297–334',
    doi: '10.1007/BF02310555',
    apa7: 'Cronbach, L. J. (1951). Coefficient alpha and the internal structure of tests. Psychometrika, 16(3), 297–334. https://doi.org/10.1007/BF02310555',
    bibtex: `@article{cronbach1951,\n  author = {Cronbach, Lee J.},\n  title = {Coefficient alpha and the internal structure of tests},\n  journal = {Psychometrika},\n  year = {1951},\n  volume = {16},\n  number = {3},\n  pages = {297--334},\n  doi = {10.1007/BF02310555}\n}`,
    tags: ['reliability', 'cronbach_alpha', 'internal_consistency', 'psychometrics'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'shrout1979',
    authors: 'Shrout, P. E., & Fleiss, J. L.',
    year: 1979,
    title: 'Intraclass correlations: Uses in assessing rater reliability',
    journal: 'Psychological Bulletin, 86(2), 420–428',
    doi: '10.1037/0033-2909.86.2.420',
    apa7: 'Shrout, P. E., & Fleiss, J. L. (1979). Intraclass correlations: Uses in assessing rater reliability. Psychological Bulletin, 86(2), 420–428. https://doi.org/10.1037/0033-2909.86.2.420',
    bibtex: `@article{shrout1979,\n  author = {Shrout, Patrick E. and Fleiss, Joseph L.},\n  title = {Intraclass correlations: Uses in assessing rater reliability},\n  journal = {Psychological Bulletin},\n  year = {1979},\n  volume = {86},\n  number = {2},\n  pages = {420--428},\n  doi = {10.1037/0033-2909.86.2.420}\n}`,
    tags: ['reliability', 'icc', 'rater_reliability'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'kaiser1974',
    authors: 'Kaiser, H. F.',
    year: 1974,
    title: 'An index of factorial simplicity',
    journal: 'Psychometrika, 39(1), 31–36',
    doi: '10.1007/BF02291575',
    apa7: 'Kaiser, H. F. (1974). An index of factorial simplicity. Psychometrika, 39(1), 31–36. https://doi.org/10.1007/BF02291575',
    bibtex: `@article{kaiser1974,\n  author = {Kaiser, Henry F.},\n  title = {An index of factorial simplicity},\n  journal = {Psychometrika},\n  year = {1974},\n  volume = {39},\n  number = {1},\n  pages = {31--36},\n  doi = {10.1007/BF02291575}\n}`,
    tags: ['efa', 'kmo', 'factor_analysis', 'sampling_adequacy'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'bartlett1954',
    authors: 'Bartlett, M. S.',
    year: 1954,
    title: 'A note on the multiplying factors for various chi-square approximations',
    journal: 'British Journal of Statistical Psychology / JRSS-B, 16(2), 296–298',
    doi: '10.1111/j.2044-8317.1954.tb00144.x',
    apa7: 'Bartlett, M. S. (1954). A note on the multiplying factors for various χ² approximations. British Journal of Statistical Psychology / Journal of the Royal Statistical Society: Series B, 16(2), 296–298. https://doi.org/10.1111/j.2044-8317.1954.tb00144.x',
    bibtex: `@article{bartlett1954,\n  author = {Bartlett, M. S.},\n  title = {A note on the multiplying factors for various chi-square approximations},\n  journal = {British Journal of Statistical Psychology},\n  year = {1954},\n  doi = {10.1111/j.2044-8317.1954.tb00144.x}\n}`,
    tags: ['efa', 'bartlett', 'sphericity', 'factor_analysis'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'hu1999',
    authors: 'Hu, L., & Bentler, P. M.',
    year: 1999,
    title: 'Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives',
    journal: 'Structural Equation Modeling: A Multidisciplinary Journal, 6(1), 1–55',
    doi: '10.1080/10705519909540118',
    apa7: 'Hu, L., & Bentler, P. M. (1999). Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives. Structural Equation Modeling: A Multidisciplinary Journal, 6(1), 1–55. https://doi.org/10.1080/10705519909540118',
    bibtex: `@article{hu1999,\n  author = {Hu, Li-tze and Bentler, Peter M.},\n  title = {Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives},\n  journal = {Structural Equation Modeling: A Multidisciplinary Journal},\n  year = {1999},\n  volume = {6},\n  number = {1},\n  pages = {1--55},\n  doi = {10.1080/10705519909540118}\n}`,
    tags: ['cb_sem', 'cfa', 'sem', 'cfi', 'tli', 'rmsea', 'srmr', 'fit_indices'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'fornell1981',
    authors: 'Fornell, C., & Larcker, D. F.',
    year: 1981,
    title: 'Evaluating structural equation models with unobservable variables and measurement error',
    journal: 'Journal of Marketing Research, 18(1), 39–50',
    doi: '10.1177/002224378101800104',
    apa7: 'Fornell, C., & Larcker, D. F. (1981). Evaluating structural equation models with unobservable variables and measurement error. Journal of Marketing Research, 18(1), 39–50. https://doi.org/10.1177/002224378101800104',
    bibtex: `@article{fornell1981,\n  author = {Fornell, Claes and Larcker, David F.},\n  title = {Evaluating structural equation models with unobservable variables and measurement error},\n  journal = {Journal of Marketing Research},\n  year = {1981},\n  volume = {18},\n  number = {1},\n  pages = {39--50},\n  doi = {10.1177/002224378101800104}\n}`,
    tags: ['sem', 'cb_sem', 'pls_sem', 'ave', 'discriminant_validity'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'henseler2015',
    authors: 'Henseler, J., Ringle, C. M., & Sarstedt, M.',
    year: 2015,
    title: 'A new criterion for assessing discriminant validity in variance-based structural equation modeling',
    journal: 'Journal of the Academy of Marketing Science, 43(1), 115–135',
    doi: '10.1007/s11747-014-0403-8',
    apa7: 'Henseler, J., Ringle, C. M., & Sarstedt, M. (2015). A new criterion for assessing discriminant validity in variance-based structural equation modeling. Journal of the Academy of Marketing Science, 43(1), 115–135. https://doi.org/10.1007/s11747-014-0403-8',
    bibtex: `@article{henseler2015,\n  author = {Henseler, J{\\"o}rg and Ringle, Christian M. and Sarstedt, Marko},\n  title = {A new criterion for assessing discriminant validity in variance-based structural equation modeling},\n  journal = {Journal of the Academy of Marketing Science},\n  year = {2015},\n  volume = {43},\n  number = {1},\n  pages = {115--135},\n  doi = {10.1007/s11747-014-0403-8}\n}`,
    tags: ['pls_sem', 'htmt', 'discriminant_validity'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'hair2019',
    authors: 'Hair, J. F., Risher, J. J., Sarstedt, M., & Ringle, C. M.',
    year: 2019,
    title: 'When to use and how to report the results of PLS-SEM',
    journal: 'European Business Review, 31(1), 2–24',
    doi: '10.1108/EBR-11-2018-0203',
    apa7: 'Hair, J. F., Risher, J. J., Sarstedt, M., & Ringle, C. M. (2019). When to use and how to report the results of PLS-SEM. European Business Review, 31(1), 2–24. https://doi.org/10.1108/EBR-11-2018-0203',
    bibtex: `@article{hair2019,\n  author = {Hair, Joseph F. and Risher, Jeffrey J. and Sarstedt, Marko and Ringle, Christian M.},\n  title = {When to use and how to report the results of {PLS-SEM}},\n  journal = {European Business Review},\n  year = {2019},\n  volume = {31},\n  number = {1},\n  pages = {2--24},\n  doi = {10.1108/EBR-11-2018-0203}\n}`,
    tags: ['pls_sem', 'structural_equation', 'cr', 'ave', 'bootstrap'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'hayes2022',
    authors: 'Hayes, A. F.',
    year: 2022,
    title: 'Introduction to mediation, moderation, and conditional process analysis: A regression-based approach (3rd ed.)',
    journal: 'Guilford Press',
    doi: 'ISBN:9781462549030',
    apa7: 'Hayes, A. F. (2022). Introduction to mediation, moderation, and conditional process analysis: A regression-based approach (3rd ed.). Guilford Press.',
    bibtex: `@book{hayes2022,\n  author = {Hayes, Andrew F.},\n  title = {Introduction to Mediation, Moderation, and Conditional Process Analysis: A Regression-Based Approach},\n  edition = {3rd},\n  year = {2022},\n  publisher = {Guilford Press},\n  isbn = {9781462549030}\n}`,
    tags: ['process', 'mediation', 'moderation', 'process_model4', 'process_model1'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'dersimonian1986',
    authors: 'DerSimonian, R., & Laird, N.',
    year: 1986,
    title: 'Meta-analysis in clinical trials',
    journal: 'Controlled Clinical Trials, 7(3), 177–188',
    doi: '10.1016/0197-2456(86)90046-2',
    apa7: 'DerSimonian, R., & Laird, N. (1986). Meta-analysis in clinical trials. Controlled Clinical Trials, 7(3), 177–188. https://doi.org/10.1016/0197-2456(86)90046-2',
    bibtex: `@article{dersimonian1986,\n  author = {DerSimonian, Rebecca and Laird, Nan},\n  title = {Meta-analysis in clinical trials},\n  journal = {Controlled Clinical Trials},\n  year = {1986},\n  volume = {7},\n  number = {3},\n  pages = {177--188},\n  doi = {10.1016/0197-2456(86)90046-2}\n}`,
    tags: ['meta_analysis', 'random_effects', 'tau2'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'higgins2002',
    authors: 'Higgins, J. P. T., & Thompson, S. G.',
    year: 2002,
    title: 'Quantifying heterogeneity in a meta-analysis',
    journal: 'Statistics in Medicine, 21(11), 1539–1558',
    doi: '10.1002/sim.1186',
    apa7: 'Higgins, J. P. T., & Thompson, S. G. (2002). Quantifying heterogeneity in a meta-analysis. Statistics in Medicine, 21(11), 1539–1558. https://doi.org/10.1002/sim.1186',
    bibtex: `@article{higgins2002,\n  author = {Higgins, Julian P. T. and Thompson, Simon G.},\n  title = {Quantifying heterogeneity in a meta-analysis},\n  journal = {Statistics in Medicine},\n  year = {2002},\n  volume = {21},\n  number = {11},\n  pages = {1539--1558},\n  doi = {10.1002/sim.1186}\n}`,
    tags: ['meta_analysis', 'i2', 'heterogeneity'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'egger1997',
    authors: 'Egger, M., Davey Smith, G., Schneider, M., & Minder, C.',
    year: 1997,
    title: 'Bias in meta-analysis detected by a simple, graphical test',
    journal: 'BMJ, 315(7109), 629–634',
    doi: '10.1136/bmj.315.7109.629',
    apa7: 'Egger, M., Davey Smith, G., Schneider, M., & Minder, C. (1997). Bias in meta-analysis detected by a simple, graphical test. BMJ, 315(7109), 629–634. https://doi.org/10.1136/bmj.315.7109.629',
    bibtex: `@article{egger1997,\n  author = {Egger, Matthias and Davey Smith, George and Schneider, Martin and Minder, Christoph},\n  title = {Bias in meta-analysis detected by a simple, graphical test},\n  journal = {BMJ},\n  year = {1997},\n  volume = {315},\n  number = {7109},\n  pages = {629--634},\n  doi = {10.1136/bmj.315.7109.629}\n}`,
    tags: ['meta_analysis', 'publication_bias', 'funnel_plot', 'egger'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'rouder2009',
    authors: 'Rouder, J. N., Speckman, P. L., Sun, D., Morey, R. D., & Iverson, G.',
    year: 2009,
    title: 'Bayesian t tests for accepting and rejecting the null hypothesis',
    journal: 'Psychonomic Bulletin & Review, 16(2), 225–237',
    doi: '10.3758/PBR.16.2.225',
    apa7: 'Rouder, J. N., Speckman, P. L., Sun, D., Morey, R. D., & Iverson, G. (2009). Bayesian t tests for accepting and rejecting the null hypothesis. Psychonomic Bulletin & Review, 16(2), 225–237. https://doi.org/10.3758/PBR.16.2.225',
    bibtex: `@article{rouder2009,\n  author = {Rouder, Jeffrey N. and Speckman, Paul L. and Sun, Dongchu and Morey, Richard D. and Iverson, Geoffrey},\n  title = {Bayesian t tests for accepting and rejecting the null hypothesis},\n  journal = {Psychonomic Bulletin \\& Review},\n  year = {2009},\n  volume = {16},\n  number = {2},\n  pages = {225--237},\n  doi = {10.3758/PBR.16.2.225}\n}`,
    tags: ['bayesian', 'bayes_factor', 'jzs', 't_test'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'bland1986',
    authors: 'Bland, J. M., & Altman, D. G.',
    year: 1986,
    title: 'Statistical methods for assessing agreement between two methods of clinical measurement',
    journal: 'The Lancet, 327(8476), 307–310',
    doi: '10.1016/S0140-6736(86)90837-8',
    apa7: 'Bland, J. M., & Altman, D. G. (1986). Statistical methods for assessing agreement between two methods of clinical measurement. The Lancet, 327(8476), 307–310. https://doi.org/10.1016/S0140-6736(86)90837-8',
    bibtex: `@article{bland1986,\n  author = {Bland, J. Martin and Altman, Douglas G.},\n  title = {Statistical methods for assessing agreement between two methods of clinical measurement},\n  journal = {The Lancet},\n  year = {1986},\n  volume = {327},\n  number = {8476},\n  pages = {307--310},\n  doi = {10.1016/S0140-6736(86)90837-8}\n}`,
    tags: ['bland_altman', 'agreement', 'clinical', 'loa'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'kaplan1958',
    authors: 'Kaplan, E. L., & Meier, P.',
    year: 1958,
    title: 'Nonparametric estimation from incomplete observations',
    journal: 'Journal of the American Statistical Association, 53(282), 457–481',
    doi: '10.1080/01621459.1958.10501452',
    apa7: 'Kaplan, E. L., & Meier, P. (1958). Nonparametric estimation from incomplete observations. Journal of the American Statistical Association, 53(282), 457–481. https://doi.org/10.1080/01621459.1958.10501452',
    bibtex: `@article{kaplan1958,\n  author = {Kaplan, E. L. and Meier, Paul},\n  title = {Nonparametric estimation from incomplete observations},\n  journal = {Journal of the American Statistical Association},\n  year = {1958},\n  volume = {53},\n  number = {282},\n  pages = {457--481},\n  doi = {10.1080/01621459.1958.10501452}\n}`,
    tags: ['kaplan_meier', 'survival', 'censored', 'log_rank'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'andrich1978',
    authors: 'Andrich, D.',
    year: 1978,
    title: 'A rating formulation for ordered response categories',
    journal: 'Psychometrika, 43(4), 561–573',
    doi: '10.1007/BF02293814',
    apa7: 'Andrich, D. (1978). A rating formulation for ordered response categories. Psychometrika, 43(4), 561–573. https://doi.org/10.1007/BF02293814',
    bibtex: `@article{andrich1978,\n  author = {Andrich, David},\n  title = {A rating formulation for ordered response categories},\n  journal = {Psychometrika},\n  year = {1978},\n  volume = {43},\n  number = {4},\n  pages = {561--573},\n  doi = {10.1007/BF02293814}\n}`,
    tags: ['rasch', 'irt', 'rating_scale', 'psychometrics'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'chen2007',
    authors: 'Chen, F. F.',
    year: 2007,
    title: 'Sensitivity of goodness of fit indexes to lack of measurement invariance',
    journal: 'Structural Equation Modeling: A Multidisciplinary Journal, 14(3), 464–504',
    doi: '10.1080/10705510701301834',
    apa7: 'Chen, F. F. (2007). Sensitivity of goodness of fit indexes to lack of measurement invariance. Structural Equation Modeling: A Multidisciplinary Journal, 14(3), 464–504. https://doi.org/10.1080/10705510701301834',
    bibtex: `@article{chen2007,\n  author = {Chen, Fang Fang},\n  title = {Sensitivity of goodness of fit indexes to lack of measurement invariance},\n  journal = {Structural Equation Modeling: A Multidisciplinary Journal},\n  year = {2007},\n  volume = {14},\n  number = {3},\n  pages = {464--504},\n  doi = {10.1080/10705510701301834}\n}`,
    tags: ['measurement_invariance', 'cb_sem', 'cfa', 'multigroup'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'austin2011',
    authors: 'Austin, P. C.',
    year: 2011,
    title: 'An introduction to propensity score methods for reducing the effects of confounding in observational studies',
    journal: 'Multivariate Behavioral Research, 46(3), 399–424',
    doi: '10.1080/00273171.2011.568786',
    apa7: 'Austin, P. C. (2011). An introduction to propensity score methods for reducing the effects of confounding in observational studies. Multivariate Behavioral Research, 46(3), 399–424. https://doi.org/10.1080/00273171.2011.568786',
    bibtex: `@article{austin2011,\n  author = {Austin, Peter C.},\n  title = {An introduction to propensity score methods for reducing the effects of confounding in observational studies},\n  journal = {Multivariate Behavioral Research},\n  year = {2011},\n  volume = {46},\n  number = {3},\n  pages = {399--424},\n  doi = {10.1080/00273171.2011.568786}\n}`,
    tags: ['psm', 'propensity_score', 'causal', 'matching'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'bates2015',
    authors: 'Bates, D., Mächler, M., Bolker, B., & Walker, S.',
    year: 2015,
    title: 'Fitting linear mixed-effects models using lme4',
    journal: 'Journal of Statistical Software, 67(1), 1–48',
    doi: '10.18637/jss.v067.i01',
    apa7: 'Bates, D., Mächler, M., Bolker, B., & Walker, S. (2015). Fitting linear mixed-effects models using lme4. Journal of Statistical Software, 67(1), 1–48. https://doi.org/10.18637/jss.v067.i01',
    bibtex: `@article{bates2015,\n  author = {Bates, Douglas and M{\\"a}chler, Martin and Bolker, Ben and Walker, Steve},\n  title = {Fitting linear mixed-effects models using {lme4}},\n  journal = {Journal of Statistical Software},\n  year = {2015},\n  volume = {67},\n  number = {1},\n  pages = {1--48},\n  doi = {10.18637/jss.v067.i01}\n}`,
    tags: ['lmm', 'mixed_effects', 'multilevel', 'hlm'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'hanley1982',
    authors: 'Hanley, J. A., & McNeil, B. J.',
    year: 1982,
    title: 'The meaning and use of the area under a receiver operating characteristic (ROC) curve',
    journal: 'Radiology, 143(1), 29–36',
    doi: '10.1148/radiology.143.1.7063747',
    apa7: 'Hanley, J. A., & McNeil, B. J. (1982). The meaning and use of the area under a receiver operating characteristic (ROC) curve. Radiology, 143(1), 29–36. https://doi.org/10.1148/radiology.143.1.7063747',
    bibtex: `@article{hanley1982,\n  author = {Hanley, James A. and McNeil, Barbara J.},\n  title = {The meaning and use of the area under a receiver operating characteristic ({ROC}) curve},\n  journal = {Radiology},\n  year = {1982},\n  volume = {143},\n  number = {1},\n  pages = {29--36},\n  doi = {10.1148/radiology.143.1.7063747}\n}`,
    tags: ['roc_curve', 'auc', 'diagnostic', 'sensitivity', 'specificity'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'mauchly1940',
    authors: 'Mauchly, J. W.',
    year: 1940,
    title: 'Significance test for sphericity of a normal n-variate distribution',
    journal: 'The Annals of Mathematical Statistics, 11(2), 204–209',
    doi: '10.1214/aoms/1177731915',
    apa7: 'Mauchly, J. W. (1940). Significance test for sphericity of a normal n-variate distribution. The Annals of Mathematical Statistics, 11(2), 204–209. https://doi.org/10.1214/aoms/1177731915',
    bibtex: `@article{mauchly1940,\n  author = {Mauchly, John W.},\n  title = {Significance test for sphericity of a normal $n$-variate distribution},\n  journal = {The Annals of Mathematical Statistics},\n  year = {1940},\n  volume = {11},\n  number = {2},\n  pages = {204--209},\n  doi = {10.1214/aoms/1177731915}\n}`,
    tags: ['repeated_anova', 'sphericity', 'mauchly', 'assumption'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'greenhouse1959',
    authors: 'Greenhouse, S. W., & Geisser, S.',
    year: 1959,
    title: 'On methods in the analysis of profile data',
    journal: 'Psychometrika, 24(2), 95–112',
    doi: '10.1007/BF02289823',
    apa7: 'Greenhouse, S. W., & Geisser, S. (1959). On methods in the analysis of profile data. Psychometrika, 24(2), 95–112. https://doi.org/10.1007/BF02289823',
    bibtex: `@article{greenhouse1959,\n  author = {Greenhouse, Samuel W. and Geisser, Seymour},\n  title = {On methods in the analysis of profile data},\n  journal = {Psychometrika},\n  year = {1959},\n  volume = {24},\n  number = {2},\n  pages = {95--112},\n  doi = {10.1007/BF02289823}\n}`,
    tags: ['repeated_anova', 'greenhouse_geisser', 'epsilon', 'sphericity'],
    verifiedSource: 'local_curated',
  },
  {
    key: 'benjamini1995',
    authors: 'Benjamini, Y., & Hochberg, Y.',
    year: 1995,
    title: 'Controlling the false discovery rate: A practical and powerful approach to multiple testing',
    journal: 'Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289–300',
    doi: '10.1111/j.2517-6161.1995.tb02031.x',
    apa7: 'Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: A practical and powerful approach to multiple testing. Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289–300. https://doi.org/10.1111/j.2517-6161.1995.tb02031.x',
    bibtex: `@article{benjamini1995,\n  author = {Benjamini, Yoav and Hochberg, Yosef},\n  title = {Controlling the false discovery rate: A practical and powerful approach to multiple testing},\n  journal = {Journal of the Royal Statistical Society: Series B (Methodological)},\n  year = {1995},\n  volume = {57},\n  number = {1},\n  pages = {289--300},\n  doi = {10.1111/j.2517-6161.1995.tb02031.x}\n}`,
    tags: ['multiple_testing', 'fdr', 'posthoc', 'nonparametric'],
    verifiedSource: 'local_curated',
  },
];

const CITATION_MAP = new Map<string, VerifiedReference>(
  VERIFIED_CITATIONS.map((ref) => [ref.key, ref]),
);

const ANALYSIS_KEY_MAP: Record<string, string[]> = {
  descriptive_table: ['cohen1988'],
  frequency_table: ['cohen1988'],
  normality_test: ['shapiro1965', 'royston1995'],
  outliers: ['cohen1988'],
  correlation_test: ['cohen1988'],
  partial_correlation_test: ['cohen1988'],
  chi_square: ['cohen1988'],
  one_sample_t: ['cohen1988', 'shapiro1965', 'royston1995'],
  independent_t: ['cohen1988', 'welch1947', 'levene1960', 'shapiro1965', 'royston1995'],
  paired_t: ['cohen1988', 'shapiro1965', 'royston1995'],
  oneway_anova: ['cohen1988', 'levene1960', 'welch1947'],
  repeated_anova: ['cohen1988', 'mauchly1940', 'greenhouse1959'],
  mann_whitney_u: ['cohen1988'],
  wilcoxon: ['cohen1988'],
  kruskal_wallis: ['cohen1988', 'benjamini1995'],
  friedman: ['cohen1988', 'benjamini1995'],
  linear_regression: ['cohen1988'],
  logistic_regression: ['cohen1988'],
  roc_curve: ['hanley1982'],
  bland_altman: ['bland1986'],
  kaplan_meier: ['kaplan1958'],
  process_model4: ['hayes2022'],
  process_model1: ['hayes2022'],
  power_analysis: ['faul2007', 'cohen1988'],
  reliability: ['cronbach1951', 'shrout1979'],
  efa: ['kaiser1974', 'bartlett1954'],
  rasch: ['andrich1978'],
  cb_sem: ['hu1999', 'fornell1981', 'chen2007'],
  pls_sem: ['hair2019', 'fornell1981', 'henseler2015'],
  meta_analysis: ['dersimonian1986', 'higgins2002', 'egger1997'],
  bayes_factor: ['rouder2009'],
  bayesian_t: ['rouder2009'],
  measurement_invariance: ['chen2007', 'hu1999'],
  psm: ['austin2011'],
  propensity_score: ['austin2011'],
  lmm: ['bates2015'],
  linear_mixed_model: ['bates2015'],
};

/**
 * Deterministically maps executed analyses and their diagnostic assumptions
 * to exact verified peer-reviewed methodological references.
 */
export function matchReferencesForAnalyses(analyses: AnalysisOutput[]): VerifiedReference[] {
  const keys = new Set<string>();

  for (const analysis of analyses) {
    const type = analysis.analysisType.toLowerCase();
    const direct = ANALYSIS_KEY_MAP[type];
    if (direct) {
      for (const k of direct) keys.add(k);
    } else {
      if (type.includes('meta')) {
        keys.add('dersimonian1986');
        keys.add('higgins2002');
        keys.add('egger1997');
      }
      if (type.includes('bayes')) keys.add('rouder2009');
      if (type.includes('lmm') || type.includes('mixed')) keys.add('bates2015');
      if (type.includes('psm') || type.includes('propensity')) keys.add('austin2011');
      if (type.includes('invariance')) {
        keys.add('chen2007');
        keys.add('hu1999');
      }
      if (type.includes('sem')) {
        keys.add('hu1999');
        keys.add('fornell1981');
      }
    }

    for (const assumption of analysis.assumptions ?? []) {
      const aName = assumption.name.toLowerCase();
      if (aName.includes('shapiro') || aName.includes('normal')) {
        keys.add('shapiro1965');
        keys.add('royston1995');
      }
      if (aName.includes('levene') || aName.includes('homojen') || aName.includes('varyans')) {
        keys.add('levene1960');
      }
      if (aName.includes('mauchly') || aName.includes('küresellik') || aName.includes('sphericity')) {
        keys.add('mauchly1940');
        keys.add('greenhouse1959');
      }
      if (aName.includes('kmo')) keys.add('kaiser1974');
      if (aName.includes('bartlett')) keys.add('bartlett1954');
    }
  }

  const matched: VerifiedReference[] = [];
  for (const k of keys) {
    const ref = CITATION_MAP.get(k);
    if (ref) matched.push(ref);
  }
  return matched;
}

/**
 * Searches the curated local verified citation database using case-insensitive token matching.
 */
export function searchLocalReferences(query: string): VerifiedReference[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [...VERIFIED_CITATIONS];
  const tokens = clean.split(/\s+/).filter(Boolean);

  return VERIFIED_CITATIONS.filter((ref) => {
    const haystack = [
      ref.key,
      ref.authors,
      String(ref.year),
      ref.title,
      ref.journal,
      ref.doi,
      ...ref.tags,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

interface CrossrefAuthor {
  family?: string;
  given?: string;
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  published?: { 'date-parts'?: number[][] };
  'published-print'?: { 'date-parts'?: number[][] };
  'published-online'?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
}

function formatCrossrefAuthorList(authors: CrossrefAuthor[] | undefined): string {
  if (!authors?.length) return 'Unknown Author';
  const formatted = authors.slice(0, 7).map((a) => {
    const family = a.family?.trim() ?? 'Unknown';
    const initials = (a.given ?? '')
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => `${part[0].toUpperCase()}.`)
      .join(' ');
    return initials ? `${family}, ${initials}` : family;
  });
  if (formatted.length === 1) return formatted[0];
  if (authors.length > 7) {
    return `${formatted.slice(0, 6).join(', ')}, ... ${formatted[formatted.length - 1]}`;
  }
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
}

function mapCrossrefWork(work: CrossrefWork): VerifiedReference | null {
  const doi = work.DOI?.trim();
  const title = work.title?.[0]?.trim();
  if (!doi || !title) return null;

  const year =
    work.published?.['date-parts']?.[0]?.[0] ??
    work['published-print']?.['date-parts']?.[0]?.[0] ??
    work['published-online']?.['date-parts']?.[0]?.[0] ??
    new Date().getFullYear();

  const authors = formatCrossrefAuthorList(work.author);
  const container = work['container-title']?.[0]?.trim() || 'CrossRef Indexed Work';
  const volPart = work.volume ? `, ${work.volume}` : '';
  const issuePart = work.issue ? `(${work.issue})` : '';
  const pagePart = work.page ? `, ${work.page}` : '';
  const journal = `${container}${volPart}${issuePart}${pagePart}`;

  const firstFamily = (work.author?.[0]?.family ?? 'ref').toLowerCase().replace(/[^a-z0-9]/g, '') || 'ref';
  const key = `${firstFamily}${year}_${doi.slice(-6).replace(/[^a-z0-9]/gi, '')}`.toLowerCase();

  const apa7 = `${authors} (${year}). ${title}. ${journal}. https://doi.org/${doi}`;
  const bibAuthors = (work.author ?? [])
    .map((a) => [a.family, a.given].filter(Boolean).join(', '))
    .join(' and ') || 'Unknown Author';

  const bibtex = [
    `@article{${key},`,
    `  author = {${bibAuthors}},`,
    `  title = {${title}},`,
    `  journal = {${container}},`,
    `  year = {${year}},`,
    work.volume ? `  volume = {${work.volume}},` : '',
    work.issue ? `  number = {${work.issue}},` : '',
    work.page ? `  pages = {${work.page}},` : '',
    `  doi = {${doi}}`,
    `}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    key,
    authors,
    year,
    title,
    journal,
    doi,
    apa7,
    bibtex,
    tags: ['crossref', 'doi_verified'],
    verifiedSource: 'crossref_api',
  };
}

/**
 * Optionally queries the public CrossRef REST API by DOI or bibliographic search string.
 * Safe offline and in headless tests: enforces timeout and returns [] on any failure.
 */
export async function lookupCrossrefByDoiOrQuery(query: string): Promise<VerifiedReference[]> {
  const raw = query.trim();
  if (!raw || typeof fetch !== 'function') return [];

  const cleanDoi = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  const isDoi = /^10\.\d{4,9}\/\S+$/i.test(cleanDoi);

  const url = isDoi
    ? `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`
    : `https://api.crossref.org/works?query=${encodeURIComponent(raw)}&rows=8&select=DOI,title,author,published,published-print,published-online,container-title,volume,issue,page`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : undefined;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      message?: CrossrefWork | { items?: CrossrefWork[] };
    };
    if (!payload.message) return [];

    if (isDoi) {
      const mapped = mapCrossrefWork(payload.message as CrossrefWork);
      return mapped ? [mapped] : [];
    }

    const items = (payload.message as { items?: CrossrefWork[] }).items ?? [];
    return items.map(mapCrossrefWork).filter((x): x is VerifiedReference => x !== null);
  } catch {
    return [];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
