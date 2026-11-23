/**
 * Content-aware extension recommendation and capability labels for the
 * book-import Extension Skill Picker.
 *
 * Inspects a book's title, chapter headings, and text sample to suggest which
 * interactive extensions (and their AI skills) will enrich the book best.
 *
 * @module pdf/recommend
 */

/** Short capability chips displayed on extension selector cards. */
export const EXTENSION_TAGS = {
  'ext-code-lab': 'Python · JS',
  'ext-polyglot-studio': 'Python · JS IDE',
  'ext-math-plot': '2D Plots',
  'ext-desmos-lab': 'Calculus · Curves',
  'ext-mermaid': 'Diagrams',
  'ext-interactive-graph': 'Concept Maps',
  'ext-state-stepper': 'Algo Traces',
  'ext-parsons-puzzle': 'Proof / Code Order',
  'ext-sql-lab': 'SQL Practice',
  'ext-sql-duckdb-lab': 'DuckDB · Data',
  'ext-3d-spatial-lab': '3D · Vectors',
  'ext-tauri-native-workbench': 'Shell · Git',
};

const RULES = [
  {
    id: 'ext-code-lab',
    reason: 'Runnable Python & JavaScript coding exercises',
    patterns: [
      /\bpython\b/i, /\bjavascript\b/i, /\bdef\s+\w+\s*\(/, /\bfunction\s+\w+\s*\(/,
      /\bnumpy\b|\bpandas\b|\bscipy\b|\bstatistics\b/i, /\bprogramming\b|\bcoding\b/i,
    ],
    threshold: 1,
  },
  {
    id: 'ext-polyglot-studio',
    reason: 'Multi-tab Python & JS mini-IDE with hints',
    patterns: [
      /\bpython\b/i, /\bdef\s+\w+\s*\(/, /\balgorithm/i, /\bdata\s+structure/i,
      /\bnotebook\b|\bjupyter\b|\bpandas\b|\bnumpy\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-math-plot',
    reason: 'Interactive plots for distributions, functions, and data',
    patterns: [
      /\bstatistics\b|\bprobability\b|\bdistribution\b|\bregression\b|\bvariance\b/i,
      /\bnormal\s+distribution\b|\bgaussian\b|\bhistogram\b|\bscatter\b/i,
      /\bf\(x\)\b|\bsin\s*\(|\bcos\s*\(|\blog\s*\(|\bplot\b|\bcurve\b/i,
    ],
    threshold: 1,
  },
  {
    id: 'ext-desmos-lab',
    reason: 'Live curve fitting, derivatives, and shaded integrals',
    patterns: [
      /\bcalculus\b|\bderivative\b|\bintegral\b|\btangent\b|\bslope\b/i,
      /\bregression\b|\bcurve\s+fit|\bleast\s+squares\b|\bpolynomial\b/i,
      /\bprobability\s+density\b|\bpdf\b.*\bcdf\b|\bcumulative\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-sql-duckdb-lab',
    reason: 'SQL queries & tabular data exploration in DuckDB',
    patterns: [
      /\bsql\b|\bduckdb\b|\bpostgres|\bsqlite\b/i,
      /\bSELECT\b[\s\S]{0,60}\bFROM\b/, /\bGROUP\s+BY\b|\bINNER\s+JOIN\b/i,
      /\bdataframe\b|\bdataset\b|\btable\s+of\s+data\b|\bcsv\b/i,
    ],
    threshold: 1,
  },
  {
    id: 'ext-sql-lab',
    reason: 'Lightweight SQL query exercises',
    patterns: [/\bsql\b/i, /\bSELECT\b[\s\S]{0,60}\bFROM\b/, /\bCREATE\s+TABLE\b/i],
    threshold: 2,
  },
  {
    id: 'ext-3d-spatial-lab',
    reason: '3D vectors, matrices, linear transforms, and surfaces',
    patterns: [
      /\blinear\s+algebra\b|\beigenvalue|\beigenvector|\bdeterminant\b/i,
      /\bvector\s+space\b|\bcross\s+product\b|\bdot\s+product\b|\bmatrix\b/i,
      /\bmultivariable\b|\bpartial\s+derivative\b|\bsurface\b|\bmanifold\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-state-stepper',
    reason: 'Step-by-step algorithm & state execution traces',
    patterns: [
      /\balgorithm\b|\bpseudocode\b|\btime\s+complexity\b|\bbig[- ]o\b/i,
      /\bsorting\b|\bbinary\s+search\b|\bdynamic\s+programming\b|\brecursion\b/i,
      /\bstate\s+machine\b|\bautomaton\b|\bpointer\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-parsons-puzzle',
    reason: 'Step-ordering exercises for proofs and algorithms',
    patterns: [
      /\btheorem\b|\blemma\b|\bproof\b|\binduction\b/i,
      /\balgorithm\b|\bpseudocode\b|\bsteps?\s+to\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-interactive-graph',
    reason: 'Interactive concept maps, DAGs, and dependency graphs',
    patterns: [
      /\bgraph\s+theory\b|\bdirected\s+acyclic\b|\bmarkov\b|\bbayesian\s+network\b/i,
      /\btheorem\b.*\blemma\b|\bcausal\s+graph\b|\btopology\b|\bdependency\b/i,
      /\barchitecture\b|\bnetwork\b|\bpipeline\b/i,
    ],
    threshold: 2,
  },
  {
    id: 'ext-mermaid',
    reason: 'Flowcharts, sequence diagrams, and system visuals',
    patterns: [
      /\bflowchart\b|\bworkflow\b|\barchitecture\b|\bpipeline\b|\bprotocol\b/i,
      /\bsequence\b|\bstate\s+diagram\b|\bhypothesis\s+test|\bdecision\s+tree\b/i,
    ],
    threshold: 1,
  },
  {
    id: 'ext-tauri-native-workbench',
    reason: 'Real shell pipelines and Git CLI exercises',
    patterns: [
      /\bgit\s+(?:commit|branch|merge|rebase|checkout)\b/i,
      /\bshell\b|\bbash\b|\bcommand[- ]line\b|\bunix\b|\bposix\b|\bgrep\b|\bawk\b/i,
    ],
    threshold: 2,
  },
];

/**
 * Recommend extensions matching the supplied book text/headings.
 *
 * @param {string} sampleText
 * @param {Iterable<string>} [availableIds]
 * @returns {{ recommendedIds: string[], reasons: Record<string, string> }}
 */
export function recommendExtensions(sampleText, availableIds) {
  const allowed = availableIds ? new Set(availableIds) : null;
  const text = String(sampleText || '');
  const recommendedIds = [];
  /** @type {Record<string, string>} */
  const reasons = {};
  for (const rule of RULES) {
    if (allowed && !allowed.has(rule.id)) continue;
    let hits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) hits += 1;
    }
    if (hits >= rule.threshold) {
      recommendedIds.push(rule.id);
      reasons[rule.id] = rule.reason;
    }
  }
  return { recommendedIds, reasons };
}

/**
 * Short display tag for an extension id.
 *
 * @param {string} extensionId
 * @returns {string}
 */
export function extensionTag(extensionId) {
  return EXTENSION_TAGS[extensionId] || '';
}
