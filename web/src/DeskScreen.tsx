import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  decide,
  decideApproval,
  downloadRejections,
  listCases,
  pendingQueue,
  processPending,
  readCase,
  readHistory,
  retryDeposits,
  uploadWorkbook,
} from "./api";
import { sumsFor } from "./amounts";
import { actionLabel, formatAmount, formatWhen, hebrewError, reasonLabel, shortHash, statusLabel } from "./labels";
import { readDesk, readJournal, writeDesk, writeJournal, type StoredDesk } from "./storage";
import type {
  DecisionResult,
  DepositCase,
  DepositRow,
  JournalEntry,
  PendingSummary,
  ProcessResult,
  StatusEvent,
} from "./types";

const FILTERS = [
  ["all", "הכל"],
  ["will_load", "ממתינות"],
  ["failed_from_file", "נכשלו בקובץ"],
  ["will_not_load", "לא יישמרו"],
  ["already_exists", "כבר קיימות"],
  ["duplicate_in_file", "כפילויות"],
] as const;

const TERMINAL = new Set(["Completed", "Failed", "PendingApproval"]);

export function DeskScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [desk, setDesk] = useState<StoredDesk | null>(() => readDesk());
  const [journal, setJournal] = useState<JournalEntry[]>(() => readJournal());
  const [busy, setBusy] = useState<"upload" | "yes" | "no" | "process" | "retry" | "queue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"save" | "discard" | "process" | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [query, setQuery] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const [queue, setQueue] = useState<PendingSummary | null>(null);
  const [lastRun, setLastRun] = useState<ProcessResult | null>(null);
  const [tracked, setTracked] = useState<string[]>([]);
  const [cases, setCases] = useState<Record<string, DepositCase>>({});
  const [approvals, setApprovals] = useState<DepositCase[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => writeDesk(desk), [desk]);
  useEffect(() => writeJournal(journal), [journal]);

  useEffect(() => {
    let live = true;
    pendingQueue()
      .then((next) => {
        if (live) setQueue(next);
      })
      .catch(() => undefined);
    listCases("PendingApproval")
      .then((rows) => {
        if (live) setApprovals(rows);
      })
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 401) onUnauthorizedRef.current();
      });
    return () => {
      live = false;
    };
  }, []);

  const trackedKey = tracked.join("\n");
  useEffect(() => {
    const ids = trackedKey ? trackedKey.split("\n") : [];
    if (ids.length === 0) return;
    let live = true;
    let timer = 0;
    const tick = async () => {
      const found: Record<string, DepositCase> = {};
      let denied = false;
      await Promise.all(
        ids.map(async (id) => {
          try {
            found[id] = await readCase(id);
          } catch (caught) {
            if (caught instanceof ApiError && caught.status === 401) denied = true;
          }
        }),
      );
      if (!live) return;
      if (denied) {
        onUnauthorizedRef.current();
        return;
      }
      setCases((current) => ({ ...current, ...found }));
      if (!ids.every((id) => found[id] && TERMINAL.has(found[id].status))) {
        timer = window.setTimeout(() => void tick(), 2000);
        return;
      }
      try {
        const waiting = await listCases("PendingApproval");
        if (live) setApprovals(waiting);
      } catch {
        // The rows already on screen keep the status from the last read.
      }
    };
    void tick();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [trackedKey]);

  const preview = desk?.preview ?? null;
  const visible = useMemo(() => {
    if (!preview) return [];
    const needle = query.trim().toLowerCase();
    return preview.deposits.filter((deposit) => {
      if (filter !== "all" && deposit.action !== filter) return false;
      if (!needle) return true;
      return (
        (deposit.depositId ?? "").toLowerCase().includes(needle) ||
        (deposit.customerId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [preview, filter, query]);

  function fail(caught: unknown) {
    if (caught instanceof ApiError && caught.status === 401) {
      onUnauthorized();
      return;
    }
    setError(hebrewError(caught));
  }

  function remember(ids: string[]) {
    setTracked((current) => {
      const added = ids.filter((id) => id && !current.includes(id));
      return added.length === 0 ? current : [...added, ...current];
    });
  }

  async function refreshQueue() {
    setQueue(await pendingQueue());
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("אפשר להעלות רק קובץ xlsx");
      setFileKey((value) => value + 1);
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const next = await uploadWorkbook(file);
      setDesk({ preview: next, decision: null });
      setSelected(new Set());
      setFilter("all");
      setQuery("");
      setJournal((current) =>
        [
          {
            loadId: next.loadId,
            at: new Date().toISOString(),
            bankerName: next.banker.displayName,
            fileName: next.fileName,
            contentHash: next.contentHash,
            customersSaved: next.customersSaved,
            summary: next.summary,
            decision: null,
            detail: null,
          },
          ...current.filter((entry) => entry.loadId !== next.loadId),
        ].slice(0, 20),
      );
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
      setFileKey((value) => value + 1);
    }
  }

  async function submitSave(choice: "yes" | "no") {
    if (!desk) return;
    const loadId = desk.preview.loadId;
    setConfirm(null);
    setBusy(choice);
    setError(null);
    try {
      const result = await decide(loadId, choice);
      setDesk((current) => (current && current.preview.loadId === loadId ? { ...current, decision: result } : current));
      setJournal((current) =>
        current.map((entry) =>
          entry.loadId === loadId
            ? {
                ...entry,
                decision: result.decision,
                detail: result.decision === "yes" ? `נשמרו ${result.loaded}, נדחו ${result.rejected}` : "לא נשמר דבר",
              }
            : entry,
        ),
      );
      if (result.decision === "yes") await refreshQueue();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  async function openProcess() {
    setBusy("queue");
    setError(null);
    try {
      setQueue(await pendingQueue());
      setConfirm("process");
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  async function submitProcess() {
    setConfirm(null);
    setBusy("process");
    setError(null);
    try {
      const result = await processPending();
      setLastRun(result);
      remember(result.depositIds);
      await refreshQueue();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  async function submitRetry() {
    if (!preview) return;
    const depositIds = [...selected];
    setBusy("retry");
    setError(null);
    try {
      const result = await retryDeposits(depositIds);
      setLastRun(result);
      remember(result.depositIds);
      setSelected(new Set());
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    if (!preview) return;
    setError(null);
    try {
      await downloadRejections(preview.loadId);
    } catch (caught) {
      fail(caught);
    }
  }

  async function onApproval(depositId: string, decision: "approve" | "reject") {
    setError(null);
    try {
      const updated = await decideApproval(depositId, decision);
      remember([depositId]);
      setCases((current) => ({ ...current, [depositId]: updated }));
      setApprovals((current) => current.filter((item) => item.depositId !== depositId));
    } catch (caught) {
      fail(caught);
    }
  }

  const rejectedCount = preview
    ? preview.deposits.filter((deposit) => deposit.action !== "will_load" && deposit.action !== "failed_from_file").length +
      (preview.customerRejections?.length ?? 0)
    : 0;
  const failedRows = preview?.deposits.filter((deposit) => deposit.action === "failed_from_file" && deposit.depositId) ?? [];
  const saved = desk?.decision?.decision === "yes";
  const locked = Boolean(desk?.decision) || busy !== null;
  const shownIds = [...tracked];
  for (const item of approvals) {
    if (!shownIds.includes(item.depositId)) shownIds.push(item.depositId);
  }

  return (
    <section className="desk">
      <div className="panel">
        <div className="section-head">
          <h2>קליטת קובץ</h2>
          <label className="upload">
            <input
              key={fileKey}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
              disabled={busy !== null}
            />
            <span>{busy === "upload" ? "קורא את הקובץ…" : "העלאת xlsx"}</span>
          </label>
        </div>
        <p className="note">
          ההעלאה מציגה מה יישמר. שמירה כותבת לקוחות ושורות לדלפק, בלי לעבד. עיבוד הוא כפתור נפרד על כל מה שכבר שמור
          וממתין. מספר זהות וטלפון לא מוצגים.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </div>

      <QueuePanel queue={queue} busy={busy} onOpen={() => void openProcess()} />

      {preview && desk ? (
        <div className="panel">
          <div className="section-head">
            <h2>מה יישמר</h2>
            <button type="button" className="button ghost" disabled={rejectedCount === 0} onClick={() => void onDownload()}>
              הורדת דחיות ({rejectedCount})
            </button>
          </div>
          <p className="meta">
            {preview.fileName} · {preview.banker.displayName} · {preview.customersSaved} לקוחות תקינים
            {saved ? " · נשמרו" : " · עדיין לא נשמרו"} · {shortHash(preview.contentHash)}
          </p>
          <p className="quiet">{preview.loadId}</p>
          {preview.replay ? <p className="note">הקובץ הזה כבר נפתח. שמירה נוספת תיעצר אם הוא כבר נשמר.</p> : null}
          <div className="stats">
            <Stat label="נקראו" value={preview.summary.read} />
            <Stat label="ממתינות" value={preview.summary.willLoad} tone="good" />
            <Stat label="לא יישמרו" value={preview.summary.willNotLoad} tone="bad" />
            <Stat label="כבר קיימות" value={preview.summary.alreadyExists} />
            <Stat label="כפילויות" value={preview.summary.duplicateInFile} />
            <Stat label="נכשלו בקובץ" value={preview.summary.failedFromFile ?? 0} />
          </div>

          {desk.decision ? <Result decision={desk.decision} /> : null}
          <CustomerRejections rows={preview.customerRejections ?? []} />

          <div className="actions">
            <button type="button" className="button primary" disabled={locked} onClick={() => setConfirm("save")}>
              {busy === "yes" ? "שומר…" : "שמור קליטה"}
            </button>
            <button type="button" className="button danger" disabled={locked} onClick={() => setConfirm("discard")}>
              {busy === "no" ? "מבטל…" : "אל תשמור"}
            </button>
            <button
              type="button"
              className="button ghost"
              disabled={!saved || selected.size === 0 || busy !== null}
              onClick={() => void submitRetry()}
            >
              {busy === "retry" ? "שולח ניסיון…" : `נסה שוב (${selected.size})`}
            </button>
          </div>
          {failedRows.length > 0 && !saved ? (
            <p className="quiet">שורות שנכשלו בקובץ נשמרות עם השמירה, ואז אפשר לסמן אותן לניסיון חוזר.</p>
          ) : null}

          <div className="toolbar">
            <div className="filters">
              {FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={filter === id ? "chip active" : "chip"}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש מזהה הפקדה או לקוח"
              aria-label="חיפוש מזהה הפקדה או לקוח"
            />
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {failedRows.length > 0 ? <th>נסה</th> : null}
                  <th>שורה</th>
                  <th>הפקדה</th>
                  <th>לקוח</th>
                  <th>סכום</th>
                  <th>מטבע</th>
                  <th>מה יקרה</th>
                  <th>סיבה</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={failedRows.length > 0 ? 8 : 7}>אין שורות להצגה</td>
                  </tr>
                ) : (
                  visible.map((deposit) => (
                    <DepositLine
                      key={`${deposit.row}-${deposit.depositId ?? "x"}`}
                      deposit={deposit}
                      selectable={failedRows.length > 0}
                      checked={deposit.depositId ? selected.has(deposit.depositId) : false}
                      enabled={saved && busy === null && deposit.action === "failed_from_file"}
                      onToggle={() => {
                        if (!deposit.depositId) return;
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(deposit.depositId as string)) next.delete(deposit.depositId as string);
                          else next.add(deposit.depositId as string);
                          return next;
                        });
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="quiet">
            מוצגות {visible.length} מתוך {preview.deposits.length}
          </p>
        </div>
      ) : null}

      {shownIds.length > 0 ? (
        <CaseTable
          ids={shownIds}
          cases={cases}
          approvals={approvals}
          lastRun={lastRun}
          onApproval={(id, decision) => void onApproval(id, decision)}
        />
      ) : null}

      {journal.length > 0 ? (
        <div className="panel">
          <h2>יומן המפגש</h2>
          <p className="quiet">מי העלה, מתי, איזה קובץ, ומה נשמר. הטעינות כאן הן של המסך הזה.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>מתי</th>
                  <th>בנקאי</th>
                  <th>קובץ</th>
                  <th>נקראו</th>
                  <th>ממתינות</th>
                  <th>החלטה</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((entry) => (
                  <tr key={entry.loadId}>
                    <td>{formatWhen(entry.at)}</td>
                    <td>{entry.bankerName}</td>
                    <td title={entry.contentHash}>{entry.fileName}</td>
                    <td>{entry.summary.read}</td>
                    <td>{entry.summary.willLoad}</td>
                    <td>{decisionText(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {confirm && (confirm === "process" || desk) ? (
        <Confirm
          mode={confirm}
          desk={desk}
          queue={queue}
          busy={busy !== null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "process") void submitProcess();
            else void submitSave(confirm === "save" ? "yes" : "no");
          }}
        />
      ) : null}
    </section>
  );
}

function QueuePanel({
  queue,
  busy,
  onOpen,
}: {
  queue: PendingSummary | null;
  busy: string | null;
  onOpen: () => void;
}) {
  return (
    <div className="panel">
      <div className="section-head">
        <h2>הפקדות ממתינות</h2>
        <button type="button" className="button primary" disabled={busy !== null} onClick={onOpen}>
          {busy === "process" ? "מפרסם…" : "עבד הפקדות ממתינות"}
        </button>
      </div>
      <p className="note">הכפתור שולח כל שורה שמורה בסטטוס Pending, מכל הטעינות. שורות שנכשלו בקובץ לא נשלחות כאן.</p>
      {queue ? (
        <>
          <p>
            {queue.count} ממתינות
            {queue.totals.length > 0 ? ` · ${queue.totals.map((total) => `${total.currency} ${formatAmount(total.amount)}`).join(" · ")}` : ""}
          </p>
        </>
      ) : (
        <p className="quiet">התור עדיין לא נקרא.</p>
      )}
    </div>
  );
}

function CaseTable({
  ids,
  cases,
  approvals,
  lastRun,
  onApproval,
}: {
  ids: string[];
  cases: Record<string, DepositCase>;
  approvals: DepositCase[];
  lastRun: ProcessResult | null;
  onApproval: (depositId: string, decision: "approve" | "reject") => void;
}) {
  return (
    <div className="panel">
      <h2>סטטוס עיבוד</h2>
      {lastRun ? (
        <p className="quiet">
          נשלחו {lastRun.published} ל-{lastRun.topic}.
          {lastRun.skipped && lastRun.skipped.length > 0 ? ` לא נשלחו: ${lastRun.skipped.join(", ")}` : ""}
        </p>
      ) : (
        <p className="quiet">מוצגות גם הפקדות שכבר ממתינות לאישור.</p>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>הפקדה</th>
              <th>לקוח</th>
              <th>סכום</th>
              <th>סטטוס</th>
              <th>סיבה</th>
              <th>פעולה</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const item = cases[id] ?? approvals.find((row) => row.depositId === id) ?? null;
              return (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{item?.customerId ?? "—"}</td>
                  <td>{item?.amount === null || item?.amount === undefined ? "—" : `${formatAmount(item.amount)} ${item.currency ?? ""}`}</td>
                  <td>{item ? <span className={`status ${item.status}`}>{statusLabel(item.status)}</span> : "ממתין לכתיבה"}</td>
                  <td>{reasonLabel(item?.decisionReason ?? null)}</td>
                  <td>
                    {item?.status === "PendingApproval" ? (
                      <div className="actions">
                        <button type="button" className="button small primary" onClick={() => onApproval(id, "approve")}>
                          אשר
                        </button>
                        <button type="button" className="button small danger" onClick={() => onApproval(id, "reject")}>
                          דחה
                        </button>
                      </div>
                    ) : null}
                    {item ? <History depositId={id} /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History({ depositId }: { depositId: string }) {
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (events) {
      setEvents(null);
      return;
    }
    setError(null);
    try {
      setEvents(await readHistory(depositId));
    } catch (caught) {
      setError(hebrewError(caught));
    }
  }

  return (
    <>
      <button type="button" className="button ghost small" onClick={() => void load()}>
        {events ? "הסתר היסטוריה" : "היסטוריה"}
      </button>
      {error ? <span className="error">{error}</span> : null}
      {events ? (
        <ul className="sums">
          {events.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <span>{statusLabel(event.status)}</span>
              <span>{reasonLabel(event.reason) || formatWhen(event.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function CustomerRejections({ rows }: { rows: { row: number; customerId: string | null; reason: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3>לקוחות שלא יישמרו</h3>
      <ul className="sums">
        {rows.map((row) => (
          <li key={`${row.row}-${row.customerId ?? "x"}`}>
            <span>
              שורה {row.row}
              {row.customerId ? ` · ${row.customerId}` : ""}
            </span>
            <span>{reasonLabel(row.reason)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className={tone ? `stat ${tone}` : "stat"}>
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function DepositLine({
  deposit,
  selectable,
  checked,
  enabled,
  onToggle,
}: {
  deposit: DepositRow;
  selectable: boolean;
  checked: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <tr data-action={deposit.action}>
      {selectable ? (
        <td>
          {deposit.action === "failed_from_file" && deposit.depositId ? (
            <input type="checkbox" checked={checked} disabled={!enabled} onChange={onToggle} aria-label={`נסה שוב ${deposit.depositId}`} />
          ) : null}
        </td>
      ) : null}
      <td>{deposit.row}</td>
      <td>{deposit.depositId ?? "—"}</td>
      <td>{deposit.customerId ?? "—"}</td>
      <td>{deposit.amount === null || deposit.amount === undefined ? "—" : formatAmount(deposit.amount)}</td>
      <td>{deposit.currency ?? "—"}</td>
      <td>{actionLabel(deposit.action)}</td>
      <td>{reasonLabel(deposit.reason)}</td>
    </tr>
  );
}

function Result({ decision }: { decision: DecisionResult }) {
  if (decision.decision === "no") {
    return (
      <div className="banner no">
        <strong>לא נשמר דבר.</strong>
        <p className="quiet">{decision.message}</p>
      </div>
    );
  }
  return (
    <div className="banner yes">
      <strong>
        נשמרו {decision.loaded} שורות הפקדה. נדחו {decision.rejected}.
      </strong>
      <p className="quiet">
        {decision.pending} ממתינות לעיבוד. {decision.failedFromFile} נשמרו ככושלות ולא יישלחו בכפתור הראשי.
      </p>
      <p className="quiet">{decision.message}</p>
    </div>
  );
}

function Confirm({
  mode,
  desk,
  queue,
  busy,
  onClose,
  onConfirm,
}: {
  mode: "save" | "discard" | "process";
  desk: StoredDesk | null;
  queue: PendingSummary | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const ready = mode === "save" && desk ? sumsFor(desk.preview.deposits, "will_load") : { sums: [] as Array<[string, number]> };
  const title = mode === "save" ? "לשמור את הקליטה?" : mode === "discard" ? "לא לשמור?" : "לעבד את הממתינות?";
  const action = mode === "save" ? "שמור" : mode === "discard" ? "בטל בלי שמירה" : "עבד";
  const processBlocked = mode === "process" && (queue?.count ?? 0) === 0;

  return (
    <div className="dialog-back" onClick={() => !busy && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        {mode === "discard" ? <p>שום לקוח ושום הפקדה לא ייכתבו.</p> : null}
        {mode === "save" ? (
          <>
            <p>
              יישמרו {desk?.preview.summary.willLoad ?? 0} הפקדות ממתינות ו-{desk?.preview.summary.failedFromFile ?? 0}{" "}
              שנכשלו בקובץ. העיבוד לא מתחיל כאן.
            </p>
            <Sums title="סכום הממתינות לפי מטבע" sums={ready.sums} />
          </>
        ) : null}
        {mode === "process" ? (
          <>
            <p>
              {queue ? `${queue.count} הפקדות ממתינות יישלחו לעיבוד.` : "התור לא נקרא."} רק שורות שכבר נשמרו, ורק
              Pending.
            </p>
            <Sums title="סכום לפי מטבע" sums={(queue?.totals ?? []).map((total) => [total.currency, total.amount])} />
          </>
        ) : null}
        <div className="actions">
          <button type="button" className="button primary" disabled={busy || processBlocked} onClick={onConfirm}>
            {action}
          </button>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>
            חזרה
          </button>
        </div>
      </div>
    </div>
  );
}

function Sums({ title, sums }: { title: string; sums: Array<[string, number]> }) {
  return (
    <>
      <h3>{title}</h3>
      {sums.length > 0 ? (
        <ul className="sums">
          {sums.map(([currency, total]) => (
            <li key={currency}>
              <span>{currency}</span>
              <span>{formatAmount(total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">אין סכום להצגה.</p>
      )}
    </>
  );
}

function decisionText(entry: JournalEntry): string {
  if (entry.decision === "yes") return entry.detail ?? "נשמר";
  if (entry.decision === "no") return "לא נשמר";
  return "ממתין לשמירה";
}
