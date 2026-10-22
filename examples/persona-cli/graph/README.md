# graph/

Generated, not committed: `graph.json` (the merged graph) and `REVIEW.md` (the review sheet) carry
one verbatim quote per piece of evidence from the source documents, about 150k characters of
third-party text in total, so they stay local like the corpus bodies. Regenerate them from the
sources in `../corpus/sources.json`:

```bash
pnpm ingest fetch                                   # corpus/<id>.md (paste login-walled sources by hand)
pnpm ingest extract --env ../../../creader_editor/.env.local   # graph/extract/<id>.json, anchored
pnpm ingest merge                                   # graph/graph.json + graph/REVIEW.md
pnpm ingest load --env ../../.env                   # into the seeded book
```

`extract/` is the per-document intermediate and is also ignored.
