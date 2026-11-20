/**
 * Badge — semantic status pill for exercise states, runtime states,
 * dependency kinds, and categories. One badge system replaces the four
 * ad-hoc chip families.
 *
 * @module components/ui/badge
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import type { BadgeVariant } from './classes.ts';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: string;
  icon?: string;
  title?: string;
  testId?: string;
}

export function Badge(props: BadgeProps): HTMLElement {
  const { variant = 'neutral', children, icon: glyph, title, testId } = props;
  const node = el('span', `${ds.badge} ${ds.badge}--${variant}`);
  if (title) node.title = title;
  if (testId) node.dataset.testid = testId;
  if (glyph) node.append(icon(glyph));
  node.append(children);
  return node;
}

/** Exercise status → badge variant (host frame + manager). */
export function exerciseBadgeVariant(status: 'unsolved' | 'in-progress' | 'passed'): BadgeVariant {
  return status === 'passed' ? 'success' : status === 'in-progress' ? 'warning' : 'neutral';
}

/** Lazy-runtime state → badge variant (manager + dependency inspector). */
export function runtimeBadgeVariant(state: 'cold' | 'loading' | 'warm' | 'error'): BadgeVariant {
  return state === 'warm' ? 'success' : state === 'loading' ? 'warning' : state === 'error' ? 'danger' : 'neutral';
}