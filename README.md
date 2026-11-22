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

A deposit is `credited`, `pending_approval`, or `rejected` with a reason. Only a credit posts a movement. A term deposit is credited but is not added to the available balance. An amount above 1,000,000 ILS waits for a person. The ILS value for that threshold comes from the `exchange_rates` table.

A repeated message does not credit the account again. A technical failure is retried 3 times and then published to `deposits.dlq`. A failed row from the file is retried only when its reason is `Core banking timeout`, `Kafka broker unavailable`, or `Database deadlock`.

The agent listens on `http://localhost:3001`. `POST /ask` with `{ "question" }` returns `{ "html", "react" }`. `html` is the answer. `react` is null, or one `Chart` component when a graph helps. The agent uses a read-only database user, `agent_reader`, limited to `agent_customers` (no national id or phone), `deposits`, `movements`, `balances`, and `load_journal`. Set `OPENAI_API_KEY` before starting it.
