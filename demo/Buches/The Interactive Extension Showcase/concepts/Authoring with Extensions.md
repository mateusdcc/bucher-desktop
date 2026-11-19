---
name: Authoring with Extensions
description: How blocks, skills, and the manager fit together.
category: Meta
icon: lucide:sparkles
order: 7
depends_on: []
---

# Authoring with Extensions

Every interactive block you have seen is a fenced code block whose info string is an extension id, with a YAML payload:

````markdown
```ext-math-plot
id: my-plot
title: A damped wave
functions:
  - expr: exp(-a*x) * sin(x)
params:
  - name: a
    min: 0
    max: 1
    step: 0.05
    value: 0.2
```
````

The pipeline that makes this work:

```ext-mermaid
id: showcase-pipeline
title: From author to reader
diagram: |
  flowchart LR
    A["Extension registry"] --> B["AI skill composer"]
    B --> C["Book generation (Ollama / ChatGPT)"]
    C --> D["Markdown with ext-… fences"]
    D --> E["Schema validation (zod)"]
    E --> F["Framed, sandboxed mount"]
    F --> G["Progress in _progress.md"]
```

## The pieces

- **Registry & contract.** Each extension declares metadata, a zod schema, a renderer, and an AI skill. Malformed payloads render a friendly error card instead of breaking the page.
- **AI skills.** Settings → Extensions shows every installed extension and the exact prompt section it contributes. Enabled skills are injected when you *Import with AI*, *Propose a patch*, or generate solutions — so the model authors valid blocks without being told twice.
- **Persistence.** Block state lives in the book's `_progress.md` under `extensions:`, keyed by chapter and block id. That is why your sliders, code, and puzzle arrangements survive reloads — and why authors should always set a stable `id:`.
- **Sandboxing.** Code Lab runs learner code in a dedicated worker with dangerous globals removed and a hard timeout; SQL Lab uses a fresh in-memory database per attempt.

## Write your own book

Ask the AI to import any Markdown with *Import with AI* — with extensions enabled, the draft can come back enriched with plots, traces, and exercises. Or edit a chapter (pencil in the toolbar) and paste a block from the examples above. The reader validates it on the spot.
