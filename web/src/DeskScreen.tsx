import { useEffect, useMemo, useState } from "react";
import { ApiError, decide, uploadWorkbook } from "./api";
import { currencySums, downloadRejections, publishableCount, readDepositAmounts } from "./amounts";
import { actionLabel, formatAmount, formatWhen, hebrewError, reasonLabel, shortHash } from "./labels";
import { readDesk, readJournal, writeDesk, writeJournal, type StoredDesk } from "./storage";
import type { DepositRow, JournalEntry } from "./types";

const FILTERS = [
  ["all", "הכל"],
  ["will_load", "ייטענו"],
  ["will_not_load", "לא ייטענו"],
  ["already_exists", "כבר קיימות"],
  ["duplicate_in_file", "כפילויות"],
] as const;

export function DeskScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [desk, setDesk] = useState<StoredDesk | null>(() => readDesk());
  const [journal, setJournal] = useState<JournalEntry[]>(() => readJournal());
  const [busy, setBusy] = useState<"upload" | "yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"yes" | "no" | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [query, setQuery] = useState("");
  const [fileKey, setFileKey] = useState(0);

  useEffect(() => writeDesk(desk), [desk]);
  useEffect(() => writeJournal(journal), [journal]);

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
      const [next, amounts] = await Promise.all([
        uploadWorkbook(file),
        readDepositAmounts(file).catch(() => new Map()),
      ]);
      setDesk({
        preview: next,
        amounts: Object.fromEntries(amounts),
        decision: null,
      });
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

  async function submit(choice: "yes" | "no") {
    if (!desk) return;
    const loadId = desk.preview.loadId;
    setPending(null);
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
                detail:
                  result.decision === "yes"
                    ? `פורסמו ${result.published} ל-${result.topic}`
                    : "הטיוטה נמחקה, הלקוחות נשארו",
              }
            : entry,
        ),
      );
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  const rejected = preview ? preview.deposits.filter((deposit) => deposit.action !== "will_load").length : 0;
  const locked = Boolean(desk?.decision) || busy !== null;

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
          ההעלאה שומרת את הלקוחות ופותחת רשומה ביומן. טיוטת ההפקדות נשמרת 15 דקות. כן מפרסם ל-Kafka כל שורה
          שיש לה מזהה הפקדה. לא מוחק את הטיוטה ומשאיר את הלקוחות. מספר זהות וטלפון לא מוצגים.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </div>

      {preview && desk ? (
        <div className="panel">
          <div className="section-head">
            <h2>מה ייטען</h2>
            <button
              type="button"
              className="button ghost"
              disabled={rejected === 0}
              onClick={() => downloadRejections(preview)}
            >
              הורדת שורות שלא ייטענו ({rejected})
            </button>
          </div>
          <p className="meta">
            {preview.fileName} · {preview.banker.displayName} · {preview.customersSaved} לקוחות נשמרו ·{" "}
            {shortHash(preview.contentHash)}
          </p>
          <p className="quiet">{preview.loadId}</p>
          <div className="stats">
            <Stat label="נקראו" value={preview.summary.read} />
            <Stat label="ייטענו" value={preview.summary.willLoad} tone="good" />
            <Stat label="לא ייטענו" value={preview.summary.willNotLoad} tone="bad" />
            <Stat label="כבר קיימות" value={preview.summary.alreadyExists} />
            <Stat label="כפילויות בקובץ" value={preview.summary.duplicateInFile} />
            <Stat label="יפורסמו" value={publishableCount(preview.deposits)} />
          </div>

          {desk.decision ? <Result decision={desk.decision} /> : null}

          <div className="actions">
            <button type="button" className="button primary" disabled={locked} onClick={() => setPending("yes")}>
              {busy === "yes" ? "מפרסם…" : "עבד הפקדות"}
            </button>
            <button type="button" className="button danger" disabled={locked} onClick={() => setPending("no")}>
              {busy === "no" ? "מוחק טיוטה…" : "אל תעבד"}
            </button>
          </div>

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
                  <th>שורה</th>
                  <th>הפקדה</th>
                  <th>לקוח</th>
                  <th>מה יקרה</th>
                  <th>סיבה</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5}>אין שורות להצגה</td>
                  </tr>
                ) : (
                  visible.map((deposit) => (
                    <DepositLine key={`${deposit.row}-${deposit.depositId ?? "x"}`} deposit={deposit} />
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

      {journal.length > 0 ? (
        <div className="panel">
          <h2>יומן המפגש</h2>
          <p className="quiet">מי העלה, מתי, איזה קובץ, ומה הוחלט. טעינות קודמות שלא בוצעו במסך הזה לא מוחזרות מהדלפק.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>מתי</th>
                  <th>בנקאי</th>
                  <th>קובץ</th>
                  <th>נקראו</th>
                  <th>ייטענו</th>
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

      {pending && desk ? (
        <Confirm
          choice={pending}
          desk={desk}
          busy={busy !== null}
          onClose={() => setPending(null)}
          onConfirm={() => void submit(pending)}
        />
      ) : null}
    </section>
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

function DepositLine({ deposit }: { deposit: DepositRow }) {
  return (
    <tr data-action={deposit.action}>
      <td>{deposit.row}</td>
      <td>{deposit.depositId ?? "—"}</td>
      <td>{deposit.customerId ?? "—"}</td>
      <td>{actionLabel(deposit.action)}</td>
      <td>{reasonLabel(deposit.reason)}</td>
    </tr>
  );
}

function Result({ decision }: { decision: StoredDesk["decision"] }) {
  if (!decision) return null;
  if (decision.decision === "no") {
    return (
      <div className="banner no">
        <strong>הטיוטה נמחקה. הלקוחות נשארו.</strong>
        <p className="quiet">{decision.message}</p>
      </div>
    );
  }
  return (
    <div className="banner yes">
      <strong>
        פורסמו {decision.published} הפקדות לנושא {decision.topic}
      </strong>
      <p className="quiet">
        שירות ההפקדות מעבד את ההודעות וכותב זיכוי, המתנה לאישור, או דחייה. למסך אין קריאת סטטוס. אפשר לשאול את הסוכן
        אחרי שהכתיבה נגמרת.
      </p>
      <p className="quiet">{decision.message}</p>
      {decision.depositIds.length > 0 ? (
        <details>
          <summary>{decision.depositIds.length} מזהים שפורסמו</summary>
          <p className="ids">{decision.depositIds.join("  ")}</p>
        </details>
      ) : null}
    </div>
  );
}

function Confirm({
  choice,
  desk,
  busy,
  onClose,
  onConfirm,
}: {
  choice: "yes" | "no";
  desk: StoredDesk;
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

  const published = publishableCount(desk.preview.deposits);
  const ready = currencySums(desk.preview.deposits, new Map(Object.entries(desk.amounts)), "will_load");

  return (
    <div className="dialog-back" onClick={() => !busy && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{choice === "yes" ? "לעבד את ההפקדות?" : "לא לעבד?"}</h2>
        {choice === "no" ? (
          <p>טיוטת ההפקדות תימחק. הלקוחות שכבר נשמרו בהעלאה יישארו במסד. שום הודעה לא תפורסם.</p>
        ) : (
          <>
            <p>
              יפורסמו {published} הודעות לנושא deposits.waiting. {desk.preview.summary.willLoad} שורות סומנו כתקינות.
            </p>
            {published !== desk.preview.summary.willLoad ? (
              <p>
                שורות עם מזהה הפקדה נשלחות גם אם לא סומנו כתקינות. שירות ההפקדות מזכה, מעביר לאישור אנושי, או דוחה.
              </p>
            ) : null}
            <h3>סכום השורות התקינות לפי מטבע</h3>
            {ready.sums.length > 0 ? (
              <ul className="sums">
                {ready.sums.map(([currency, total]) => (
                  <li key={currency}>
                    <span>{currency}</span>
                    <span>{formatAmount(total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet">אין סכום זמין מהקובץ עבור השורות התקינות.</p>
            )}
            {ready.missing > 0 ? (
              <p className="quiet">{ready.missing} שורות תקינות בלי סכום או מטבע בקובץ.</p>
            ) : null}
            <p className="quiet">הסכום נקרא מהקובץ שנבחר, לפי השורות שהדלפק סימן לטעינה. הדלפק לא מחזיר סכום.</p>
          </>
        )}
        <div className="actions">
          <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
            {choice === "yes" ? "פרסם לעיבוד" : "מחק טיוטה"}
          </button>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>
            חזרה
          </button>
        </div>
      </div>
    </div>
  );
}

function decisionText(entry: JournalEntry): string {
  if (entry.decision === "yes") return entry.detail ?? "עובד";
  if (entry.decision === "no") return "לא עובד";
  return "ממתין להחלטה";
}
