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

registry.register(mermaidExtension);
registry.register(mathPlotExtension);
registry.register(stateStepperExtension);
