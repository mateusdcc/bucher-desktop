/**
 * Built-in extension registrations. Importing this module registers every
 * shipped extension with the app-wide registry singleton.
 *
 * @module extensions/builtins
 */
import { registry } from './registry.js';
import { mermaidExtension } from './mermaid.js';

registry.register(mermaidExtension);
