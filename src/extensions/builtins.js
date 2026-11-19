/**
 * Built-in extension registrations. Importing this module registers every
 * shipped extension with the app-wide registry singleton.
 *
 * @module extensions/builtins
 */
import { registry } from './registry.js';
import { mermaidExtension } from './mermaid.js';
import { mathPlotExtension } from './math-plot.js';
import { stateStepperExtension } from './state-stepper.js';
import { codeLabExtension } from './code-lab/code-lab.js';
import { parsonsExtension } from './parsons-puzzle.js';
import { sqlLabExtension } from './sql-lab.js';
import { interactiveGraphExtension } from './interactive-graph.js';
import { desmosLabExtension } from './desmos-lab.js';
import { polyglotStudioExtension } from './polyglot-studio.js';

registry.register(mermaidExtension);
registry.register(mathPlotExtension);
registry.register(stateStepperExtension);
registry.register(codeLabExtension);
registry.register(parsonsExtension);
registry.register(sqlLabExtension);
registry.register(interactiveGraphExtension);
registry.register(desmosLabExtension);
registry.register(polyglotStudioExtension);
