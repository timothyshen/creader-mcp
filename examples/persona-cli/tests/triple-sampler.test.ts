import { describe, expect, it } from "vitest";
import {
  anchorsFromCard,
  CARD_CAPS,
  DIMENSIONS,
  sampleTriples,
  type Anchor,
  type Mind,
  type NamedEntity,
} from "../src/triple-sampler";

// The card from private-layer.md §2.1, word for word. If the doc's card
// changes, this changes with it.
const CARD = {
  goals:
    "keep the crew seeing the fun one, not the guy whose dad can't hold a cup; stay Dennis's best friend; keep being the one who knows about Tiffany; keep hearing what Grandma really says about the family; find out who he is after the parties, before he's the oldest one there",
  background:
    "drives Dad to PT in Dad's own Lexus since the March stroke; at EDC a girl asked if he's someone's big brother; saw Tiffany leave Hard Summer with a guy, not Dennis; understands Grandma's Cantonese",
  personality:
    "the guy who pulls up in the Lexus; always out, EDC to the 2 a.m. boba run; loyal to Dennis to a fault; the one who always looks put together; not Chinese the way his grandmother means it",
};

const ENTITIES: NamedEntity[] = [
  { id: "dad", names: ["Dad"] },
  { id: "dennis", names: ["Dennis"] },
  { id: "tiffany", names: ["Tiffany"] },
  { id: "grandma", names: ["Grandma", "grandmother"] },
  { id: "lexus", names: ["Lexus"] },
  { id: "edc", names: ["EDC"] },
  { id: "hard-summer", names: ["Hard Summer"] },
];

const mind = anchorsFromCard(CARD, "persona", ENTITIES);

function anchor(id: string, about: string[] = []): Anchor {
  return { id, text: `text of ${id}`, about };
}

function reversed(m: Mind): Mind {
  return { want: [...m.want].reverse(), belief: [...m.belief].reverse(), self: [...m.self].reverse() };
}

describe("anchorsFromCard", () => {
  it("keeps the doc's card inside the motive digest's caps, so nothing in it is cut", () => {
    expect(CARD.goals.length).toBeLessThanOrEqual(CARD_CAPS.goals);
    expect(CARD.background.length).toBeLessThanOrEqual(CARD_CAPS.background);
    expect(CARD.personality.length).toBeLessThanOrEqual(CARD_CAPS.personality);
    expect([mind.want.length, mind.belief.length, mind.self.length]).toEqual([5, 4, 5]);
  });

  it("gives every anchor an id that says where on the card it came from", () => {
    expect(mind.belief.map((a) => a.id)).toEqual([
      "persona:background:0",
      "persona:background:1",
      "persona:background:2",
      "persona:background:3",
    ]);
    expect(mind.self[0]?.text).toBe("the guy who pulls up in the Lexus");
  });

  // The card's fields are single-line inputs in the editor: a newline typed
  // through the API would not survive the next edit there, a semicolon does.
  it("splits on semicolons, full-width semicolons and newlines", () => {
    const fullWidth = String.fromCharCode(0xff1b);
    const { want } = anchorsFromCard({ goals: `one; two${fullWidth}three\nfour;; ` }, "c");
    expect(want.map((a) => a.text)).toEqual(["one", "two", "three", "four"]);
  });

  it("drops an anchor the cap cuts in half: the detector cannot see it whole", () => {
    const background = `${"x".repeat(150)}; ${"y".repeat(80)}`;
    expect(anchorsFromCard({ background }, "c").belief.map((a) => a.text)).toEqual(["x".repeat(150)]);
  });

  it("keeps the last anchor when the cap falls exactly on a separator", () => {
    const background = `${"x".repeat(200)}; tail`;
    expect(anchorsFromCard({ background }, "c").belief.map((a) => a.text)).toEqual(["x".repeat(200)]);
  });

  it("records which book entities an anchor names, aliases included", () => {
    expect(mind.belief[0]?.about).toEqual(["dad", "lexus"]);
    expect(mind.self[4]?.about).toEqual(["grandma"]);
    expect(mind.want[4]?.about).toEqual([]);
    const shortName: NamedEntity[] = [{ id: "a", names: ["a"] }];
    expect(anchorsFromCard({ goals: "a cat" }, "c", shortName).want[0]?.about).toEqual([]);
  });

  it("turns a missing field into an empty pool, which the sampler then refuses", () => {
    const partial = anchorsFromCard({ goals: "stay", background: null }, "c");
    expect(partial.belief).toEqual([]);
    expect(() => sampleTriples(partial, { seed: "x" })).toThrow("belief is empty");
  });
});

describe("sampleTriples", () => {
  describe("a seed printed in a session log regenerates that exact list", () => {
    it("returns the same triples for the same card and seed", () => {
      expect(sampleTriples(mind, { seed: "westbund-1" })).toEqual(sampleTriples(mind, { seed: "westbund-1" }));
    });

    it("does not depend on the order the anchors arrived in", () => {
      expect(sampleTriples(reversed(mind), { seed: "westbund-1", count: 9 })).toEqual(
        sampleTriples(mind, { seed: "westbund-1", count: 9 }),
      );
    });

    // Pins the generator itself. If this fails, every seed anyone has logged
    // now names a different list: change the RNG or the draw order only on
    // purpose, and say so where the seeds are printed.
    it("keeps what seed westbund-1 has always meant", () => {
      expect(sampleTriples(mind, { seed: "westbund-1" }).map((t) => `${t.key}#${t.collides}`)).toEqual([
        "persona:goals:4|persona:background:3|persona:personality:4#want",
        "persona:goals:1|persona:background:2|persona:personality:3#belief",
        "persona:goals:3|persona:background:1|persona:personality:1#self",
        "persona:goals:2|persona:background:0|persona:personality:2#belief",
        "persona:goals:0|persona:background:0|persona:personality:0#self",
      ]);
    });

    it("gives a different list for a different seed", () => {
      const keys = (seed: string) => sampleTriples(mind, { seed }).map((t) => t.key);
      expect(keys("westbund-2")).not.toEqual(keys("westbund-1"));
    });
  });

  describe("variety comes from the draw, not from model temperature", () => {
    it("uses every anchor in a pool once before any is used twice", () => {
      const triples = sampleTriples(mind, { seed: "laps", count: 5 });
      expect(new Set(triples.slice(0, 4).map((t) => t.belief.id)).size).toBe(4);
      expect(new Set(triples.map((t) => t.want.id)).size).toBe(5);
      expect(new Set(triples.map((t) => t.self.id)).size).toBe(5);
    });

    it("cycles the collision through want, belief and self", () => {
      const triples = sampleTriples(mind, { seed: "collisions", count: 6 });
      expect(new Set(triples.slice(0, 3).map((t) => t.collides)).size).toBe(3);
      for (const dimension of DIMENSIONS) {
        expect(triples.filter((t) => t.collides === dimension)).toHaveLength(2);
      }
    });

    it("never repeats a triple and stops at the number of triples that exist", () => {
      const small: Mind = {
        want: [anchor("w1"), anchor("w2")],
        belief: [anchor("b1"), anchor("b2")],
        self: [anchor("s1"), anchor("s2")],
      };
      const triples = sampleTriples(small, { seed: "all", count: 20 });
      expect(triples).toHaveLength(8);
      expect(new Set(triples.map((t) => t.key)).size).toBe(8);
      expect(triples.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    // One want that names Dennis, four beliefs of which one names him, one
    // self that names no one. Weight 3 against three 1s puts the Dennis
    // belief in half the draws: favoured, never forced.
    it("favours anchors that name the same person without forcing them", () => {
      const knowledge: Mind = {
        want: [anchor("w-dennis", ["dennis"])],
        belief: [anchor("b-dennis", ["dennis"]), anchor("b-a", ["a"]), anchor("b-b", ["b"]), anchor("b-c", ["c"])],
        self: [anchor("s")],
      };
      const share = (coherentWeight: number) => {
        let linked = 0;
        for (let i = 0; i < 400; i++) {
          if (sampleTriples(knowledge, { seed: `s${i}`, count: 1, coherentWeight })[0]?.links.wantBelief) linked++;
        }
        return linked / 400;
      };
      expect(share(3)).toBeGreaterThan(0.4);
      expect(share(3)).toBeLessThan(0.6);
      expect(share(1)).toBeGreaterThan(0.15);
      expect(share(1)).toBeLessThan(0.35);
    });
  });

  describe("every triple says which anchors it came from", () => {
    it("carries the ids and texts it was given", () => {
      const byId = new Map([...mind.want, ...mind.belief, ...mind.self].map((a) => [a.id, a.text]));
      for (const t of sampleTriples(mind, { seed: "provenance", count: 12 })) {
        expect(byId.get(t.want.id)).toBe(t.want.text);
        expect(byId.get(t.belief.id)).toBe(t.belief.text);
        expect(byId.get(t.self.id)).toBe(t.self.text);
        expect(t.key).toBe(`${t.want.id}|${t.belief.id}|${t.self.id}`);
        expect(t.seed).toBe("provenance");
      }
    });

    it("reports a link exactly when two anchors name the same entity", () => {
      const about = new Map([...mind.want, ...mind.belief, ...mind.self].map((a) => [a.id, a.about] as const));
      const shares = (x: string, y: string) => (about.get(x) ?? []).some((id) => (about.get(y) ?? []).includes(id));
      for (const t of sampleTriples(mind, { seed: "links", count: 25 })) {
        expect(t.links).toEqual({
          wantBelief: shares(t.want.id, t.belief.id),
          wantSelf: shares(t.want.id, t.self.id),
          beliefSelf: shares(t.belief.id, t.self.id),
        });
      }
    });
  });

  describe("refuses a broken card instead of sampling from it", () => {
    it.each(DIMENSIONS)("an empty %s pool", (pool) => {
      expect(() => sampleTriples({ ...mind, [pool]: [] }, { seed: "x" })).toThrow(`${pool} is empty`);
    });

    it("a duplicate id", () => {
      const self = [...mind.self, ...mind.self.slice(0, 1)];
      expect(() => sampleTriples({ ...mind, self }, { seed: "x" })).toThrow("duplicate id persona:personality:0");
    });

    it("an id that would make the key ambiguous", () => {
      expect(() => sampleTriples({ ...mind, want: [anchor("a|b")] }, { seed: "x" })).toThrow('invalid id "a|b"');
    });

    it("an anchor with no text", () => {
      const want = [{ id: "blank", text: "  ", about: [] }];
      expect(() => sampleTriples({ ...mind, want }, { seed: "x" })).toThrow("blank has no text");
    });

    it("no seed", () => {
      expect(() => sampleTriples(mind, { seed: "" })).toThrow("seed is required");
    });

    it.each([-1, 1.5, Number.NaN])("a count of %s", (count) => {
      expect(() => sampleTriples(mind, { seed: "x", count })).toThrow(RangeError);
    });

    it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])("a coherentWeight of %s", (coherentWeight) => {
      expect(() => sampleTriples(mind, { seed: "x", coherentWeight })).toThrow(RangeError);
    });

    it("but a count of zero is an empty list, not an error", () => {
      expect(sampleTriples(mind, { seed: "x", count: 0 })).toEqual([]);
    });
  });
});
