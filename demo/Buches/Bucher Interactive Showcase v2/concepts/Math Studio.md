---
name: Math Studio
order: 2
description: Direct-manipulation calculus — drag the vertex, scrub tangents, then fit a line.
---

# Math Studio

This is not a picture of a graph — it is a live mathematical object. **Drag the yellow vertex** to move the parabola: the sliders follow your hand, the tangent line and shaded integral recompute instantly, and the legend shows the exact area under the curve.

```ext-desmos-lab
id: showcase2-vertex
title: Drag the vertex of a parabola
mode: explore
xRange: [-6, 6]
yRange: [-4, 8]
curves:
  - kind: function
    expr: a*(x-h)^2 + k
    label: f(x)
    tangent: true
    area: { from: 0, to: 2 }
params:
  - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
  - { name: h, min: -4, max: 4, step: 0.1, value: 0 }
  - { name: k, min: -3, max: 5, step: 0.1, value: 0 }
draggables:
  - { paramX: h, paramY: k, label: vertex, color: "#e8d06f" }
```

Hover anywhere on the canvas to scrub the **tangent line** — the slope comes from a symbolic derivative (mathjs), not a numerical approximation.

> [!exercise] Fit the line through P₁ and P₂
> Tune $m$ and $b$ (sliders, or drag the intercept point) until the line passes through both target rings. The distance readouts update live; within tolerance counts as landed.
>
> ```ext-desmos-lab
> id: showcase2-fit-line
> title: Fit the line through P1 and P2
> mode: challenge
> xRange: [-1, 5]
> yRange: [-1, 7]
> curves:
>   - kind: function
>     expr: m*x + b
>     label: y = m x + b
>     color: "#73d695"
> params:
>   - { name: m, min: -4, max: 4, step: 0.05, value: 0 }
>   - { name: b, min: -4, max: 6, step: 0.05, value: 0 }
> draggables:
>   - { paramY: b, x: 0, label: intercept, color: "#6fb7e8" }
> targets:
>   - { x: 1, y: 2, tolerance: 0.15, label: P1 }
>   - { x: 3, y: 4, tolerance: 0.15, label: P2 }
> challengeCurve: 0
> ```

^fit-line-exercise

> [!hint]- Two points determine a line
> The slope is $\frac{4-2}{3-1} = 1$. Then use either point to find the intercept.
