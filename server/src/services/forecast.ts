export interface RecurringTemplateRow {
  id: number;
  name: string;
  payee_id: number | null;
  from_account_id: number;
  to_account_id: number;
  amount_cents: number;
  interval: "weekly" | "monthly" | "yearly";
  interval_day: number;
  start_date: string;
  end_date: string | null;
  active: number;
  last_booked_date: string | null;
}

export interface Occurrence {
  templateId: number;
  templateName: string;
  date: string;
  fromAccountId: number;
  toAccountId: number;
  amountCents: number;
}

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextOccurrenceOnOrAfter(template: RecurringTemplateRow, from: Date): Date {
  const start = toDate(template.start_date);
  const fromDateOnly = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let lowerBound = Math.max(start.getTime(), fromDateOnly.getTime());
  if (template.last_booked_date) {
    const dayAfterLastBooked = toDate(template.last_booked_date);
    dayAfterLastBooked.setDate(dayAfterLastBooked.getDate() + 1);
    lowerBound = Math.max(lowerBound, dayAfterLastBooked.getTime());
  }
  let candidate = new Date(lowerBound);

  if (template.interval === "weekly") {
    const targetDow = template.interval_day % 7;
    while (candidate.getDay() !== targetDow) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  if (template.interval === "monthly") {
    const day = Math.min(template.interval_day, 28);
    let year = candidate.getFullYear();
    let month = candidate.getMonth();
    let result = new Date(year, month, day);
    if (result < candidate) {
      month += 1;
      result = new Date(year, month, day);
    }
    return result;
  }

  // yearly: interval_day = day-of-year (1-365)
  let year = candidate.getFullYear();
  let result = dayOfYearToDate(year, template.interval_day);
  if (result < candidate) {
    result = dayOfYearToDate(year + 1, template.interval_day);
  }
  return result;
}

function dayOfYearToDate(year: number, dayOfYear: number): Date {
  const d = new Date(year, 0, 1);
  d.setDate(dayOfYear);
  return d;
}

function advance(template: RecurringTemplateRow, date: Date): Date {
  const next = new Date(date);
  if (template.interval === "weekly") next.setDate(next.getDate() + 7);
  else if (template.interval === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

export function expandOccurrences(
  templates: RecurringTemplateRow[],
  rangeStart: Date,
  rangeEnd: Date
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const t of templates) {
    if (!t.active) continue;
    const end = t.end_date ? toDate(t.end_date) : null;
    let cursor = nextOccurrenceOnOrAfter(t, rangeStart);
    let guard = 0;
    while (cursor <= rangeEnd && guard < 1000) {
      guard += 1;
      if (end && cursor > end) break;
      occurrences.push({
        templateId: t.id,
        templateName: t.name,
        date: fmt(cursor),
        fromAccountId: t.from_account_id,
        toAccountId: t.to_account_id,
        amountCents: t.amount_cents,
      });
      cursor = advance(t, cursor);
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date));
  return occurrences;
}

export function nextDueDate(template: RecurringTemplateRow, from: Date): string {
  return fmt(nextOccurrenceOnOrAfter(template, from));
}
