type FormatOptions = {
  includeTime?: boolean;
  fallback?: string;
};

function buildDateFromExcelSerial(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;

  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const normalizedDays = wholeDays > 59 ? wholeDays - 1 : wholeDays;
  const baseUtc = Date.UTC(1899, 11, 31);
  const dayMs = 24 * 60 * 60 * 1000;
  const date = new Date(baseUtc + normalizedDays * dayMs + Math.round(fraction * dayMs));

  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDateFromParts(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
) {
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes ||
    date.getSeconds() !== seconds
  ) {
    return null;
  }
  return date;
}

export function parseDateTimeInput(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    return buildDateFromExcelSerial(value);
  }

  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric >= 20000 && numeric <= 80000) {
      const fromSerial = buildDateFromExcelSerial(numeric);
      if (fromSerial) return fromSerial;
    }
  }

  const nativeDate = new Date(raw);
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate;

  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, y, hh, mm, ss] = br;
    return buildDateFromParts(
      Number(y),
      Number(m),
      Number(d),
      hh ? Number(hh) : 0,
      mm ? Number(mm) : 0,
      ss ? Number(ss) : 0
    );
  }

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymd) {
    const [, y, m, d, hh, mm, ss] = ymd;
    return buildDateFromParts(
      Number(y),
      Number(m),
      Number(d),
      hh ? Number(hh) : 0,
      mm ? Number(mm) : 0,
      ss ? Number(ss) : 0
    );
  }

  return null;
}

export function toIsoDateTime(value: unknown) {
  const parsed = parseDateTimeInput(value);
  if (parsed) return parsed.toISOString();
  if (typeof value === "string") return value.trim();
  return "";
}

export function toDateTimestamp(value: unknown) {
  const parsed = parseDateTimeInput(value);
  return parsed ? parsed.getTime() : Number.NEGATIVE_INFINITY;
}

export function formatDateTimePtBr(value: unknown, options?: FormatOptions) {
  const includeTime = options?.includeTime ?? true;
  const parsed = parseDateTimeInput(value);
  if (parsed) {
    return includeTime
      ? parsed.toLocaleString("pt-BR")
      : parsed.toLocaleDateString("pt-BR");
  }

  if (typeof value === "string" && value.trim()) return value.trim();
  return options?.fallback ?? "—";
}
