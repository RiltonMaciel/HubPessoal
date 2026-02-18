import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { defaultConfig, type ConfigRecord, type DataQualityReport, type ImportSummary, type MatchRecord, type Odds1X2Record, type OddsOuRecord, type PlayerMapRecord, type UpcomingRecord } from "@/lib/types";
import { parseDateTimeInput, toIsoDateTime } from "@/lib/datetime";

const schema = {
  HISTORICO: [
    "League",
    "DateTime",
    "HomeTeam",
    "HomeNick",
    "AwayTeam",
    "AwayNick",
    "HomeGoals",
    "AwayGoals",
    "Status",
    "OddHomeClose",
    "OddDrawClose",
    "OddAwayClose",
    "OddOverClose",
    "OddUnderClose",
    "OuLineClose",
    "FirstGoalMinute",
    "FirstGoalType",
    "RedCardsHome",
    "RedCardsAway",
    "HomeStartersOut",
    "AwayStartersOut",
    "HomeRestDays",
    "AwayRestDays",
    "HomeBackToBack",
    "AwayBackToBack",
  ],
  PROXIMOS: ["League", "DateTime", "HomeTeam", "HomeNick", "AwayTeam", "AwayNick"],
  ODDS_1X2: ["League", "DateTime", "HomeNick", "AwayNick", "OddHome", "OddDraw", "OddAway"],
  ODDS_OU: ["League", "DateTime", "HomeNick", "AwayNick", "Line", "OddOver", "OddUnder"],
  CONFIG: ["RecencyFactor", "ShrinkK", "Simulations", "MinGamesConfidence"],
  PLAYERS: ["Nick", "DisplayName"],
};

const optionalHistoricoColumns = new Set([
  "Status",
  "OddHomeClose",
  "OddDrawClose",
  "OddAwayClose",
  "OddOverClose",
  "OddUnderClose",
  "OuLineClose",
  "FirstGoalMinute",
  "FirstGoalType",
  "RedCardsHome",
  "RedCardsAway",
  "HomeStartersOut",
  "AwayStartersOut",
  "HomeRestDays",
  "AwayRestDays",
  "HomeBackToBack",
  "AwayBackToBack",
]);

type ImportedData = {
  matches: MatchRecord[];
  upcoming: UpcomingRecord[];
  odds1x2: Odds1X2Record[];
  oddsOu: OddsOuRecord[];
  config: ConfigRecord;
  players: PlayerMapRecord[];
  quality: DataQualityReport;
  importSummary: ImportSummary;
};

export type ParsedImportData = ImportedData;

function toStringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function toOptionalNumber(value: unknown) {
  const asString = toStringValue(value);
  if (!asString) return undefined;
  const numeric = Number(asString);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toOptionalBoolean(value: unknown) {
  const asString = toStringValue(value).toLowerCase();
  if (!asString) return undefined;
  if (["1", "true", "sim", "yes", "y"].includes(asString)) return true;
  if (["0", "false", "nao", "não", "no", "n"].includes(asString)) return false;
  return undefined;
}

export function validateWorkbook(workbook: XLSX.WorkBook): string[] {
  const errors: string[] = [];

  if (!workbook.SheetNames.includes("HISTORICO")) {
    errors.push("A aba HISTORICO é obrigatória.");
    return errors;
  }

  for (const sheetName of workbook.SheetNames) {
    if (!(sheetName in schema)) continue;
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) continue;

    const headers = Object.keys(rows[0]);
    const expected = schema[sheetName as keyof typeof schema];
    expected.forEach((col) => {
      if (sheetName === "HISTORICO" && optionalHistoricoColumns.has(col)) return;
      if (!headers.includes(col)) {
        errors.push(`Aba ${sheetName} sem coluna ${col}.`);
      }
    });
  }

  return errors;
}

export function parseWorkbook(workbook: XLSX.WorkBook): ImportedData {
  const historicoRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.HISTORICO, { defval: "" });

  const dedupe = new Set<string>();
  const quality: DataQualityReport = {
    ignoredStatusNotFinished: 0,
    removedMissingScore: 0,
    removedDuplicates: 0,
    detectedOutliers: 0,
  };

  const matches: MatchRecord[] = historicoRows
    .map((row) => {
      const homeGoals = toNumber(row.HomeGoals);
      const awayGoals = toNumber(row.AwayGoals);
      const status = toStringValue(row.Status);

      if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) {
        quality.removedMissingScore += 1;
        return null;
      }

      if (status && status.toUpperCase() !== "FINISHED") {
        quality.ignoredStatusNotFinished += 1;
        return null;
      }

      const candidate: MatchRecord = {
        id: uuidv4(),
        league: toStringValue(row.League),
        dateTime: toIsoDateTime(row.DateTime),
        homeTeam: toStringValue(row.HomeTeam),
        homeNick: toStringValue(row.HomeNick),
        awayTeam: toStringValue(row.AwayTeam),
        awayNick: toStringValue(row.AwayNick),
        homeGoals,
        awayGoals,
        status,
        oddHomeClose: toOptionalNumber(row.OddHomeClose),
        oddDrawClose: toOptionalNumber(row.OddDrawClose),
        oddAwayClose: toOptionalNumber(row.OddAwayClose),
        oddOverClose: toOptionalNumber(row.OddOverClose),
        oddUnderClose: toOptionalNumber(row.OddUnderClose),
        ouLineClose: toOptionalNumber(row.OuLineClose),
        firstGoalMinute: toOptionalNumber(row.FirstGoalMinute),
        firstGoalType: toStringValue(row.FirstGoalType) || undefined,
        redCardsHome: toOptionalNumber(row.RedCardsHome),
        redCardsAway: toOptionalNumber(row.RedCardsAway),
        homeStartersOut: toOptionalNumber(row.HomeStartersOut),
        awayStartersOut: toOptionalNumber(row.AwayStartersOut),
        homeRestDays: toOptionalNumber(row.HomeRestDays),
        awayRestDays: toOptionalNumber(row.AwayRestDays),
        homeBackToBack: toOptionalBoolean(row.HomeBackToBack),
        awayBackToBack: toOptionalBoolean(row.AwayBackToBack),
      };

      const key = `${candidate.league}|${candidate.dateTime}|${candidate.homeNick}|${candidate.awayNick}|${candidate.homeGoals}|${candidate.awayGoals}`;
      if (dedupe.has(key)) {
        quality.removedDuplicates += 1;
        return null;
      }
      dedupe.add(key);

      if (candidate.homeGoals + candidate.awayGoals > 20) {
        quality.detectedOutliers += 1;
      }

      return candidate;
    })
    .filter((item): item is MatchRecord => item !== null);

  const upcomingRows = workbook.Sheets.PROXIMOS
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.PROXIMOS, { defval: "" })
    : [];

  const upcoming: UpcomingRecord[] = upcomingRows.map((row) => ({
    id: uuidv4(),
    league: toStringValue(row.League),
    dateTime: toIsoDateTime(row.DateTime),
    homeTeam: toStringValue(row.HomeTeam),
    homeNick: toStringValue(row.HomeNick),
    awayTeam: toStringValue(row.AwayTeam),
    awayNick: toStringValue(row.AwayNick),
  }));

  const odds1x2Rows = workbook.Sheets.ODDS_1X2
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.ODDS_1X2, { defval: "" })
    : [];

  const odds1x2: Odds1X2Record[] = odds1x2Rows.map((row) => ({
    id: uuidv4(),
    league: toStringValue(row.League),
    dateTime: toIsoDateTime(row.DateTime),
    homeNick: toStringValue(row.HomeNick),
    awayNick: toStringValue(row.AwayNick),
    oddHome: toNumber(row.OddHome),
    oddDraw: toNumber(row.OddDraw),
    oddAway: toNumber(row.OddAway),
  }));

  const oddsOuRows = workbook.Sheets.ODDS_OU
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.ODDS_OU, { defval: "" })
    : [];

  const oddsOu: OddsOuRecord[] = oddsOuRows.map((row) => ({
    id: uuidv4(),
    league: toStringValue(row.League),
    dateTime: toIsoDateTime(row.DateTime),
    homeNick: toStringValue(row.HomeNick),
    awayNick: toStringValue(row.AwayNick),
    line: toNumber(row.Line),
    oddOver: toNumber(row.OddOver),
    oddUnder: toNumber(row.OddUnder),
  }));

  const configRows = workbook.Sheets.CONFIG
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.CONFIG, { defval: "" })
    : [];

  const configRow = configRows[0] ?? {};
  const config: ConfigRecord = {
    recencyFactor: Number(configRow.RecencyFactor ?? defaultConfig.recencyFactor),
    shrinkK: Number(configRow.ShrinkK ?? defaultConfig.shrinkK),
    simulations: Number(configRow.Simulations ?? defaultConfig.simulations),
    minGamesConfidence: Number(configRow.MinGamesConfidence ?? defaultConfig.minGamesConfidence),
  };

  const playersRows = workbook.Sheets.PLAYERS
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.PLAYERS, { defval: "" })
    : [];

  const players: PlayerMapRecord[] = playersRows
    .map((row) => ({
      nick: toStringValue(row.Nick),
      displayName: toStringValue(row.DisplayName),
    }))
    .filter((item) => item.nick);

  const validDates = matches
    .map((item) => parseDateTimeInput(item.dateTime))
    .filter((date): date is Date => Boolean(date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => +a - +b);

  const importSummary: ImportSummary = {
    linesRead: historicoRows.length,
    linesValid: matches.length,
    linesRemoved:
      quality.ignoredStatusNotFinished + quality.removedMissingScore + quality.removedDuplicates,
    leaguesDetected: [...new Set(matches.map((item) => item.league).filter(Boolean))],
    minDate: validDates[0]?.toISOString(),
    maxDate: validDates[validDates.length - 1]?.toISOString(),
  };

  return { matches, upcoming, odds1x2, oddsOu, config, players, quality, importSummary };
}

type ParseRawTextOptions = {
  league?: string;
  referenceYear?: number;
};

function parseSiteDateTime(raw: string, referenceYear: number) {
  const trimmed = raw.trim();
  const withYear = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (withYear) {
    const [, mm, dd, yy, hh, min] = withYear;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const date = new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const noYear = trimmed.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (noYear) {
    const [, mm, dd, hh, min] = noYear;
    const now = new Date();
    let date = new Date(referenceYear, Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
    if (date.getTime() - now.getTime() > 36 * 60 * 60 * 1000) {
      date = new Date(referenceYear - 1, Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
    }
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function parseTeamAndNick(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)\s*(?:\(([^)]+)\))?$/);
  const team = match?.[1]?.trim() || trimmed;
  const nick = match?.[2]?.trim() || team;
  return { team, nick };
}

function pickRawLineParts(line: string) {
  const columns = line
    .split("\t")
    .map((item) => item.trim())
    .filter(Boolean);

  if (columns.length >= 3) {
    const dateTime = columns[0] ?? "";
    const matchup = columns.find((item) => /\sv\s/i.test(item)) ?? "";
    const score = columns.find((item) => /^\d+\s*-\s*\d+$/.test(item)) ?? "";
    return { dateTime, matchup, score };
  }

  const fallback = line.match(
    /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}).*?(.+?\s+v\s+.+?)\s+(\d+\s*-\s*\d+)\s*$/i
  );
  if (!fallback) return null;

  return {
    dateTime: fallback[1] ?? "",
    matchup: fallback[2] ?? "",
    score: fallback[3] ?? "",
  };
}

export function parseRawTextMatches(rawText: string, options?: ParseRawTextOptions): ParsedImportData {
  const referenceYear = options?.referenceYear ?? new Date().getFullYear();
  const league = options?.league?.trim() || "eSoccer";
  const rows = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^date\b/i.test(line));

  const dedupe = new Set<string>();
  const quality: DataQualityReport = {
    ignoredStatusNotFinished: 0,
    removedMissingScore: 0,
    removedDuplicates: 0,
    detectedOutliers: 0,
  };

  const matches: MatchRecord[] = [];

  rows.forEach((row) => {
    const parsedLine = pickRawLineParts(row);
    if (!parsedLine) {
      quality.removedMissingScore += 1;
      return;
    }

    const date = parseSiteDateTime(parsedLine.dateTime, referenceYear);
    const matchup = parsedLine.matchup.match(/(.+?)\s+v\s+(.+)/i);
    const score = parsedLine.score.match(/^(\d+)\s*-\s*(\d+)$/);

    if (!date || !matchup || !score) {
      quality.removedMissingScore += 1;
      return;
    }

    const home = parseTeamAndNick(matchup[1] ?? "");
    const away = parseTeamAndNick(matchup[2] ?? "");
    const homeGoals = Number(score[1]);
    const awayGoals = Number(score[2]);

    if (!home.team || !away.team || Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) {
      quality.removedMissingScore += 1;
      return;
    }

    const key = `${league}|${date.toISOString()}|${home.nick}|${away.nick}|${homeGoals}|${awayGoals}`;
    if (dedupe.has(key)) {
      quality.removedDuplicates += 1;
      return;
    }
    dedupe.add(key);

    if (homeGoals + awayGoals > 20) {
      quality.detectedOutliers += 1;
    }

    matches.push({
      id: uuidv4(),
      league,
      dateTime: date.toISOString(),
      homeTeam: home.team,
      homeNick: home.nick,
      awayTeam: away.team,
      awayNick: away.nick,
      homeGoals,
      awayGoals,
      status: "FINISHED",
    });
  });

  const players = [...new Set(matches.flatMap((item) => [item.homeNick, item.awayNick]))]
    .filter(Boolean)
    .map((nick) => ({ nick, displayName: nick }));

  const validDates = matches
    .map((item) => parseDateTimeInput(item.dateTime))
    .filter((date): date is Date => Boolean(date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => +a - +b);

  const importSummary: ImportSummary = {
    linesRead: rows.length,
    linesValid: matches.length,
    linesRemoved: quality.removedMissingScore + quality.removedDuplicates,
    leaguesDetected: matches.length ? [league] : [],
    minDate: validDates[0]?.toISOString(),
    maxDate: validDates[validDates.length - 1]?.toISOString(),
  };

  return {
    matches,
    upcoming: [],
    odds1x2: [],
    oddsOu: [],
    config: { ...defaultConfig },
    players,
    quality,
    importSummary,
  };
}

export function downloadTemplate() {
  const workbook = XLSX.utils.book_new();

  Object.entries(schema).forEach(([sheetName, columns]) => {
    const worksheet = XLSX.utils.json_to_sheet([], { header: columns });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  XLSX.writeFile(workbook, "HubPessoal-Template-v1.xlsx");
}

export function readWorkbook(file: File) {
  return new Promise<XLSX.WorkBook>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        resolve(workbook);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
