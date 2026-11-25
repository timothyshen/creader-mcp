/**
 * [INPUT]: WorldEvent[] (already adjudicated — fold never decides, it only records)
 * [OUTPUT]: the pure branching fold — pathTo / foldEvents / foldStep (one event, the step foldEvents
 *   is a reduce of) / truthOf / renderCanon, plus the §3.3 dependsOn cascade
 * [POS]: lib/narrative-core/world — the load-bearing half of the narrative engine. Pure and
 *   deterministic by contract (no Date, no I/O, no randomness): every branch state is
 *   `fold(path)`, which is what makes branching free and time travel a truncation.
 * [PROTOCOL]: fold stays dumb and honest. Adjudication lives in the pipeline stages — if fold
 *   ever starts *deciding* which of two facts wins, the layering is broken.
 */

import type {
  BranchId,
  EventId,
  FactRecord,
  FactStatus,
  World,
  WorldEvent,
  WorldState,
} from "./types"

export function emptyState(): WorldState {
  return { ledger: {}, flagged: [] }
}

export function emptyWorld(id: string, title: string): World {
  return { id, title, trunk: [], branches: {}, constitution: [] }
}

/**
 * The event path for a branch: trunk up to the fork point, then the branch's own events.
 * `upToOrdinal` truncates — which is why "enter this world at chapter 12" and "what did the world
 * look like at chapter 12" are the same operation.
 */
export function pathTo(world: World, branchId: BranchId | null, upToOrdinal?: number): WorldEvent[] {
  const cut = (events: WorldEvent[]): WorldEvent[] =>
    upToOrdinal === undefined ? events : events.filter((e) => e.ordinal <= upToOrdinal)

  if (branchId === null) return cut(world.trunk)

  const branch = world.branches[branchId]
  if (!branch) throw new Error(`unknown branch: ${branchId}`)
  if (branch.from === null) return cut(branch.events)

  const forkIndex = world.trunk.findIndex((e) => e.id === branch.from)
  if (forkIndex < 0) throw new Error(`branch ${branchId} forks from unknown event ${branch.from}`)
  return cut([...world.trunk.slice(0, forkIndex + 1), ...branch.events])
}

/** Live = still the operative truth. Refuted, amended-away and cascade-invalidated records are not. */
function isLive(record: FactRecord): boolean {
  if (record.invalidatedBy) return false
  return record.status === "asserted" || record.status === "confirmed" || record.status === "contested"
}

/**
 * The operative truth for a key. Returns more than one record only when the source deliberately
 * left the matter contested; two plain `asserted` records on one key is the silent-double-truth
 * defect, not a feature (see `silentDoubleTruths`).
 */
export function truthOf(state: WorldState, key: string): FactRecord[] {
  return (state.ledger[key] ?? []).filter(isLive)
}

export function truthValue(state: WorldState, key: string): string | null {
  const live = truthOf(state, key)
  return live.length === 1 ? live[0].value : null
}

/**
 * Two or more live records on one key that were never adjudicated as contested. This is the
 * "quietly wrong" state the whole verification layer exists to prevent: the world reads fluently
 * and holds two incompatible truths at once. Must always be zero.
 */
export function silentDoubleTruths(state: WorldState): string[] {
  return Object.keys(state.ledger).filter((key) => {
    const live = truthOf(state, key)
    return live.length >= 2 && !live.every((r) => r.status === "contested")
  })
}

/**
 * Fold an event sequence into a state. Pure: same input ⇒ byte-identical output.
 *
 * A reduce over `foldStep`, then the cascade — the one pass that needs the whole log (`applyCascade`).
 */
export function foldEvents(events: WorldEvent[]): WorldState {
  const state = events.reduce(foldStep, emptyState())
  applyCascade(state, events)
  return state
}

/**
 * One event folded onto a state: the step `foldEvents` is a reduce of.
 *
 * Ordering within one event: contests → refutations → assertions. Refuting before asserting is
 * what lets a single event carry "X was wrong, it is actually Y" without the new value being
 * caught by its own refutation.
 *
 * A reducer, not a persistent structure: it folds `event` INTO `state` and returns that same object,
 * records updated in place exactly as inside `foldEvents`. Copying the ledger at every step makes a fold of
 * n chapters O(n²) — 160 ms for 300 chapters of 20 distinct keys, measured (L4). Deterministic and free of
 * I/O like everything here; a caller that needs the state from before a step keeps its own copy.
 *
 * `events.reduce(foldStep, emptyState())` IS `foldEvents(events)` for any log whose events carry no
 * `dependsOn` edge — every ingest event (`claimsToEvent` never infers one) — because the cascade only
 * fires along edges. That is what makes the state after each step a valid frame for classifying the next
 * chapter, and the world ledger's read-time fold (lib/ledger) linear. With edges, `foldEvents` adds
 * `applyCascade` over the whole log. lib/narrative-core/world/fold-step.test.ts pins both.
 */
export function foldStep(state: WorldState, event: WorldEvent): WorldState {
  for (const key of event.contests ?? []) {
    for (const record of state.ledger[key] ?? []) {
      if (isLive(record)) record.status = "contested"
    }
  }

  for (const refutation of event.refutations) {
    const records = state.ledger[refutation.key] ?? []
    const live = records.filter(isLive)

    if (refutation.kind === "amended") {
      // §3.2: an amendment erases — the old value was only ever a draft.
      state.ledger[refutation.key] = records.filter((r) => !live.includes(r))
    } else {
      // in-world keeps the superseded record so the misdirection stays legible; progressed keeps
      // it as history. The kind is what later decides whether the cascade fires.
      for (const record of live) {
        record.status = "refuted"
        record.resolved = { at: event.id, ordinal: event.ordinal, kind: refutation.kind }
      }
    }

    // `!= null` on purpose: a model-produced refutation carries null, a hand-written one omits.
    if (refutation.value != null) {
      appendRecord(state, {
        key: refutation.key,
        value: refutation.value,
        asserted: { at: event.id, ordinal: event.ordinal, by: event.narrator },
        status: "asserted",
        resolved: null,
        provenance: provenanceFor(event.source),
      })
    }
  }

  for (const assertion of event.assertions) {
    const contested = (event.contests ?? []).includes(assertion.key)
    const status: FactStatus = contested ? "contested" : "asserted"

    // Re-asserting a value a live record already holds is a NO-OP, not a second record.
    // The collider only asks "does this key hold a DIFFERENT value", so an unchanged fact
    // restated in a later chapter ("Neave is dead", again) never reaches adjudication and used
    // to fold as a duplicate — two live records on one key, which is the silent double-truth
    // pathology made out of a single, entirely uncontroversial fact. Idempotence belongs here,
    // in the fold, rather than as a filter at every producer.
    if (truthOf(state, assertion.key).some((r) => r.value === assertion.value)) continue

    appendRecord(state, {
      key: assertion.key,
      value: assertion.value,
      asserted: { at: event.id, ordinal: event.ordinal, by: assertion.by },
      status,
      resolved: null,
      provenance: provenanceFor(event.source),
    })
  }

  return state
}

function provenanceFor(source: WorldEvent["source"]): FactRecord["provenance"] {
  if (source === "player") return "player"
  if (source === "author") return "author"
  return "canon"
}

function appendRecord(state: WorldState, record: FactRecord): void {
  if (!state.ledger[record.key]) state.ledger[record.key] = []
  state.ledger[record.key].push(record)
}

/**
 * PRD §3.3. When an event's supporting fact is refuted **as never having been true**, every record
 * asserted by events that (transitively) depend on it is invalidated.
 *
 * ONLY `in-world` refutations taint. A `progressed` record was true when it was asserted, so
 * testimony resting on it is still sound — the constable really did stop searching the garden side,
 * he simply resumed later. Cascading a progression would delete good history. This asymmetry is
 * the entire reason `progression` is its own verdict class.
 */
export function applyCascade(state: WorldState, events: WorldEvent[]): void {
  const taintedSources = new Set<EventId>()
  for (const records of Object.values(state.ledger)) {
    for (const record of records) {
      if (record.status === "refuted" && record.resolved?.kind === "in-world") {
        taintedSources.add(record.asserted.at)
      }
    }
  }
  if (taintedSources.size === 0) return

  // Transitive closure over dependsOn, in log order (dependencies always precede dependents).
  const tainted = new Set<EventId>(taintedSources)
  const culprit = new Map<EventId, EventId>()
  for (const event of events) {
    const badDep = event.dependsOn.find((dep) => tainted.has(dep))
    if (badDep === undefined) continue
    tainted.add(event.id)
    culprit.set(event.id, badDep)
  }

  for (const records of Object.values(state.ledger)) {
    for (const record of records) {
      // Directly-refuted records already carry their own resolution; only dependents here.
      if (record.status === "refuted") continue
      const via = culprit.get(record.asserted.at)
      if (via) record.invalidatedBy = via
    }
  }
}

/** Compact canon projection for a prompt. Its size is the per-call cost floor. */
export function renderCanon(state: WorldState): string {
  const lines: string[] = ["[ESTABLISHED WORLD STATE]"]
  const keys = Object.keys(state.ledger).sort()
  let printed = 0

  for (const key of keys) {
    const live = truthOf(state, key)
    if (live.length === 0) continue
    printed += 1
    if (live.length === 1) {
      const r = live[0]
      const mark = r.status === "contested" ? " (CONTESTED — the text never settles this)" : ""
      lines.push(`- ${key} = ${r.value} (asserted by ${r.asserted.by}, #${r.asserted.ordinal})${mark}`)
    } else {
      lines.push(`- ${key} = CONTESTED between:`)
      for (const r of live) lines.push(`    · ${r.value} (${r.asserted.by}, #${r.asserted.ordinal})`)
    }
  }

  if (printed === 0) lines.push("(nothing established yet)")

  const superseded = keys.flatMap((key) =>
    (state.ledger[key] ?? [])
      .filter((r) => r.status === "refuted")
      .map((r) => {
        const why = r.resolved?.kind === "progressed" ? "until it changed at" : "until it was overturned at"
        return `- ${key} was ${r.value} (${r.asserted.by}, #${r.asserted.ordinal}) ${why} #${r.resolved?.ordinal}`
      }),
  )
  if (superseded.length > 0) {
    lines.push("[SUPERSEDED — established earlier, no longer current]")
    lines.push(...superseded)
  }

  return lines.join("\n")
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
