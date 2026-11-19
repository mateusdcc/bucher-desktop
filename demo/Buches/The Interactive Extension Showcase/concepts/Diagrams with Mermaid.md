---
name: Diagrams with Mermaid
description: Flowcharts and sequences rendered from plain text.
category: Visualization
icon: lucide:workflow
order: 1
depends_on: []
---

# Diagrams with Mermaid

The `ext-mermaid` extension renders any Mermaid grammar — flowcharts, sequence diagrams, state machines, class diagrams — with colors matched to the reader theme. Drag to pan, scroll to zoom, and use the toolbar to reset the view. Your viewport is remembered per block.

## A decision procedure

Binary search is easier to see than to describe:

```ext-mermaid
id: showcase-search-flow
title: Binary search control flow
diagram: |
  flowchart TD
    A["lo = 0, hi = n - 1"] --> B{"lo <= hi?"}
    B -- no --> C["return -1"]
    B -- yes --> D["mid = (lo + hi) / 2"]
    D --> E{"a[mid] == target?"}
    E -- yes --> F["return mid"]
    E -- "a[mid] < target" --> G["lo = mid + 1"]
    E -- "a[mid] > target" --> H["hi = mid - 1"]
    G --> B
    H --> B
caption: Every iteration halves the interval — that is where O(log n) comes from.
```

^search-flow

## A conversation between systems

Sequence diagrams show who talks to whom, and in what order:

```ext-mermaid
id: showcase-http-sequence
title: Request lifecycle
diagram: |
  sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Database
    C->>S: GET /books
    S->>D: SELECT * FROM books
    D-->>S: rows
    S-->>C: 200 OK (JSON)
```

Try zooming into the second diagram with the scroll wheel, then press the reset button. Reload the app — the view you left is the view you get back.
