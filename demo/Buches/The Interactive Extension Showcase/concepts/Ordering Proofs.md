---
name: Ordering Proofs
description: Parsons puzzles for code and proofs.
category: Practice
icon: lucide:list-ordered
order: 5
depends_on: []
---

# Ordering Proofs

The `ext-parsons-puzzle` extension scrambles lines of code or steps of a proof; you put them back in order by **dragging** (or clicking) them into the solution area. Distractor lines lurk in the tray — they look plausible but belong nowhere. Checking gives per-line feedback; a perfect arrangement solves the exercise.

> [!exercise] Order the direct proof
> Arrange the steps proving that the sum of two even integers is even. One line in the tray is a distractor.
>
> ```ext-parsons-puzzle
> id: showcase-even-sum-proof
> title: Sum of two evens
> prompt: Arrange the proof steps in a valid logical order. Leave the distractor in the tray.
> lines:
>   - text: "Let m = 2a and n = 2b for integers a, b."
>   - text: "Then m + n = 2a + 2b."
>   - text: "Factor: m + n = 2(a + b)."
>   - text: "Since a + b is an integer, m + n is even."
> distractors:
>   - "Therefore m + n is odd."
> ```

^even-sum-proof

> [!hint]- Start from the definition
> A proof begins by unpacking what "even" means for the two numbers.

> [!exercise] Indent the Python
> Order the lines **and** set the indentation with the arrow buttons on each line. Nesting is graded.
>
> ```ext-parsons-puzzle
> id: showcase-python-indent
> title: Build the sum function
> prompt: |
>   Arrange the lines so `total(n)` returns 1 + 2 + … + n. Indentation matters.
> indentation: true
> lines:
>   - text: "def total(n):"
>     indent: 0
>   - text: "s = 0"
>     indent: 1
>   - text: "for i in range(1, n + 1):"
>     indent: 1
>   - text: "s += i"
>     indent: 2
>   - text: "return s"
>     indent: 1
> distractors:
>   - "return n"
> ```

^python-indent

> [!hint]- Two levels
> The loop body sits one level deeper than the loop header; `return s` aligns with the `for`, not with `s += i`.

Use the up/down arrows to reorder without dragging, and the left/right arrows to change a line's indent. **Shuffle / reset** starts you over with a fresh scramble.
