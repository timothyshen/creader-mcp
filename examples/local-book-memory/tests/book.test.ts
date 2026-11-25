import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { contentHash } from "../../../src/lib/content-hash.js"
import { readChapters, splitFrontmatter } from "../src/book.js"
import { bookOnDisk } from "./helpers.js"

describe("readChapters", () => {
  it("reads chapters in file-name order when nothing says otherwise, ids from file names, titles from the first heading", () => {
    const dir = bookOnDisk({ "02-later.md": "# The Later One\n\nSecond.", "01-first.md": "First, no heading." })
    const chapters = readChapters(dir)
    expect(chapters.map((c) => [c.id, c.title, c.order])).toEqual([
      ["01-first", "01-first", 1],
      ["02-later", "The Later One", 2],
    ])
  })

  it("lets frontmatter set id, title and order, and keeps it out of the prose", () => {
    const dir = bookOnDisk({
      "a.md": "---\nid: ch-door\ntitle: \"The Door\"\norder: 2\n---\nThe door was bolted.",
      "b.md": "---\nid: ch-ring\norder: 1\n---\nThe ring was silver.",
    })
    const chapters = readChapters(dir)
    expect(chapters.map((c) => [c.id, c.title, c.order])).toEqual([
      ["ch-ring", "b", 1],
      ["ch-door", "The Door", 2],
    ])
    expect(chapters[1]!.text).toBe("The door was bolted.")
  })

  it("hashes the prose exactly as the hosted API does, so the same stale-read rule applies", () => {
    const dir = bookOnDisk({ "01.md": "---\nid: one\n---\n她把门闩上了。" })
    expect(readChapters(dir)[0]!.contentHash).toBe(contentHash("她把门闩上了。"))
  })

  it("refuses two chapters with one id instead of silently merging their facts", () => {
    const dir = bookOnDisk({ "01.md": "---\nid: same\n---\nA", "02.md": "---\nid: same\n---\nB" })
    expect(() => readChapters(dir)).toThrow(/share the id "same"/)
  })

  it("has no chapters when the folder has none", () => {
    const dir = bookOnDisk({})
    writeFileSync(join(dir, "chapters", "notes.txt"), "not a chapter")
    expect(readChapters(dir)).toEqual([])
  })
})

describe("splitFrontmatter", () => {
  it("leaves a file without fences untouched", () => {
    expect(splitFrontmatter("--- not frontmatter")).toEqual({ meta: {}, body: "--- not frontmatter" })
  })
})
