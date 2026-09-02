/** Semi-annual CDCB yield eval from a scrape date. Same rule as Goatsmith `suggestedPtiEval`. */

export const PTI_EVAL_MONTHS = ["AUGUST", "DECEMBER"];

/** Most recently published eval as of `now` (yield: Aug / Dec). */
export function suggestedPtiEval(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 12) return { evalYear: year, evalMonth: "DECEMBER" };
  if (month >= 8) return { evalYear: year, evalMonth: "AUGUST" };
  return { evalYear: year - 1, evalMonth: "DECEMBER" };
}

export function ptiEvalFromCapturedAt(capturedAt, now = new Date()) {
  if (capturedAt) {
    const parsed = new Date(capturedAt);
    if (!Number.isNaN(parsed.getTime())) return suggestedPtiEval(parsed);
  }
  return suggestedPtiEval(now);
}

export function ptiEvalLabel(year, month) {
  const name = month === "AUGUST" ? "August" : month === "DECEMBER" ? "December" : month;
  return `${name} ${year}`;
}
