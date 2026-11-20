/**
 * Extension-shared shells: InteractiveWorkbench, ConsoleOutput, SplitPane.
 * One standardized anatomy for every interactive block — toolbar, stage,
 * collapsible console, and a unified Reset / Hint / Run footer.
 *
 * @module components/ui/workbench
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import { Button, IconButton } from './buttons.ts';
import { Toolbar } from './containers.ts';
import { panelResize } from '../../panel-resize.js';

export interface ConsoleEntry {
  kind: 'cmd' | 'stdout' | 'stderr' | 'info';
  text: string;
  /** Right-aligned annotation (exit code, timing, …). */
  meta?: string;
}

/** Canonical entry class (pure — unit tested). */
export function consoleEntryClass(kind: ConsoleEntry['kind']): string {
  return `${ds.consoleEntry} ${ds.consoleEntry}--${kind}`;
}

export interface ConsoleOutputProps {
  title?: string;
  maxHeight?: number;
  /** Renders a collapse toggle in the head strip. */
  collapsible?: boolean;
  testId?: string;
}

export interface ConsoleOutputHandle {
  root: HTMLElement;
  append(entry: ConsoleEntry): void;
  clear(): void;
  setTitle(title: string): void;
  setOpen(open: boolean): void;
}

export function ConsoleOutput(props: ConsoleOutputProps = {}): ConsoleOutputHandle {
  const { title = 'Output', maxHeight = 200, collapsible = false, testId } = props;
  const root = el('section', ds.console);
  if (testId) root.dataset.testid = testId;
  const titleNode = el('span', ds.consoleTitle, title);
  const head = el('div', ds.consoleHead, titleNode);
  const log = el('div', ds.consoleLog);
  log.style.maxHeight = `${maxHeight}px`;
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', title);
  let open = true;
  let collapseToggle: HTMLButtonElement | undefined;
  if (collapsible) {
    const toggle = IconButton({
      icon: 'chevron-down', label: `Collapse ${title.toLowerCase()}`, size: 'xs',
      onClick: () => setOpen(!open),
    });
    toggle.setAttribute('aria-expanded', 'true');
    head.append(toggle);
    head.classList.add(ds.consoleHeadToggle);
    collapseToggle = toggle;
  }
  root.append(head, log);
  function setOpen(next: boolean): void {
    open = next;
    log.hidden = !next;
    if (collapseToggle) {
      collapseToggle.setAttribute('aria-expanded', String(next));
      collapseToggle.replaceChildren(icon(next ? 'chevron-down' : 'chevron-right'));
    }
  }
  return {
    root,
    append(entry: ConsoleEntry) {
      const line = el('div', consoleEntryClass(entry.kind));
      if (entry.meta) line.append(el('span', ds.consoleMeta, entry.meta));
      line.append(el('span', ds.consoleText, entry.text));
      log.append(line);
      log.scrollTop = log.scrollHeight;
    },
    clear() {
      log.replaceChildren();
    },
    setTitle(next: string) {
      titleNode.textContent = next;
      log.setAttribute('aria-label', next);
    },
    setOpen,
  };
}

export interface WorkbenchFooter {
  reset?: () => void;
  hint?: () => void;
  run?: { label: string; onClick: () => void | Promise<void>; loading?: boolean };
}

export interface InteractiveWorkbenchProps {
  description?: Node;
  toolbar?: Node[];
  /** Right-aligned status node (badge, readout, engine state). */
  status?: Node;
  stage: Node;
  console?: ConsoleOutputHandle;
  footer?: WorkbenchFooter;
  testId?: string;
}

export interface InteractiveWorkbenchHandle {
  root: HTMLElement;
  setConsoleOpen(open: boolean): void;
}

export function InteractiveWorkbench(props: InteractiveWorkbenchProps): InteractiveWorkbenchHandle {
  const { description, toolbar = [], status, stage, console: consoleHandle, footer, testId } = props;
  const root = el('div', ds.workbench);
  if (testId) root.dataset.testid = testId;
  if (description) root.append(el('div', ds.workbenchDescription, description));
  const controls = Toolbar({ children: toolbar });
  if (status) {
    const statusSlot = el('div', ds.toolbarStatus, status);
    controls.append(statusSlot);
  }
  if (toolbar.length || status) root.append(controls);
  root.append(el('div', ds.workbenchStage, stage));
  if (consoleHandle) root.append(consoleHandle.root);
  if (footer) {
    const bar = el('div', ds.workbenchFooter);
    if (footer.reset) bar.append(Button({ label: 'Reset', size: 'sm', leftIcon: 'rotate-ccw', onClick: footer.reset }));
    if (footer.hint) bar.append(Button({ label: 'Hint', size: 'sm', leftIcon: 'lightbulb', onClick: footer.hint }));
    if (footer.run) {
      bar.append(Button({
        label: footer.run.label, variant: 'primary', size: 'sm', leftIcon: 'play',
        loading: footer.run.loading, onClick: footer.run.onClick, className: ds.workbenchRun,
      }));
    }
    root.append(bar);
  }
  return {
    root,
    setConsoleOpen(open: boolean) {
      consoleHandle?.setOpen(open);
    },
  };
}

export interface SplitPaneProps {
  direction?: 'horizontal' | 'vertical';
  first: Node;
  second: Node;
  initial?: number;
  min?: number;
  max?: number;
  /** localStorage persistence key suffix; defaults to a shared split key. */
  storageKey?: string;
  name?: string;
}

/** Resizable two-pane layout built on the app's panel-resize separator. */
export function SplitPane(props: SplitPaneProps): HTMLElement {
  const {
    direction = 'horizontal', first, second, initial = 300, min = 160, max = 560,
    storageKey = 'ds-split', name = 'Resize split',
  } = props;
  const root = el('div', `${ds.split} ${ds.split}--${direction}`);
  const firstPane = el('div', ds.splitFirst, el('div', ds.splitContent, first));
  const secondPane = el('div', ds.splitSecond, el('div', ds.splitContent, second));
  secondPane.id = 'ds-split-' + crypto.randomUUID();
  root.append(firstPane, secondPane);
  panelResize(root, secondPane, {
    name, property: 'ds-split', storageKey, width: initial, min, max, fraction: .6,
    edge: direction === 'horizontal' ? 'left' : 'top',
  });
  return root;
}