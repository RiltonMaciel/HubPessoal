export type Confidence = "baixa" | "media" | "alta";

export type DecisionMode = "conservador" | "agressivo";

export type RateInterval = {
  rate: number;
  low: number;
  high: number;
  effectiveSample: number;
};

export type DataQualityReport = {
  ignoredStatusNotFinished: number;
  removedMissingScore: number;
  removedDuplicates: number;
  detectedOutliers: number;
};

export type ImportSummary = {
  linesRead: number;
  linesValid: number;
  linesRemoved: number;
  leaguesDetected: string[];
  minDate?: string;
  maxDate?: string;
};

export type MatchRecord = {
  id: string;
  league: string;
  dateTime: string;
  homeTeam: string;
  homeNick: string;
  awayTeam: string;
  awayNick: string;
  homeGoals: number;
  awayGoals: number;
  status?: string;
  oddHomeClose?: number;
  oddDrawClose?: number;
  oddAwayClose?: number;
  oddOverClose?: number;
  oddUnderClose?: number;
  ouLineClose?: number;
  firstGoalMinute?: number;
  firstGoalType?: string;
  redCardsHome?: number;
  redCardsAway?: number;
  homeStartersOut?: number;
  awayStartersOut?: number;
  homeRestDays?: number;
  awayRestDays?: number;
  homeBackToBack?: boolean;
  awayBackToBack?: boolean;
};

export type UpcomingRecord = {
  id: string;
  league: string;
  dateTime: string;
  homeTeam: string;
  homeNick: string;
  awayTeam: string;
  awayNick: string;
};

export type Odds1X2Record = {
  id: string;
  league: string;
  dateTime: string;
  homeNick: string;
  awayNick: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
};

export type OddsOuRecord = {
  id: string;
  league: string;
  dateTime: string;
  homeNick: string;
  awayNick: string;
  line: number;
  oddOver: number;
  oddUnder: number;
};

export type ConfigRecord = {
  recencyFactor: number;
  shrinkK: number;
  simulations: number;
  minGamesConfidence: number;
};

export type PlayerMapRecord = {
  nick: string;
  displayName: string;
};

export type NoteType = "Anotação" | "Objetivo" | "Ideia" | "Checklist";

export type NoteRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  type: NoteType;
  pinned: boolean;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEventRecord = {
  id: string;
  title: string;
  date: string;
  allDay: boolean;
  reminderMinutes?: number;
  holiday?: boolean;
};

export type AvatarRecord = {
  nick: string;
  imageDataUrl: string;
};

export type SecureMetaRecord = {
  key: string;
  value: string;
};

export type SecureItemRecord = {
  id: string;
  area: "strategies" | "secret-notes";
  titleEncrypted: string;
  bodyEncrypted: string;
  createdAt: string;
  updatedAt: string;
};

export type PlayerSummary = {
  nick: string;
  games: number;
  effectiveGames: number;
  wins: number;
  draws: number;
  losses: number;
  ppg: number;
  ppgFinal: number;
  gfPerGame: number;
  gaPerGame: number;
  totalPerGame: number;
  bttsRate: number;
  bttsInterval: RateInterval;
  overRates: Record<number, number>;
  overIntervals: Record<number, RateInterval>;
  confidence: Confidence;
};

export type BacktestSummary = {
  line: number;
  attempts: number;
  hits: number;
  hitRate: number;
  baselineRandomHitRate: number;
  baselineLeagueHitRate: number;
  upliftVsRandom: number;
  upliftVsLeague: number;
  walkForwardAttempts: number;
  walkForwardHits: number;
  walkForwardHitRate: number;
  walkForwardBaselineLeagueHitRate: number;
  walkForwardUpliftVsLeague: number;
};

export type DecisionSummary = {
  mode: DecisionMode;
  score: number;
  signal: "over" | "under" | "neutro";
  confidence: Confidence;
  antiFalseSignalPassed: boolean;
  isBettable: boolean;
  adaptiveEdgeThreshold: number;
  edgeVsNeutral: number;
  reasons: string[];
};

export type DashboardData = {
  totalGames: number;
  avgGoals: number;
  bttsRate: number;
  bttsInterval: RateInterval;
  selectedOverRate: number;
  selectedOverInterval: RateInterval;
  effectiveGames: number;
  leagueOverLines: Record<number, number>;
  rankings: {
    topBest: PlayerSummary[];
    topWorst: PlayerSummary[];
    topOver: PlayerSummary[];
    topUnder: PlayerSummary[];
    topBtts: PlayerSummary[];
    topNoBtts: PlayerSummary[];
  };
  players: PlayerSummary[];
  recentMatches: MatchRecord[];
  backtest: BacktestSummary;
  decision: DecisionSummary;
  executiveSummary: string[];
  explainability: {
    fragileEdgePlayers: string[];
  };
};

export type FilterPresetRecord = {
  id: string;
  name: string;
  league: string;
  period: "7" | "15" | "30" | "all";
  recencyOn: boolean;
  line: number;
  decisionMode: DecisionMode;
  confidence: "all" | "alta" | "media" | "baixa";
  createdAt: string;
  updatedAt: string;
};

export const defaultConfig: ConfigRecord = {
  recencyFactor: 0.85,
  shrinkK: 6,
  simulations: 20000,
  minGamesConfidence: 5,
};
