"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { parseLiveEvent, type LiveEvent } from "@hub/contract/live";
import { refreshData } from "../api/client";
import { TOPIC_KEYS } from "./keys";

// Live panels (P50, decision 0028): one SSE stream per browser, not per tab (HTTP/1.1 gives an origin about six
// connections across all its tabs). The tab holding the Web Lock "hub-live" opens the EventSource and passes every frame
// to the other tabs over a BroadcastChannel; when it closes, the lock passes on. Every tab turns a frame into
// invalidations of its own cache. The stream says only what changed; the data comes through `read()` as always.

export type LiveState = "connecting" | "live" | "reconnecting";
const LIVE_STATES: readonly LiveState[] = ["connecting", "live", "reconnecting"];
const NAME = "hub-live";
/** Down this long, the page says its data may be old (`state-and-data.md` rule 10); the pulse polls from the first second. */
const STALE_AFTER_MS = 5_000;
/** A stream the server refused or cut for good (the API restarting) is opened again after these waits. */
const BACKOFF_MS = [1_000, 2_000, 5_000] as const;

let state: LiveState = "connecting";
/** The last counter this page applied, in any tab: a new stream resumes after it (`?since=`). */
let since: number | null = null;
const listeners = new Set<() => void>();
function setState(next: LiveState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** `connecting` until the first hello, `live` while the stream is up, `reconnecting` after 5 s without it. The server renders `connecting`. */
export const useLiveState = (): LiveState => useSyncExternalStore(subscribe, () => state, () => "connecting");

/**
 * The tab that plays the agent feed's tones (P59: it holds the Web Lock `hub-sound`, see `@hub/ui/sound`). It refetches the
 * feed even while hidden, so a turn that needs the owner is heard with the admin in the background; every other hidden tab only marks.
 */
let soundHolder = false;
export function setSoundHolder(on: boolean): void {
  soundHolder = on;
}

/** What one frame does to this tab's cache. A hidden tab only marks (its focus refetch catches up), except the sound holder's feed; Mail keys are never named. */
export function applyLive(qc: QueryClient, e: LiveEvent, hidden: boolean): void {
  if (e.type !== "hello") since = e.seq;
  if (e.type === "hello") return;
  if (e.type === "reset") {
    void refreshData(qc);
    return;
  }
  for (const c of e.changes) {
    const refetchType = hidden && !(soundHolder && c.topic === "agent-log") ? "none" : "active";
    // P127 V4: a frame that follows a write by ~300 ms does not restart the refetch the write already started.
    for (const queryKey of TOPIC_KEYS[c.topic](c.project)) void qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false });
  }
}

/** The URL of a new stream: after the last applied counter, when this page has one. */
export const streamUrl = (after: number | null): string => (after === null ? "/api/live" : `/api/live?since=${after}`);

/** The leader's stream, reopened with backoff when the server refused or cut it. Returns the closer. */
function openStream(onEvent: (text: string) => void, onState: (s: LiveState) => void): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stale: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  const down = () => {
    if (state === "live") onState("connecting");
    stale ??= setTimeout(() => onState("reconnecting"), STALE_AFTER_MS);
  };
  const connect = () => {
    if (closed) return;
    const source = new EventSource(streamUrl(since));
    es = source;
    source.onmessage = (m: MessageEvent<unknown>) => {
      if (typeof m.data !== "string") return;
      if (parseLiveEvent(m.data)?.type === "hello") {
        clearTimeout(stale);
        stale = undefined;
        attempt = 0;
        onState("live");
      }
      onEvent(m.data);
    };
    source.onerror = () => {
      down();
      // CONNECTING: the browser retries by itself with Last-Event-ID. CLOSED: a 500 or 503 from the rewrite; we retry.
      if (source.readyState !== EventSource.CLOSED) return;
      source.close();
      retry = setTimeout(connect, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      attempt += 1;
    };
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    clearTimeout(stale);
    es?.close();
  };
}

type Message = { kind: "event"; data: string } | { kind: "state"; state: LiveState } | { kind: "ask" };
function messageOf(raw: unknown): Message | null {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) return null;
  if (raw.kind === "ask") return { kind: "ask" };
  if (raw.kind === "event" && "data" in raw && typeof raw.data === "string") return { kind: "event", data: raw.data };
  if (raw.kind === "state" && "state" in raw) {
    const s = LIVE_STATES.find((x) => x === raw.state);
    return s ? { kind: "state", state: s } : null;
  }
  return null;
}

/** Mounted once, in the shell frame. Without EventSource (an old browser) nothing opens and the pulse keeps polling. */
export function useLive(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME);
    let channelOpen = true;
    const broadcast = (message: Message) => {
      if (!channel || !channelOpen) return;
      try {
        channel.postMessage(message);
      } catch {
        channelOpen = false;
      }
    };
    let leading = false;
    const apply = (text: string) => {
      const e = parseLiveEvent(text);
      // A frame this page does not know means a server newer than the page: refetch everything rather than guess.
      applyLive(qc, e ?? { type: "reset", seq: since ?? 0 }, document.hidden);
    };
    const lead = () => {
      leading = true;
      return openStream(
        (text) => {
          apply(text);
          broadcast({ kind: "event", data: text });
        },
        (s) => {
          setState(s);
          broadcast({ kind: "state", state: s });
        },
      );
    };
    if (channel) {
      channel.onmessage = (m: MessageEvent<unknown>) => {
        const msg = messageOf(m.data);
        if (!msg) return;
        if (msg.kind === "event" && !leading) apply(msg.data);
        else if (msg.kind === "state" && !leading) setState(msg.state);
        else if (msg.kind === "ask" && leading) broadcast({ kind: "state", state });
      };
      broadcast({ kind: "ask" });
    }
    const stop = new AbortController();
    let close = () => {};
    if ("locks" in navigator) {
      navigator.locks
        .request(NAME, { signal: stop.signal }, () =>
          new Promise<void>((release) => {
            close = lead();
            stop.signal.addEventListener("abort", () => release(), { once: true });
          }),
        )
        .catch(() => undefined); // aborted while waiting for the lock: this tab never led
    } else {
      close = lead();
    }
    return () => {
      channelOpen = false;
      stop.abort();
      close();
      channel?.close();
      leading = false;
      setState("connecting");
    };
  }, [qc]);
}
