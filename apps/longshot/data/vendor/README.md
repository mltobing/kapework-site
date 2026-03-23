# Vendored lexicon data

## wordfreq-en-25000-log.json

**Source repository:** https://github.com/aparrish/wordfreq-en-25000
**Source file:** `wordfreq-en-25000-log.json`
**Author:** Allison Parrish
**Format:** JSON array of `[word, log_frequency]` rows, ordered most-frequent first.
**Contents:** ~25,000 English words exported from the [wordfreq](https://github.com/rspeer/wordfreq) library.

This file is vendored here so the Longshot lexicon build is reproducible without
a network dependency. To refresh it:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/aparrish/wordfreq-en-25000/main/wordfreq-en-25000-log.json \
  -o apps/longshot/data/vendor/wordfreq-en-25000-log.json
```

### Licence / attribution

The upstream wordfreq-en-25000 data was published by Allison Parrish and is
derived from [wordfreq](https://github.com/rspeer/wordfreq) (by Robyn Speer,
Luminoso Technologies). wordfreq is released under the MIT licence.

The filtered Longshot gameplay lexicon (`longshot-common-words.txt`) is a
derived work — it applies length, character, frequency-rank, allowlist, and
denylist filters to produce a gameplay-appropriate word set. No raw wordfreq
data is shipped to end-users; only the per-board precomputed word sets inside
`board-bank.json` reach the browser.

wordfreq citation (from the upstream repo):
> Robyn Speer, Joshua Chin, Andrew Lin, Sara Jewett, Lance Nathan (2018).
> "wordfreq: v2.2" [Data set]. Zenodo. https://doi.org/10.5281/zenodo.1443582
