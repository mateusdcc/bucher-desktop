---
name: Querying Data
description: SQL practice against a seeded database.
category: Practice
icon: lucide:database
order: 6
depends_on: []
---

# Querying Data

The `ext-sql-lab` extension seeds a fresh in-memory database (alasql) before every attempt, runs your query, renders the result table, and grades it against the expected rows. Row order is ignored unless the task demands `ORDER BY`. The schema is shown above the editor; the expected result stays hidden until you ask for it.

> [!exercise] Orders per customer
> Return each customer's `name` and the number of their orders as `orders`. Two tables are involved — you will need a join and a grouping.
>
> ```ext-sql-lab
> id: showcase-orders-per-customer
> title: Orders per customer
> prompt: |
>   Return each customer's `name` and the number of their orders as `orders`.
> setup: |
>   CREATE TABLE customers (id INT, name STRING);
>   CREATE TABLE orders (id INT, customer_id INT);
>   INSERT INTO customers VALUES (1, 'Ada');
>   INSERT INTO customers VALUES (2, 'Grace');
>   INSERT INTO customers VALUES (3, 'Alan');
>   INSERT INTO orders VALUES (10, 1);
>   INSERT INTO orders VALUES (11, 1);
>   INSERT INTO orders VALUES (12, 2);
> starter: |
>   SELECT c.name, COUNT(*) AS orders
>   FROM customers c
> expected:
>   - { name: Ada, orders: 2 }
>   - { name: Grace, orders: 1 }
> ```

^orders-per-customer

> [!hint]- Join first
> `JOIN orders o ON o.customer_id = c.id` pairs each order with its customer.

> [!hint]- Then group
> `GROUP BY c.name` collapses each customer's rows so `COUNT(*)` counts their orders. Customers without orders (Alan) should not appear — an inner join handles that.

Run the starter as-is to see the failure mode, then fix it. When the verdict turns green, the exercise is solved — and your query is saved for next time.
