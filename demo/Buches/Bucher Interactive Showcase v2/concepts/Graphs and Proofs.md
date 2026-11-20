---
name: Graphs and Proofs
order: 1
description: Interactive node-edge canvases for proof structure, with a wiring exercise.
---

# Graphs and Proofs

Static diagrams become explorable space. Click any node to read its sub-note, drag nodes to rearrange, and use **Trace prerequisites / Trace dependencies** to light up the proof chain.

```ext-interactive-graph
id: showcase2-proof-map
title: How the even-sum proof fits together
mode: explore
layout: TB
nodes:
  - id: def-even
    label: "Definition: even"
    kind: definition
    note: |
      An integer $n$ is **even** when $n = 2k$ for some integer $k$.
  - id: closure
    label: "Integers closed under +"
    kind: lemma
    note: The sum of two integers is an integer — this justifies the final step.
  - id: sum-even
    label: "Sum of evens is even"
    kind: theorem
    note: |
      Let $m = 2a$ and $n = 2b$. Then $m + n = 2(a+b)$, and $a+b$ is an
      integer, so the sum is even. $\blacksquare$
edges:
  - { from: def-even, to: sum-even, label: unfolds }
  - { from: closure, to: sum-even, label: justifies }
```

> [!exercise] Wire the compilation pipeline
> Two links are missing from this pipeline. Drag from a node's right handle to another node's left handle to wire them. Wrong links are rejected with feedback; wire both correctly to solve.
>
> ```ext-interactive-graph
> id: showcase2-wire-pipeline
> title: Wire the compilation pipeline
> mode: exercise
> layout: LR
> nodes:
>   - { id: src, label: Source, kind: concept }
>   - { id: lex, label: Lexer, kind: step }
>   - { id: parse, label: Parser, kind: step }
>   - { id: ir, label: IR, kind: concept }
>   - { id: codegen, label: Codegen, kind: step }
> edges:
>   - { from: src, to: lex }
>   - { from: lex, to: parse }
>   - { from: parse, to: ir }
>   - { from: ir, to: codegen }
> exercise:
>   type: wire-edges
>   hiddenEdges:
>     - { from: lex, to: parse }
>     - { from: ir, to: codegen }
> ```

^wire-pipeline-exercise

> [!hint]- Which links are missing?
> The visible arrows skip two stages. Follow the data: tokens flow from the lexer into the parser, and the IR feeds codegen.
