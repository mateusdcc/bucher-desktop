import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder, WidgetType } from '@codemirror/view';
import { markdownBlockLines } from './markdown';
import { button, el } from './ui';

class ProofEditor extends HTMLElement {
  disconnectedCallback() { this.view?.destroy(); }
}
customElements.define('bucher-proof-editor', ProofEditor);

class RenderedBlock extends WidgetType {
  constructor(from, source, render) {
    super();
    this.from = from;
    this.source = source;
    this.render = render;
  }

  eq(other) { return this.from === other.from && this.source === other.source; }

  toDOM(view) {
    const block = this.render(this.source);
    block.classList.add('solution-rendered-block');
    block.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    block.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    return block;
  }
}

function livePreview(render) {
  const focusChanged = StateEffect.define();
  function decorations(state, focused) {
    const blocks = markdownBlockLines(state.doc.toString()).flatMap(([start, end]) => {
      const from = state.doc.line(start + 1).from;
      const to = state.doc.line(end).to;
      if (from >= to || (focused && state.selection.ranges.some(range => range.from <= to && range.to >= from))) return [];
      return [Decoration.replace({
        block: true,
        widget: new RenderedBlock(from, state.sliceDoc(from, to), render),
      }).range(from, to)];
    });
    return Decoration.set(blocks, true);
  }
  const preview = StateField.define({
    create: state => ({ focused: false, ranges: decorations(state, false) }),
    update(value, transaction) {
      const change = transaction.effects.find(effect => effect.is(focusChanged));
      if (!transaction.docChanged && !transaction.selection && !change) return value;
      const focused = change?.value ?? value.focused;
      return { focused, ranges: decorations(transaction.state, focused) };
    },
    provide: field => EditorView.decorations.from(field, value => value.ranges),
  });
  return [preview, EditorView.focusChangeEffect.of((_state, focused) => focusChanged.of(focused))];
}

export function inlineSolutionEditor(draft, render, commit, close) {
  const source = el('bucher-proof-editor', 'solution-source');
  const editing = new Compartment();
  const submit = button('Save solution', 'check', async () => {
    draft.saving = true;
    source.view.dispatch({ effects: editing.reconfigure(EditorState.readOnly.of(true)) });
    try {
      await commit(draft.text);
    } finally {
      draft.saving = false;
      if (source.isConnected) source.view.dispatch({ effects: editing.reconfigure(EditorState.readOnly.of(false)) });
    }
  }, 'accent-button');
  submit.disabled = !draft.text.trim() || Boolean(draft.saving);
  source.view = new EditorView({
    parent: source,
    doc: draft.text,
    extensions: [
      keymap.of([{ key: 'Mod-s', run: () => { submit.click(); return true; } }, ...defaultKeymap, ...historyKeymap]),
      history(), EditorView.lineWrapping, placeholder('Write your solution…'),
      EditorView.contentAttributes.of({ 'aria-label': 'Solution source', spellcheck: 'false' }),
      editing.of(EditorState.readOnly.of(Boolean(draft.saving))),
      draft.typst ? [] : livePreview(render),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        draft.text = update.state.doc.toString();
        submit.disabled = !draft.text.trim() || Boolean(draft.saving);
      }),
    ],
  });
  const insert = button('Insert Typst', 'sigma', () => {
    if (draft.saving) return;
    source.view.focus();
    const { from, to } = source.view.state.selection.main;
    const selected = source.view.state.sliceDoc(from, to);
    const prefix = '\n\n```typst\n$ ';
    source.view.dispatch({
      changes: { from, to, insert: prefix + selected + ' $\n```\n\n' },
      selection: { anchor: from + prefix.length, head: from + prefix.length + selected.length },
      scrollIntoView: true,
    });
  });
  insert.addEventListener('mousedown', event => event.preventDefault());
  const cancel = button('Discard draft', null, () => {
    if (!draft.saving) close();
  });
  return el('div', 'inline-solution-editor', source,
    el('div', 'inline-editor-tools', draft.typst ? null : insert, cancel, submit));
}
