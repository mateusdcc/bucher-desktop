---
name: Coding Practice
description: Write code that passes hidden tests.
category: Practice
icon: lucide:code-2
order: 4
depends_on: []
---

# Coding Practice

The `ext-code-lab` extension embeds a real editor (CodeMirror) and runs your JavaScript in an **isolated Web Worker** with a timeout — infinite loops are killed, not tolerated. Tests come in two flavors: visible ones show expected vs. received values, hidden ones reveal only pass/fail. Pass them all and the exercise is marked solved automatically.

> [!exercise] Implement binary search
> Write `binarySearch(a, target)` in the editor below. The array is sorted; return the index of `target`, or `-1` when it is absent. Aim for $O(\log n)$ — the stepper in the previous chapter shows exactly the control flow you need.
>
> ```ext-code-lab
> id: showcase-binary-search
> title: Binary search
> description: |
>   Return the index of `target` in the sorted array `a`, or `-1` when absent.
>   Do not mutate the array. Aim for O(log n).
> starter: |
>   function binarySearch(a, target) {
>     // your code here
>   }
> tests:
>   - name: finds the middle
>     fn: binarySearch
>     args: [[1, 3, 5, 7, 9], 5]
>     expected: 2
>   - name: finds the first
>     fn: binarySearch
>     args: [[1, 3, 5, 7, 9], 1]
>     expected: 0
>   - name: finds the last
>     fn: binarySearch
>     args: [[1, 3, 5, 7, 9], 9]
>     expected: 4
>   - name: missing value
>     fn: binarySearch
>     args: [[1, 3, 5], 4]
>     expected: -1
>   - name: empty array
>     fn: binarySearch
>     args: [[], 1]
>     expected: -1
>     hidden: true
>   - name: single element hit
>     fn: binarySearch
>     args: [[42], 42]
>     expected: 0
>     hidden: true
>   - name: duplicates stay in range
>     fn: binarySearch
>     args: [[2, 2, 2, 2], 2]
>     expected: 1
>     hidden: true
> ```

^binary-search-exercise

> [!hint]- Shrink the interval
> Keep two bounds `lo` and `hi`. Each iteration, inspect the middle and discard the half that cannot contain the target.

> [!hint]- Watch the bounds
> The loop condition is `lo <= hi`; update with `lo = mid + 1` or `hi = mid - 1` so the interval strictly shrinks.

Press **Run tests** (or ⌘/Ctrl+Enter in the editor). Your code and results persist — you can leave mid-attempt and come back. When every test passes, check the overview: the solved count goes up by one.
