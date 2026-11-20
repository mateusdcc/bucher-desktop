/**
 * Container & navigation primitives: Card, PanelHeader, Toolbar, Tabs.
 *
 * @module components/ui/containers
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import { IconButton } from './buttons.ts';
import { Badge } from './badge.ts';
import type { BadgeProps } from './badge.ts';

export interface CardProps {
  /** Inset surfaces sit inside cards (consoles, code, schema panels). */
  inset?: boolean;
  padding?: 'none' | 'sm' | 'md';
  className?: string;
  children?: (Node | string | null | undefined)[];
  testId?: string;
}

export function Card(props: CardProps = {}): HTMLElement {
  const { inset = false, padding = 'md', className = '', children = [], testId } = props;
  const card = el('section', `${ds.card} ${inset ? ds.cardInset : ''} ${ds.card}--${padding} ${className}`.replace(/\s+/g, ' ').trim());
  if (testId) card.dataset.testid = testId;
  card.append(...children.filter((child): child is Node | string => child !== null && child !== undefined));
  return card;
}

export interface PanelHeaderProps {
  icon?: string;
  title: string;
  subtitle?: string;
  badge?: BadgeProps;
  actions?: Node[];
  /** Renders a collapse chevron; the caller toggles its own body. */
  collapsible?: { expanded: boolean; onToggle: (expanded: boolean) => void };
  className?: string;
}

export function PanelHeader(props: PanelHeaderProps): HTMLElement {
  const { icon: glyph, title, subtitle, badge, actions = [], collapsible, className = '' } = props;
  const header = el('header', `${ds.panelHeader} ${className}`.trim());
  if (collapsible) {
    let expanded = collapsible.expanded;
    const chevron = IconButton({
      icon: expanded ? 'chevron-down' : 'chevron-right',
      label: expanded ? `Collapse ${title}` : `Expand ${title}`,
      size: 'sm',
      onClick: () => {
        expanded = !expanded;
        chevron.setAttribute('aria-expanded', String(expanded));
        chevron.replaceChildren(icon(expanded ? 'chevron-down' : 'chevron-right'));
        collapsible.onToggle(expanded);
      },
    });
    chevron.setAttribute('aria-expanded', String(expanded));
    header.append(chevron);
  }
  if (glyph) header.append(icon(glyph));
  const meta = el('div', ds.panelMeta, el('strong', ds.panelTitle, title));
  if (subtitle) meta.append(el('span', ds.panelSubtitle, subtitle));
  header.append(meta);
  if (badge) header.append(Badge(badge));
  if (actions.length) header.append(el('div', ds.panelActions, ...actions));
  return header;
}

export interface ToolbarProps {
  children?: (Node | string | null | undefined)[];
  className?: string;
}

/** Standardized control strip: 8px gap, wrapping, right-aligned status slot. */
export function Toolbar(props: ToolbarProps = {}): HTMLElement {
  const { children = [], className = '' } = props;
  const bar = el('div', `${ds.toolbar} ${className}`.trim());
  bar.append(...children.filter((child): child is Node | string => child !== null && child !== undefined));
  return bar;
}

export interface TabOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  /** id of the panel this tab controls (aria-controls). */
  controls?: string;
}

export interface TabsProps<T extends string> {
  tabs: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  testId?: string;
}

export interface TabsHandle<T extends string> {
  root: HTMLElement;
  setValue(value: T): void;
}

/** Proper tablist: role=tab, aria-selected, arrow-key navigation. */
export function Tabs<T extends string>(props: TabsProps<T>): TabsHandle<T> {
  const { tabs, value, onChange, ariaLabel, testId } = props;
  const root = el('div', ds.tabs);
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', ariaLabel);
  if (testId) root.dataset.testid = testId;
  let current = value;
  const items = new Map<T, HTMLButtonElement>();
  function sync(): void {
    for (const [tabValue, item] of items) {
      const selected = tabValue === current;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
  }
  function activate(next: T, focus = false): void {
    current = next;
    sync();
    if (focus) items.get(next)?.focus();
    onChange(next);
  }
  for (const tab of tabs) {
    const item = el('button', ds.tab);
    item.type = 'button';
    item.setAttribute('role', 'tab');
    if (tab.controls) item.setAttribute('aria-controls', tab.controls);
    if (tab.icon) item.append(icon(tab.icon));
    item.append(el('span', '', tab.label));
    item.addEventListener('click', () => {
      if (current !== tab.value) activate(tab.value);
    });
    items.set(tab.value, item);
    root.append(item);
  }
  root.addEventListener('keydown', event => {
    const order = tabs.map(tab => tab.value);
    const index = order.indexOf(current);
    let next: T | null = null;
    if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
    else if (event.key === 'ArrowLeft') next = order[(index - 1 + order.length) % order.length];
    else if (event.key === 'Home') next = order[0];
    else if (event.key === 'End') next = order[order.length - 1];
    if (next !== null) {
      event.preventDefault();
      activate(next, true);
    }
  });
  sync();
  return { root, setValue: next => { current = next; sync(); } };
}