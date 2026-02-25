export type Confidence = "baixa" | "media" | "alta";

export type DecisionMode = "conservador" | "agressivo";

export type RecommendationStatus = "APOSTAVEL" | "CAUTELA" | "EVITAR" | "SEM_SINAL";

export type ConfidenceUpper = "ALTA" | "MEDIA" | "BAIXA";

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
  datasetVersion?: string | null;
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
  datasetVersion?: string | null;
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
  accuracy?: number;
  brierScore?: number;
  logLoss?: number;
  reliabilityBins?: ReliabilityBin[];
  baselineRandomHitRate: number;
  baselineLeagueHitRate: number;
  baselineOddsHitRate: number;
  baselineRecentHitRate: number;
  upliftVsRandom: number;
  upliftVsLeague: number;
  upliftVsOdds: number;
  upliftVsRecent: number;
  walkForwardAttempts: number;
  walkForwardHits: number;
  walkForwardHitRate: number;
  walkForwardBaselineLeagueHitRate: number;
  walkForwardUpliftVsLeague: number;
};

export type CalibrationBin = {
  label: string;
  predicted: number;
  observed: number;
  count: number;
};

export type ReliabilityBin = CalibrationBin;

export type CalibrationSummary = {
  market?: string;
  league?: string;
  method?: "isotonic" | "platt" | "identity";
  sampleSize?: number;
  currentRaw?: number;
  currentCalibrated?: number;
  brierRaw?: number;
  brierScore: number;
  logLossRaw?: number;
  logLoss?: number;
  byBin: CalibrationBin[];
};

export type DriftSummary = {
  recentWindow: number;
  previousWindow: number;
  deltaOver: number;
  deltaBtts: number;
  deltaAvgGoals: number;
  level: "estavel" | "atencao" | "critico";
};

export type BiasSummary = {
  uniquePairRatio: number;
  topNickShare: number;
  topTeamShare: number;
  lowSample: boolean;
  level: "baixo" | "medio" | "alto";
  reasons: string[];
};

export type SensitivityScenario = {
  recencyFactor: number;
  overRate: number;
};

export type SensitivitySummary = {
  spread: number;
  stable: boolean;
  scenarios: SensitivityScenario[];
};

export type DecisionSummary = {
  mode: DecisionMode;
  score: number;
  signal: "over" | "under" | "neutro";
  recommendation: RecommendationStatus;
  confidence: Confidence;
  semaphore: "verde" | "amarelo" | "vermelho";
  antiFalseSignalPassed: boolean;
  isBettable: boolean;
  gateConfidencePassed?: boolean;
  gateDriftPassed?: boolean;
  gateEdgePassed?: boolean;
  gateIcPassed?: boolean;
  gateReliabilityPassed?: boolean;
  reliabilityScore?: number;
  adaptiveEdgeThreshold: number;
  edgeVsNeutral: number;
  probabilityRaw?: number;
  probabilityCalibrated?: number;
  entryCondition: string;
  abortCondition: string;
  reasons: string[];
  contrarianReasons: string[];
};

export type PredictionOutcome = {
  homeGoals: number;
  awayGoals: number;
  result1x2: "home" | "draw" | "away";
  overByLine: Record<string, boolean>;
  btts: boolean;
};

export type PredictionLedgerRecord = {
  id: string;
  createdAt: string;
  resolvedAt?: string | null;
  datasetVersion?: string | null;
  modelVersion: string;
  presetId: string;
  routeContext: "dashboard" | "h2h" | "aovivo" | "analise-jogos";
  scheduledAtLabel?: string;
  matchKey: string;
  league?: string;
  market: string;
  pRaw: number;
  pCalibrated: number;
  decision: RecommendationStatus;
  confidence: ConfidenceUpper;
  reasons: string[];
  contraReasons: string[];
  inputSnapshot?: unknown;
  outcome?: PredictionOutcome | null;
  isCollectReliable?: boolean | null;
  reliabilityScore?: number | null;
};

export type AliasRecord = {
  id: string;
  nickOriginal: string;
  nickCanonico: string;
  createdAt: string;
  updatedAt: string;
};

export type WatchlistRecord = {
  id: string;
  kind: "nick" | "league";
  value: string;
  createdAt: string;
};

export type PerformanceSummary = {
  total: number;
  resolved: number;
  unresolved: number;
  hitRate: number;
  brier: number;
  byDecision: Record<RecommendationStatus, number>;
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
  calibration: CalibrationSummary;
  drift: DriftSummary;
  bias: BiasSummary;
  sensitivity: SensitivitySummary;
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

export type MatchDetailsEvent = {
  minute: number | null;
  label: string;
  team: string;
};

export type MatchDetailsStats = {
  goalsHome: number;
  goalsAway: number;
  cornersHome: number;
  cornersAway: number;
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  penaltiesHome: number;
  penaltiesAway: number;
  substitutionsHome: number;
  substitutionsAway: number;
  attacksHome: number;
  attacksAway: number;
  dangerousAttacksHome: number;
  dangerousAttacksAway: number;
  onTargetHome: number;
  onTargetAway: number;
};

export type MatchDetailsRecord = {
  id: string;
  matchId: string;
  createdAt: string;
  updatedAt: string;
  homeLabel?: string;
  awayLabel?: string;
  dateTimeLabel?: string;
  stats: MatchDetailsStats;
  events: MatchDetailsEvent[];
  source: "rawText" | "url";
  sourceRef?: string;
};
