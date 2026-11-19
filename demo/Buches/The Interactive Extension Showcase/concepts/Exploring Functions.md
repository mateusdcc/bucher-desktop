---
name: Exploring Functions
description: Live plots with parameter sliders.
category: Visualization
icon: lucide:line-chart
order: 2
depends_on: []
---

# Exploring Functions

The `ext-math-plot` extension plots functions, parametric curves, and datasets on a canvas. Expressions are interpreted by a small safe parser — no `eval` — and every declared parameter becomes a **live slider**. Hover the canvas to read exact values; drag to pan and scroll to zoom.

## The quadratic family

Move the sliders and watch the parabola respond. What does $a$ do to the width? What does $c$ do to the vertex?

```ext-math-plot
id: showcase-quadratic
title: Exploring a·x² + b·x + c
xRange: [-6, 6]
functions:
  - expr: a*x^2 + b*x + c
    label: f(x)
params:
  - name: a
    min: -3
    max: 3
    step: 0.1
    value: 1
  - name: b
    min: -5
    max: 5
    step: 0.1
    value: 0
  - name: c
    min: -5
    max: 5
    step: 0.1
    value: 0
```

Set $a = 0$ and the parabola collapses into the line $bx + c$ — a degenerate case worth seeing once.

## Parametric motion

A Lissajous figure traces $\big(\sin(at + \pi/2),\ \sin(bt)\big)$. Change the frequency ratio $a : b$ and watch the knot re-tie itself:

```ext-math-plot
id: showcase-lissajous
title: Lissajous figure
xRange: [-1.4, 1.4]
yRange: [-1.4, 1.4]
parametric:
  - x: sin(a*t + pi/2)
    y: sin(b*t)
    tRange: [0, 6.283185]
    label: trace
params:
  - name: a
    min: 1
    max: 5
    step: 1
    value: 3
  - name: b
    min: 1
    max: 5
    step: 1
    value: 2
```

Slider positions persist with your book progress, so a configuration you found interesting is still there tomorrow.
