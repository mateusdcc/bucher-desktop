---
name: Polyglot Coding
order: 3
description: Real Python 3.14 (WebAssembly) and JavaScript exercises in a tabbed IDE.
---

# Polyglot Coding

The studio below is a real IDE: tabbed **Solution / Tests / Hints** editors, a stdout console, execution timers, and diff-highlighted failures. Python runs in **Pyodide — actual CPython compiled to WebAssembly**, self-hosted and loaded on demand; JavaScript runs in an isolated worker. Watch the runtime indicator in Settings → Extensions go warm on your first run.

> [!exercise] Two Sum (Python)
> Implement `two_sum(nums, target)` returning the two indices whose values sum to `target`. One hidden test guards the negative-number edge case.
>
> ```ext-polyglot-studio
> id: showcase2-two-sum
> title: "Two Sum (Python)"
> language: python
> description: |
>   Given a list of integers `nums` and an integer `target`, return the
>   **indices** of the two numbers that add up to `target` (ascending order).
>   Exactly one solution exists; you may not use the same element twice.
> starter: |
>   def two_sum(nums, target):
>       # Return the two indices whose values sum to target.
>       pass
> tests:
>   - name: basic pair
>     fn: two_sum
>     args: [[2, 7, 11, 15], 9]
>     expected: [0, 1]
>   - name: middle pair
>     fn: two_sum
>     args: [[3, 2, 4], 6]
>     expected: [1, 2]
>   - name: negatives (hidden)
>     fn: two_sum
>     args: [[-3, 4, 3, 90], 0]
>     expected: [0, 2]
>     hidden: true
> hints:
>   - A brute-force double loop works in O(n²).
>   - Store seen values in a dict mapping value → index.
>   - For each x, check whether target - x is already in the dict.
> ```

^two-sum-exercise

> [!exercise] Fibonacci (JavaScript)
> Same studio, different engine: iterative `fib(n)` with a hidden large-$n$ test that punishes naive recursion.
>
> ```ext-polyglot-studio
> id: showcase2-fib
> title: "Fibonacci (JavaScript)"
> language: javascript
> description: |
>   Return the n-th Fibonacci number (0-indexed): fib(0) = 0, fib(1) = 1.
>   Use an iterative approach so large n stay fast.
> starter: |
>   function fib(n) {
>     // Return the n-th Fibonacci number.
>     return 0;
>   }
> tests:
>   - { name: zero, fn: fib, args: [0], expected: 0 }
>   - { name: one, fn: fib, args: [1], expected: 1 }
>   - { name: ten, fn: fib, args: [10], expected: 55 }
>   - { name: large (hidden), fn: fib, args: [50], expected: 12586269025, hidden: true }
> hints:
>   - Keep two running values and slide them forward n times.
> ```

^fib-exercise

Your code, console output, and results persist — leave mid-attempt and come back later.
