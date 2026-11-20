/**
 * Modal and Drawer — the only sanctioned overlay surfaces. Modal wraps the
 * native <dialog> (focus trap, Esc, backdrop); Drawer is a side/bottom panel
 * with its own scrim for inspector-style surfaces.
 *
 * @module components/ui/modal
 */
import { el } from './dom.ts';
import { ds } from './classes.ts';
import { IconButton } from './buttons.ts';

export interface ModalProps {
  title: string;
  /** sm 420 · md 560 (default) · lg 850 · source 760. */
  size?: 'sm' | 'md' | 'lg' | 'source';
  onClose?: () => void;
  className?: string;
  testId?: string;
}

export interface ModalHandle {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  setActions(nodes: Node[]): void;
  close(): void;
}

export function Modal(props: ModalProps): ModalHandle {
  const { title, size = 'md', onClose, className = '', testId } = props;
  const dialog = el('dialog', `${ds.modal} ${ds.modal}--${size} ${className}`.replace(/\s+/g, ' ').trim());
  if (testId) dialog.dataset.testid = testId;
  const titleId = 'ds-modal-' + crypto.randomUUID();
  const heading = el('h2', ds.modalTitle, title);
  heading.id = titleId;
  dialog.setAttribute('aria-labelledby', titleId);
  const close = IconButton({ icon: 'x', label: 'Close', size: 'sm', onClick: () => dialog.close() });
  const actions = el('div', ds.modalActions);
  const body = el('div', ds.modalBody);
  dialog.append(el('div', ds.modalHeading, heading, close), body, actions);
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return {
    dialog,
    body,
    setActions(nodes: Node[]) {
      actions.replaceChildren(...nodes);
      actions.hidden = nodes.length === 0;
    },
    close: () => dialog.close(),
  };
}

export interface DrawerProps {
  title: string;
  side?: 'right' | 'bottom';
  onClose?: () => void;
  testId?: string;
}

export interface DrawerHandle {
  root: HTMLElement;
  body: HTMLElement;
  close(): void;
}

export function Drawer(props: DrawerProps): DrawerHandle {
  const { title, side = 'right', onClose, testId } = props;
  const scrim = el('div', ds.drawerScrim);
  const root = el('aside', `${ds.drawer} ${ds.drawer}--${side}`);
  if (testId) root.dataset.testid = testId;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const titleId = 'ds-drawer-' + crypto.randomUUID();
  root.setAttribute('aria-labelledby', titleId);
  const heading = el('h2', ds.drawerTitle, title);
  heading.id = titleId;
  const body = el('div', ds.drawerBody);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    root.remove();
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }
  const closeButton = IconButton({ icon: 'x', label: 'Close ' + title.toLowerCase(), size: 'sm', onClick: close });
  root.append(el('div', ds.drawerHeading, heading, closeButton), body);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, root);
  closeButton.focus();
  return { root, body, close };
}