# Ofek deposits

Bank Ofek intake desk. One `docker compose up` starts PostgreSQL, Kafka, and the desk API.

## Run

```bash
docker compose up --build
```

The desk listens on `http://localhost:3000`.

The desk code is plain Node, split by role:

- `routes` receives the HTTP call
- `controllers` runs the steps in order
- `services` do one job each and do not call each other
- `integration` talks to PostgreSQL and Kafka

Demo banker: username `teller`, password `teller`.

## Endpoints

`POST /login` with `{ "username", "password" }` opens a session and returns a bearer token.

`POST /loads` with the Excel file in field `file`. Requires the session. The desk hashes the file, writes the load journal, saves customers, checks which deposit ids already exist, stores the exact deposit list, and returns what will happen to each row.

`POST /loads/:loadId/decision` with `{ "decision": "no" }` deletes the deposit draft and keeps the customers. `{ "decision": "yes" }` publishes every approved deposit to the Kafka topic `deposits.waiting` and returns once that publish finishes.

Deposit drafts live in Redis for 15 minutes. If that window passes, upload the Excel file again.

The deposits service has no HTTP API. After the yes decision it reads `deposits.waiting`, validates the deposit, and publishes the decision to `deposits.decisions`.

A deposit is `credited`, `pending_approval`, or `rejected` with a reason. Only a credit posts a movement. A term deposit is credited but is not added to the available balance. An amount above 1,000,000 ILS waits for a person. The ILS value uses a fixed table, and only for that threshold: ILS 1, USD 3.7, EUR 4.

A repeated message does not credit the account again. A technical failure is retried 3 times and then published to `deposits.dlq`. A failed row from the file is retried only when its reason is `Core banking timeout`, `Kafka broker unavailable`, or `Database deadlock`.
