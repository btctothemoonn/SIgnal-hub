import type { DatabaseSync } from "node:sqlite";
import { marketPushParticipantKey, transitionPushEpisode } from "./important-push-policy.ts";
import type { MarketPushObservation, PushEpisodeState, PushEvent, SequencedPushEvent } from "./important-push-types.ts";

export function createImportantPushOutbox(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS important_push_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS important_push_market_episodes (
      symbol TEXT NOT NULL, direction TEXT NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY(symbol,direction)
    );
    CREATE TABLE IF NOT EXISTS important_push_episode_history (episode_id TEXT PRIMARY KEY, state_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS important_push_latest_evaluation (
      symbol TEXT NOT NULL, participant_key TEXT NOT NULL, evaluated_at INTEGER NOT NULL, observation_json TEXT NOT NULL,
      PRIMARY KEY(symbol,participant_key)
    );
    CREATE TABLE IF NOT EXISTS important_push_market_scans (
      symbol TEXT NOT NULL, participant_key TEXT NOT NULL, scan_id TEXT NOT NULL, PRIMARY KEY(symbol,participant_key,scan_id)
    );
    CREATE TABLE IF NOT EXISTS important_push_producer_baselines (producer TEXT PRIMARY KEY);
  `);
  function appendEvent(event: PushEvent): number {
    db.prepare("INSERT OR IGNORE INTO important_push_outbox(event_id,event_json) VALUES (?,?)").run(event.id, JSON.stringify(event));
    return Number(db.prepare("SELECT sequence FROM important_push_outbox WHERE event_id=?").get(event.id)?.sequence ?? 0);
  }
  function readAfter(sequence: number, limit: number): SequencedPushEvent[] {
    return db.prepare("SELECT sequence,event_json FROM important_push_outbox WHERE sequence>? ORDER BY sequence LIMIT ?")
      .all(sequence, Math.max(1, Math.min(1000, Math.floor(limit))))
      .map(row => ({ sequence: Number(row.sequence), event: JSON.parse(String(row.event_json)) as PushEvent }));
  }
  function readLatestEvaluation(symbol: string, participantKey: string): MarketPushObservation | null {
    const row = db.prepare("SELECT observation_json FROM important_push_latest_evaluation WHERE symbol=? AND participant_key=?").get(symbol, participantKey);
    return row ? JSON.parse(String(row.observation_json)) as MarketPushObservation : null;
  }
  function readEpisode(episodeId: string): PushEpisodeState | null {
    const row = db.prepare("SELECT state_json FROM important_push_episode_history WHERE episode_id=?").get(episodeId);
    return row ? JSON.parse(String(row.state_json)) as PushEpisodeState : null;
  }
  function applyMarketObservations(observations: MarketPushObservation[], nowMs: number, options: { suppressEvents?: boolean } = {}): PushEvent[] {
    db.exec("SAVEPOINT important_push_scan;");
    try {
      const groups = new Map<string, MarketPushObservation[]>();
      for (const observation of observations) {
        const participant = marketPushParticipantKey(observation);
        const prior = db.prepare("SELECT evaluated_at FROM important_push_latest_evaluation WHERE symbol=? AND participant_key=?").get(observation.symbol, participant);
        if (prior && Number(prior.evaluated_at) > nowMs) continue;
        const inserted = db.prepare("INSERT OR IGNORE INTO important_push_market_scans(symbol,participant_key,scan_id) VALUES (?,?,?)").run(observation.symbol, participant, observation.scanId);
        if (!inserted.changes) continue;
        db.prepare(`INSERT INTO important_push_latest_evaluation(symbol,participant_key,evaluated_at,observation_json) VALUES (?,?,?,?)
          ON CONFLICT(symbol,participant_key) DO UPDATE SET evaluated_at=excluded.evaluated_at,observation_json=excluded.observation_json`)
          .run(observation.symbol, participant, nowMs, JSON.stringify(observation));
        const key = `${observation.symbol}:${observation.direction}`;
        groups.set(key, [...(groups.get(key) ?? []), observation]);
      }
      const events: PushEvent[] = [];
      for (const group of groups.values()) {
        const { symbol, direction } = group[0];
        const current = db.prepare("SELECT state_json FROM important_push_market_episodes WHERE symbol=? AND direction=?").get(symbol, direction);
        const previous = current ? JSON.parse(String(current.state_json)) as PushEpisodeState : null;
        const transition = transitionPushEpisode(previous, group, nowMs);
        if (transition.state) {
          const stateJson = JSON.stringify(transition.state);
          db.prepare(`INSERT INTO important_push_market_episodes(symbol,direction,state_json) VALUES (?,?,?)
            ON CONFLICT(symbol,direction) DO UPDATE SET state_json=excluded.state_json`).run(symbol, direction, stateJson);
          db.prepare(`INSERT INTO important_push_episode_history(episode_id,state_json) VALUES (?,?)
            ON CONFLICT(episode_id) DO UPDATE SET state_json=excluded.state_json`).run(transition.state.episodeId, stateJson);
        }
        if (transition.event && !options.suppressEvents) {
          appendEvent(transition.event); events.push(transition.event);
        }
      }
      db.exec("RELEASE important_push_scan;");
      return events;
    } catch (error) {
      db.exec("ROLLBACK TO important_push_scan; RELEASE important_push_scan;");
      throw error;
    }
  }
  function getBaseline(): { lastSequence: number; episodes: PushEpisodeState[] } {
    const lastSequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM important_push_outbox").get()?.sequence ?? 0);
    const episodes = db.prepare("SELECT state_json FROM important_push_market_episodes ORDER BY symbol,direction").all()
      .map(row => JSON.parse(String(row.state_json)) as PushEpisodeState).filter(state => !state.endedAt);
    return { lastSequence, episodes };
  }
  function isProducerInitialized(producer: MarketPushObservation["producer"]) {
    return Boolean(db.prepare("SELECT producer FROM important_push_producer_baselines WHERE producer=?").get(producer));
  }
  function markProducerInitialized(producer: MarketPushObservation["producer"]) {
    db.prepare("INSERT OR IGNORE INTO important_push_producer_baselines(producer) VALUES (?)").run(producer);
  }
  return { appendEvent, readAfter, readLatestEvaluation, readEpisode, applyMarketObservations, getBaseline, isProducerInitialized, markProducerInitialized };
}
