import Dexie, { type Table } from "dexie";
import type {
  AvatarRecord,
  CalendarEventRecord,
  ConfigRecord,
  DataQualityReport,
  FilterPresetRecord,
  ImportSummary,
  MatchRecord,
  NoteRecord,
  Odds1X2Record,
  OddsOuRecord,
  PlayerMapRecord,
  SecureItemRecord,
  SecureMetaRecord,
  UpcomingRecord,
} from "@/lib/types";

export type RawDataset = {
  id: string;
  matches: MatchRecord[];
  upcoming: UpcomingRecord[];
  odds1x2: Odds1X2Record[];
  oddsOu: OddsOuRecord[];
  config: ConfigRecord;
  players: PlayerMapRecord[];
  quality: DataQualityReport;
  importSummary: ImportSummary;
  importedAt: string;
};

export type ComputedCache = {
  key: string;
  importedAt: string;
  payload: unknown;
};

class HubDb extends Dexie {
  matches!: Table<MatchRecord, string>;
  upcoming!: Table<UpcomingRecord, string>;
  odds1x2!: Table<Odds1X2Record, string>;
  oddsOu!: Table<OddsOuRecord, string>;
  config!: Table<ConfigRecord, number>;
  players!: Table<PlayerMapRecord, string>;
  notes!: Table<NoteRecord, string>;
  events!: Table<CalendarEventRecord, string>;
  avatars!: Table<AvatarRecord, string>;
  rawDatasets!: Table<RawDataset, string>;
  computedCache!: Table<ComputedCache, string>;
  secureMeta!: Table<SecureMetaRecord, string>;
  secureItems!: Table<SecureItemRecord, string>;
  presets!: Table<FilterPresetRecord, string>;

  constructor() {
    super("hubpessoal-db-v1");
    this.version(1).stores({
      matches: "id, league, dateTime, homeNick, awayNick",
      upcoming: "id, league, dateTime, homeNick, awayNick",
      odds1x2: "id, league, dateTime",
      oddsOu: "id, league, line, dateTime",
      config: "++id",
      players: "nick",
      notes: "id, type, pinned, updatedAt",
      events: "id, date, holiday",
      avatars: "nick",
      rawDatasets: "id, importedAt",
      computedCache: "key, importedAt",
      secureMeta: "key",
      secureItems: "id, area, updatedAt",
    });

    this.version(2).stores({
      matches: "id, league, dateTime, homeNick, awayNick",
      upcoming: "id, league, dateTime, homeNick, awayNick",
      odds1x2: "id, league, dateTime",
      oddsOu: "id, league, line, dateTime",
      config: "++id",
      players: "nick",
      notes: "id, type, pinned, updatedAt",
      events: "id, date, holiday",
      avatars: "nick",
      rawDatasets: "id, importedAt",
      computedCache: "key, importedAt",
      secureMeta: "key",
      secureItems: "id, area, updatedAt",
      presets: "id, name, updatedAt",
    });
  }
}

export const db = new HubDb();
