---
name: Data with DuckDB
order: 4
description: A real analytical database seeded into the page, with graded SQL.
---

# Data with DuckDB

This block boots **DuckDB-WASM** — the same engine used for serious analytics — and seeds it with the tables below. The schema diagram shows what you can query; results render as sortable tables (click any header).

```ext-sql-duckdb-lab
id: showcase2-explore-sales
title: Explore regional sales
mode: explore
description: Run queries and sort the result table by clicking column headers.
tables:
  - name: sales
    columns:
      - { name: region, type: TEXT }
      - { name: product, type: TEXT }
      - { name: units, type: INTEGER }
      - { name: revenue, type: DOUBLE }
    rows:
      - [EU, Widget, 10, 100.0]
      - [EU, Gizmo, 4, 60.0]
      - [US, Widget, 7, 70.0]
      - [US, Gizmo, 9, 135.0]
      - [APAC, Widget, 12, 120.0]
query: |
  SELECT * FROM sales;
```

> [!exercise] Total revenue per region
> Write one query returning `region` and `total` (revenue summed per region, rounded to 2 decimals). Row order does not matter — the grader compares result sets, with numeric tolerance.
>
> ```ext-sql-duckdb-lab
> id: showcase2-revenue
> title: Total revenue per region
> mode: challenge
> description: |
>   Return each region's total revenue as columns `region` and `total`,
>   rounded to 2 decimals. Row order does not matter.
> tables:
>   - name: sales
>     columns:
>       - { name: region, type: TEXT }
>       - { name: product, type: TEXT }
>       - { name: units, type: INTEGER }
>       - { name: revenue, type: DOUBLE }
>     rows:
>       - [EU, Widget, 10, 100.0]
>       - [EU, Gizmo, 4, 60.0]
>       - [US, Widget, 7, 70.0]
>       - [US, Gizmo, 9, 135.0]
>       - [APAC, Widget, 12, 120.0]
> query: |
>   SELECT region
>   FROM sales;
> expected:
>   columns: [region, total]
>   rows:
>     - [EU, 160.0]
>     - [US, 205.0]
>     - [APAC, 120.0]
>   ordered: false
> ```

^revenue-exercise

> [!hint]- Group and aggregate
> `GROUP BY region` with `SUM(revenue)` — wrap the sum in `ROUND(..., 2)` and alias it `total`.
