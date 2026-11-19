---
name: Watching Algorithms Run
description: Step through traces and state machines.
category: Visualization
icon: lucide:play-circle
order: 3
depends_on: []
---

# Watching Algorithms Run

The `ext-state-stepper` extension plays a list of **full snapshots**: array cells with pointers and highlights, variable chips, and prose. Use Prev/Next, the arrow keys, or Auto-Play with a speed of your choice. Your position in the trace is saved.

## Bubble sort, one pass

Watch the larger value "bubble" to the right. The yellow markers are the indices `i` and `j`; green cells are the pair being compared.

```ext-state-stepper
id: showcase-bubble-sort
title: Bubble sort — first pass
steps:
  - title: Start
    explanation: Compare the first two cells; swap them if they are out of order.
    arrays:
      - name: a
        values: [5, 2, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 0 }
  - title: Swap 5 and 2
    explanation: 5 > 2, so the pair is swapped. The larger value moves right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 1 }
  - title: Advance
    explanation: 5 < 8 — no swap. Slide the comparison window one cell right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [1, 2]
        pointers: { i: 1, j: 2 }
    variables: { swaps: 1 }
  - title: Swap 8 and 1
    explanation: 8 > 1, swap. After this pass the maximum (8) sits at the end.
    arrays:
      - name: a
        values: [2, 5, 1, 8]
        highlight: [2, 3]
        pointers: { i: 2, j: 3 }
    variables: { swaps: 2 }
```

## A state machine

The same player renders node-and-edge diagrams. Step through a connection opening; the active state and the taken transition light up:

```ext-state-stepper
id: showcase-connection-states
title: Opening a connection
steps:
  - title: Closed
    explanation: The socket starts closed; nothing is listening yet.
    nodes:
      - { id: closed, label: CLOSED, active: true }
      - { id: listen, label: LISTEN }
      - { id: established, label: ESTABLISHED }
    edges:
      - { from: closed, to: listen, label: open }
      - { from: listen, to: established, label: handshake }
  - title: Listening
    explanation: A passive open moves the socket to LISTEN, waiting for a SYN.
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN, active: true }
      - { id: established, label: ESTABLISHED }
    edges:
      - { from: closed, to: listen, label: open, active: true }
      - { from: listen, to: established, label: handshake }
  - title: Established
    explanation: The three-way handshake completes; data can flow.
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN }
      - { id: established, label: ESTABLISHED, active: true }
    edges:
      - { from: closed, to: listen, label: open }
      - { from: listen, to: established, label: handshake, active: true }
```

Press Auto-Play on the trace above and watch the whole pass run at 2×.
