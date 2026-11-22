import { Component, createElement, Fragment, type ReactNode } from "react";

const BANNED =
  /\b(import|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document|window|eval|Function|process|require|globalThis|__proto__)\b|<\s*script/i;

export async function compileChart(source: string): Promise<() => ReactNode> {
  const stripped = source
    .trim()
    .replace(/^```(?:jsx|tsx|js|ts)?\s*/i, "")
    .replace(/```$/u, "")
    .replace(/^\s*export\s+default\s+/u, "")
    .trim();
  if (!stripped || BANNED.test(stripped) || /\bexport\b/.test(stripped)) {
    throw new Error("The chart source was rejected");
  }

  const { transform } = await import("sucrase");
  const compiled = transform(stripped, {
    transforms: ["typescript", "jsx"],
    jsxRuntime: "classic",
    production: true,
  }).code;
  const factory = new Function(
    "React",
    `${compiled}\nreturn typeof Chart === "function" ? Chart : null;`,
  );
  const Chart = factory({ createElement, Fragment });
  if (typeof Chart !== "function") throw new Error("Chart is not a component");
  return Chart as () => ReactNode;
}

type BoundaryProps = { children: ReactNode };
type BoundaryState = { failed: boolean };

export class ChartBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p className="quiet">התרשים לא ניתן להצגה.</p>;
    return this.props.children;
  }
}
