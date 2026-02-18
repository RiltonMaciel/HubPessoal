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
