import { useEffect, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { ApiError, ask } from "./api";
import { ChartBoundary, compileChart } from "./chart";
import { hebrewError } from "./labels";
import type { AgentAnswer } from "./types";

const SUGGESTIONS: Array<[string, string]> = [
  ["לקוח", "כמה הפקדות יש ללקוח C1001, ומה סך הסכומים לפי מטבע?"],
  ["30 יום", "אילו הפקדות לתקופה קבועה נפדות ב-30 הימים הקרובים?"],
  ["דחייה", "למה הפקדה D50001 נדחתה או נכשלה, והאם אפשר לנסות לעבד אותה שוב?"],
  ["אישור", "כמה הפקדות ממתינות לאישור, ומה הסכום הגדול ביותר?"],
  ["תיק", "תן סיכום של תיק ההפקדות של לקוח C1001."],
];

const ANSWER_TAGS = [
  "article",
  "section",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "strong",
  "em",
  "b",
  "i",
  "span",
  "div",
  "br",
  "code",
  "pre",
  "blockquote",
  "caption",
];

type Turn = {
  id: number;
  question: string;
  answer: AgentAnswer | null;
  error: string | null;
};

export function AgentPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion("");
    const id = Date.now();
    setTurns((current) => [...current, { id, question: text, answer: null, error: null }]);
    try {
      const answer = await ask(text);
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      const message = hebrewError(caught);
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, error: message } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="agent">
      <div className="panel">
        <h2>סוכן</h2>
        <p className="quiet">קורא מהמסד בלבד. לא מעבד הפקדות ולא חושף מספר זהות או טלפון.</p>
        <div className="suggestions">
          {SUGGESTIONS.map(([label, text]) => (
            <button key={label} type="button" className="chip" onClick={() => setQuestion(text)}>
              {label}
            </button>
          ))}
        </div>
        {turns.length > 0 ? (
          <div className="thread">
            {turns.map((turn) => (
              <article key={turn.id} className="turn">
                <p className="ask">{turn.question}</p>
                {turn.error ? <p className="error">{turn.error}</p> : null}
                {turn.answer ? <Answer answer={turn.answer} /> : null}
                {!turn.answer && !turn.error ? <p className="quiet">הסוכן קורא מהמסד…</p> : null}
              </article>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            שאלה
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              maxLength={2000}
              rows={4}
              placeholder="שאלה על ההפקדות"
            />
          </label>
          <button className="button primary" type="submit" disabled={busy || question.trim().length === 0}>
            {busy ? "שואל…" : "שאל"}
          </button>
        </form>
      </div>
    </aside>
  );
}

function Answer({ answer }: { answer: AgentAnswer }) {
  const html = DOMPurify.sanitize(answer.html, { ALLOWED_TAGS: ANSWER_TAGS, ALLOWED_ATTR: [] });
  const chart = useChart(answer.react);

  return (
    <div>
      <div className="answer" dangerouslySetInnerHTML={{ __html: html }} />
      <ChartView chart={chart} />
    </div>
  );
}

function ChartView({ chart }: { chart: { component: (() => ReactNode) | null; rejected: boolean } }) {
  if (chart.rejected) return <p className="quiet">התרשים לא ניתן להצגה.</p>;
  if (!chart.component) return null;
  const Chart = chart.component;
  return (
    <div className="chart">
      <ChartBoundary>
        <Chart />
      </ChartBoundary>
    </div>
  );
}

function useChart(source: string | null): { component: (() => ReactNode) | null; rejected: boolean } {
  const [chart, setChart] = useState<{ component: (() => ReactNode) | null; rejected: boolean }>({
    component: null,
    rejected: false,
  });

  useEffect(() => {
    let live = true;
    if (!source) {
      setChart({ component: null, rejected: false });
      return () => {
        live = false;
      };
    }
    compileChart(source)
      .then((component) => {
        if (live) setChart({ component, rejected: false });
      })
      .catch(() => {
        if (live) setChart({ component: null, rejected: true });
      });
    return () => {
      live = false;
    };
  }, [source]);

  return chart;
}
