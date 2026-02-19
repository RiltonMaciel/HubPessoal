import type { MatchRecord } from "@/lib/types";

const SAMPLE_SIZE = 64;

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableMatchFingerprint(match: MatchRecord) {
  return [
    match.dateTime,
    match.league,
    match.homeNick,
    match.awayNick,
    match.homeGoals,
    match.awayGoals,
  ].join("|");
}

export function buildDatasetVersion(matches: MatchRecord[]) {
  if (!matches.length) return "ds-v1-empty";

  const ordered = [...matches].sort((left, right) => +new Date(left.dateTime) - +new Date(right.dateTime));
  const minDate = ordered[0]?.dateTime ?? "-";
  const maxDate = ordered[ordered.length - 1]?.dateTime ?? "-";
  const sample = ordered.slice(0, SAMPLE_SIZE).map(stableMatchFingerprint).join("||");
  const checksum = fnv1a(sample);
  const meta = `${ordered.length}:${minDate}:${maxDate}`;
  const metaHash = fnv1a(meta);

  return `ds-v1-${ordered.length}-${metaHash}-${checksum}`;
}
