---
title: Bucher Interactive Showcase v2
description: The dependency-aware extension platform in action — interactive graphs, a Desmos-style math studio, real Python & JavaScript IDEs, DuckDB analytics, 3D linear algebra, and native desktop superpowers.
icon: lucide:rocket
---

# Bucher Interactive Showcase v2

Six new engines join the extension system, each one a **real, dependency-backed runtime** — not a mock:

- **Interactive Graph** — React Flow canvases for proofs and systems, with wiring exercises.
- **Desmos Math Studio** — 60fps graphing with draggable points, tangent scrubbing, integrals, and fit-the-curve challenges (mathjs).
- **Polyglot Code Studio** — a tabbed IDE running **real Python 3.14 in WebAssembly** (Pyodide) and isolated JavaScript.
- **DuckDB SQL Lab** — a real analytical database in your book, with sortable results and graded queries.
- **3D Spatial Lab** — orbitable vector spaces, morphing linear transformations, animated surfaces (three.js).
- **Native Workbench** — desktop-only sandboxed **git, pipelines, and system introspection** executed by Rust commands.

Every heavy engine loads **lazily** — open **Settings → Extensions → Dependencies & Runtime** on any extension to watch runtimes go cold → loading → warm, inspect declared npm packages, and (for the workbench) see live native capability health.

Solve the exercises as you go: passing tests, landing vectors, matching queries, or verifying native state **marks the exercise solved automatically**, and everything persists across restarts.

> [!tip] Desktop vs web
> The Native Workbench chapter needs the desktop app — on the web it shows a capability card explaining exactly which native command is missing. That graceful degradation is part of the platform, not an afterthought.
