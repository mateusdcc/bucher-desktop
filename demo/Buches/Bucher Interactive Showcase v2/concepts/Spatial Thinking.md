---
name: Spatial Thinking
order: 5
description: 3D linear algebra — morph a transformation, land the vectors, orbit a surface.
---

# Spatial Thinking

Linear algebra you can walk around. The scene below renders with **three.js**; drag to orbit, scroll to zoom. The **morph slider** interpolates the identity matrix into $A$, deforming the whole space continuously — watch the basis vectors travel.

> [!exercise] Find the matrix A
> Tune the four entries until both transformed basis vectors land inside the target spheres (distance ≤ 0.15). The readouts update on every slider tick.
>
> ```ext-3d-spatial-lab
> id: showcase2-find-matrix
> title: "Find the matrix A"
> mode: challenge
> kind: vectors
> description: |
>   Tune the entries of $A$ until the transformed basis vectors (solid arrows,
>   morph slider at 1) land on the ghost targets. Drag the morph slider to
>   watch the space deform.
> vectors:
>   - { to: [1, 0, 0], label: e1, color: "#e88f9f" }
>   - { to: [0, 1, 0], label: e2, color: "#73d695" }
> transform:
>   label: A
>   matrix:
>     - [a, b, "0"]
>     - [c, d, "0"]
>     - ["0", "0", "1"]
> params:
>   - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
>   - { name: b, min: -3, max: 3, step: 0.1, value: 0 }
>   - { name: c, min: -3, max: 3, step: 0.1, value: 0 }
>   - { name: d, min: -3, max: 3, step: 0.1, value: 1 }
> targets:
>   - { vector: 0, position: [2, 1, 0], tolerance: 0.15, label: "A·e1" }
>   - { vector: 1, position: [1, 2, 0], tolerance: 0.15, label: "A·e2" }
> ```

^find-matrix-exercise

> [!hint]- Columns are images of basis vectors
> The first column of $A$ is where $e_1$ lands; the second column is where $e_2$ lands. Read the targets directly.

Surfaces are live too — press **Play** and scrub the amplitude:

```ext-3d-spatial-lab
id: showcase2-ripple
title: Ripple surface
kind: surface
description: An animated wave surface — orbit with the mouse, scrub amplitude.
surface:
  expr: a * sin(x - t) * cos(y)
  xRange: [-4, 4]
  yRange: [-4, 4]
  resolution: 40
params:
  - { name: a, min: 0.2, max: 2, step: 0.05, value: 1 }
animate: { min: 0, max: 6.283185, speed: 1.5 }
```

And the primitives your geometry textbook draws, rendered for real:

```ext-3d-spatial-lab
id: showcase2-solids
title: Solid geometry
kind: solids
solids:
  - { shape: box, position: [-2, 0, 0.5], size: [1, 1, 1], color: "#6fb7e8", label: cube }
  - { shape: sphere, position: [0, 0, 0.8], size: [0.8, 0, 0], color: "#73d695", label: sphere }
  - { shape: torus, position: [2, 0, 0.6], size: [0.7, 0.25, 0], color: "#e8d06f", label: torus }
```
