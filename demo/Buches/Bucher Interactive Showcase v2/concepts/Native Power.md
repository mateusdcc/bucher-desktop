---
name: Native Power
order: 6
description: Desktop-only superpowers — real git, real pipelines, real system facts, sandboxed by Rust.
---

# Native Power

Everything in this chapter runs **outside the web sandbox**, in Rust commands confined to an isolated workspace under the app's data directory: allowlisted programs only, no shell, sanitized environment, hard timeouts. On the web, these blocks show a capability card instead — try it and see the platform degrade gracefully.

> [!exercise] Git: feature branch workflow
> Use the terminal: create `feature`, add `hello.txt` containing exactly `hello`, and commit with a message containing "add greeting". Then press **Verify native state** — the checks inspect the real repository.
>
> ```ext-tauri-native-workbench
> id: showcase2-git
> title: "Git: feature branch workflow"
> kind: git
> description: |
>   Create a branch named `feature`, add a file `hello.txt` containing
>   exactly `hello` (one line), and commit it with a message containing
>   "add greeting". Use the terminal below; verify when done.
> setup:
>   gitInit: true
>   files:
>     - { path: README.md, content: "# Demo project\n" }
> checks:
>   - { type: branch-exists, name: feature }
>   - { type: current-branch, name: feature }
>   - { type: file-equals, path: hello.txt, content: "hello\n" }
>   - { type: log-contains, text: add greeting }
> ```

^git-workflow-exercise

> [!hint]- The four commands
> `git checkout -b feature` · `echo hello > hello.txt` · `git add hello.txt` · `git commit -m "add greeting"`

> [!exercise] Pipeline: count the errors
> Chain allowlisted programs with `|` and redirect with `>` to save the count of ERROR lines into `count.txt`.
>
> ```ext-tauri-native-workbench
> id: showcase2-pipeline
> title: "Pipeline: count the errors"
> kind: pipeline
> description: |
>   `server.log` contains mixed log lines. Build a pipeline that counts the
>   lines containing `ERROR` and save the number to `count.txt`.
> setup:
>   files:
>     - path: server.log
>       content: |
>         INFO started
>         ERROR disk full
>         INFO retrying
>         ERROR timeout
>         INFO done
> checks:
>   - type: pipeline-output
>     stages:
>       - [cat, server.log]
>       - [grep, ERROR]
>       - [wc, "-l"]
>     expected: "2"
>   - { type: file-equals, path: count.txt, content: "2\n" }
> ```

^pipeline-exercise

> [!hint]- One line does it
> `cat server.log | grep ERROR | wc -l > count.txt`

Finally, the machine you're actually running on — reported by `sysinfo` through the native bridge:

```ext-tauri-native-workbench
id: showcase2-system
title: This machine
kind: system
mode: explore
description: Real host facts reported by the Rust backend (sysinfo).
```
