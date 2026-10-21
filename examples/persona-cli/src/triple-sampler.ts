/**
 * @input  The persona's character card (goals / background / personality: the
 *         fields l3.motive-gap reads as want / belief / self), the book's named
 *         entities, and a seed string
 * @output anchorsFromCard(): the card cut into id-carrying anchors, limited to
 *         what the motive digest shows the detector. sampleTriples(): distinct
 *         (want, belief, self) triples, each naming the anchor his opening
 *         choice goes against. Same card and seed, same triples, whatever order
 *         the anchors arrived in.
 * @pos    Virtual-character CLI, idea step 1 of 2: code chooses the anchors and
 *         the collision, the model only writes the moment (private-layer.md §3,
 *         §4). Vocabulary from PR #844, docs/plans/2026-10-20-motive-gap-detector.md.
 *         Staged beside the PRD until the CLI repo exists; it imports nothing,
 *         so it moves as is.
 */

export type Dimension = "want" | "belief" | "self";

export const DIMENSIONS: readonly Dimension[] = ["want", "belief", "self"];

export interface Anchor {
  /** Where on the card it came from: `${characterId}:${field}:${n}`. */
  readonly id: string;
  readonly text: string;
  /** Ids of the book entities the anchor names. Anchors naming the same entity are one story. */
  readonly about: readonly string[];
}

export type Mind = Readonly<Record<Dimension, readonly Anchor[]>>;

/**
 * The motive digest's caps (PR #844 §4.1). The detector reads only this much
 * of each field, so the sampler uses only this much: an idea built on an anchor
 * the detector cannot see would be judged a gap. Re-check when motive-digest.ts lands.
 */
export const CARD_CAPS = { goals: 300, background: 200, personality: 200 } as const;

export type CardField = keyof typeof CARD_CAPS;

const FIELD_OF: Readonly<Record<Dimension, CardField>> = {
  want: "goals",
  belief: "background",
  self: "personality",
};

/** The card's fields are single-line inputs in the editor, so anchors are split on semicolons. */
const SEPARATOR = /[;\uFF1B\n]/;

export type Card = Readonly<Partial<Record<CardField, string | null>>>;

export interface NamedEntity {
  readonly id: string;
  /** Name and aliases. Matched as the product matches mentions: lowercase substring, 2+ characters. */
  readonly names: readonly string[];
}

export function anchorsFromCard(
  card: Card,
  characterId: string,
  entities: readonly NamedEntity[] = [],
): Mind {
  const anchorsOf = (dimension: Dimension): Anchor[] => {
    const field = FIELD_OF[dimension];
    const raw = (card[field] ?? "").trim();
    const cap = CARD_CAPS[field];
    const parts = raw.slice(0, cap).split(SEPARATOR);
    // An anchor the cap cuts in half is not one the detector can see whole.
    if (raw.length > cap && !SEPARATOR.test(raw.charAt(cap))) parts.pop();
    return parts
      .map((part) => part.trim())
      .filter((text) => text !== "")
      .map((text, n) => ({ id: `${characterId}:${field}:${n}`, text, about: named(text, entities) }));
  };
  return { want: anchorsOf("want"), belief: anchorsOf("belief"), self: anchorsOf("self") };
}

export interface SampleOptions {
  /** Required: a list nobody can regenerate is a list nobody can debug. */
  readonly seed: string;
  /** Ideas to list. Clamped to the number of distinct triples. Default 5. */
  readonly count?: number;
  /** Weight per pair of anchors that name the same entity, against 1. Default 3. */
  readonly coherentWeight?: number;
}

interface AnchorRef {
  readonly id: string;
  readonly text: string;
}

export interface Triple {
  /** "want|belief|self" anchor ids: the dedupe key and the provenance. */
  readonly key: string;
  readonly index: number;
  readonly seed: string;
  readonly want: AnchorRef;
  readonly belief: AnchorRef;
  readonly self: AnchorRef;
  /** The anchor his opening choice goes against. The other two explain it. */
  readonly collides: Dimension;
  /** Which pairs of anchors name the same entity. */
  readonly links: { readonly wantBelief: boolean; readonly wantSelf: boolean; readonly beliefSelf: boolean };
}

const DEFAULT_COUNT = 5;
const DEFAULT_COHERENT_WEIGHT = 3;

interface Combo {
  readonly want: Anchor;
  readonly belief: Anchor;
  readonly self: Anchor;
}

/**
 * Every pool is dealt in laps: each anchor is used once before any is used
 * twice, and the collision cycles through want, belief and self the same way.
 * Within a lap, a combination is weighted by how many of its pairs name the
 * same entity: anchors that belong to one story are favoured, never forced,
 * so crossovers between stories keep coming.
 */
export function sampleTriples(mind: Mind, options: SampleOptions): Triple[] {
  const wants = canonical(mind.want, "want");
  const beliefs = canonical(mind.belief, "belief");
  const selves = canonical(mind.self, "self");
  if (typeof options.seed !== "string" || options.seed.length === 0) {
    throw new Error("seed is required");
  }
  const requested = options.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(requested) || requested < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${requested}`);
  }
  const coherentWeight = options.coherentWeight ?? DEFAULT_COHERENT_WEIGHT;
  if (!Number.isFinite(coherentWeight) || coherentWeight < 1) {
    throw new RangeError(`coherentWeight must be a finite number >= 1, got ${coherentWeight}`);
  }

  // At most every distinct triple. Each step below adds one triple while
  // fewer than this exist, so the loop always ends.
  const count = Math.min(requested, wants.length * beliefs.length * selves.length);
  const random = createRandom(options.seed);
  const used = new Set<string>();
  const wantUses = new Map<string, number>();
  const beliefUses = new Map<string, number>();
  const selfUses = new Map<string, number>();
  const triples: Triple[] = [];

  while (triples.length < count) {
    for (const collides of shuffle(DIMENSIONS, random)) {
      if (triples.length === count) break;
      let open = openCombos(wants, beliefs, selves, used);
      open = leastUsed(open, open.map((c) => beliefUses.get(c.belief.id) ?? 0));
      open = leastUsed(open, open.map((c) => selfUses.get(c.self.id) ?? 0));
      open = leastUsed(open, open.map((c) => wantUses.get(c.want.id) ?? 0));
      const { want, belief, self } = pick(
        open.map((combo) => ({ item: combo, weight: coherentWeight ** linkCount(linksOf(combo)) })),
        random,
      );

      const key = keyOf(want, belief, self);
      used.add(key);
      wantUses.set(want.id, (wantUses.get(want.id) ?? 0) + 1);
      beliefUses.set(belief.id, (beliefUses.get(belief.id) ?? 0) + 1);
      selfUses.set(self.id, (selfUses.get(self.id) ?? 0) + 1);
      triples.push({
        key,
        index: triples.length,
        seed: options.seed,
        want: { id: want.id, text: want.text },
        belief: { id: belief.id, text: belief.text },
        self: { id: self.id, text: self.text },
        collides,
        links: linksOf({ want, belief, self }),
      });
    }
  }
  return triples;
}

function named(text: string, entities: readonly NamedEntity[]): string[] {
  const haystack = text.toLowerCase();
  return entities
    .filter((entity) =>
      entity.names.some((name) => {
        const needle = name.trim().toLowerCase();
        return needle.length >= 2 && haystack.includes(needle);
      }),
    )
    .map((entity) => entity.id);
}

function canonical(items: readonly Anchor[], pool: Dimension): Anchor[] {
  if (items.length === 0) {
    throw new Error(`${pool} is empty: the card gives nothing to collide`);
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== "string" || item.id === "" || item.id.includes("|")) {
      throw new Error(`${pool}: invalid id "${String(item.id)}"`);
    }
    if (seen.has(item.id)) throw new Error(`${pool}: duplicate id ${item.id}`);
    if (typeof item.text !== "string" || item.text.trim() === "") {
      throw new Error(`${pool}: ${item.id} has no text`);
    }
    seen.add(item.id);
  }
  // Anchors come back from the API in no promised order. Sorting by id makes
  // "same seed, same ideas" a property of the card, not of the fetch.
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function openCombos(
  wants: readonly Anchor[],
  beliefs: readonly Anchor[],
  selves: readonly Anchor[],
  used: ReadonlySet<string>,
): Combo[] {
  return wants.flatMap((want) =>
    beliefs.flatMap((belief) =>
      selves.filter((self) => !used.has(keyOf(want, belief, self))).map((self) => ({ want, belief, self })),
    ),
  );
}

function keyOf(want: Anchor, belief: Anchor, self: Anchor): string {
  return `${want.id}|${belief.id}|${self.id}`;
}

function leastUsed<T>(items: readonly T[], uses: readonly number[]): T[] {
  const fewest = Math.min(...uses);
  return items.filter((_, i) => uses[i] === fewest);
}

function shares(a: Anchor, b: Anchor): boolean {
  return a.about.some((id) => b.about.includes(id));
}

function linksOf(combo: Combo): Triple["links"] {
  return {
    wantBelief: shares(combo.want, combo.belief),
    wantSelf: shares(combo.want, combo.self),
    beliefSelf: shares(combo.belief, combo.self),
  };
}

function linkCount(links: Triple["links"]): number {
  return Number(links.wantBelief) + Number(links.wantSelf) + Number(links.beliefSelf);
}

function pick<T>(
  entries: readonly { readonly item: T; readonly weight: number }[],
  random: () => number,
): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let target = random() * total;
  let chosen: { readonly item: T } | undefined;
  for (const entry of entries) {
    chosen = entry;
    target -= entry.weight;
    if (target < 0) break;
  }
  if (!chosen) throw new Error("pick: nothing to choose from");
  return chosen.item;
}

/** One draw per item, then sort by the draws: a uniform permutation, no index swapping. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, draw: random() }))
    .sort((a, b) => a.draw - b.draw)
    .map(({ item }) => item);
}

/**
 * FNV-1a over the seed's UTF-16 code units, then mulberry32. Changing either
 * stops every seed already printed from reproducing its list.
 */
function createRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
