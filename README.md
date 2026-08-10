# Nepo Maybe Baby

A browser extension that spots Wikipedia articles where the subject's parents
have their own Wikipedia pages, and gently points it out.

Some people are famous. Some people are famous and their parents were also
famous. This tells you which is which.

## What it does

Open an English Wikipedia article and the extension checks whether the subject
has a parent who also has a Wikipedia page. If so, a slim banner appears at the
top of the page linking to them. If not — which is most of the time — nothing
happens at all.

Try it on [Maya Hawke](https://en.wikipedia.org/wiki/Maya_Hawke), whose banner
links to Ethan Hawke and Uma Thurman.

## How it works

Every Wikipedia article is linked to a structured record on
[Wikidata](https://www.wikidata.org), Wikimedia's open database. Those records
can list a person's father (property `P22`) and mother (`P25`).

1. Read the article's Wikidata id straight out of the page — Wikipedia already
   puts it in the "Wikidata item" sidebar link, so this costs no request
2. Ask Wikidata for just the father and mother properties
3. Check whether either parent has their own English Wikipedia article
4. Show the banner only if at least one of them does

It all runs on the public MediaWiki and Wikidata APIs. An article with no
parent data costs two small requests; one with no Wikidata item at all costs
none.

## Install

Not yet published to either store. To run it from source:

**Firefox** — visit `about:debugging` → This Firefox → Load Temporary Add-on,
and select `manifest.json`. Temporary add-ons are removed when Firefox closes.

**Chrome** — visit `chrome://extensions`, enable Developer mode, then Load
unpacked and select the project directory.

## Development

Requires [`just`](https://github.com/casey/just), Node, Python 3, and
`rsvg-convert` (`librsvg2-bin` on Debian/Ubuntu).

| Recipe | What it does |
| --- | --- |
| `just check` | Validate the manifest and confirm every file it references exists |
| `just lint` | Run `web-ext lint`, the same validator addons.mozilla.org runs |
| `just icons` | Re-render the icon PNGs from `icons/icon.svg` |
| `just package` | Build a store-ready zip in `dist/` |
| `just clean` | Remove build output |

`just package` depends on `icons` and `check`, so a build can never ship a PNG
that has drifted from the SVG or a manifest pointing at a missing file.

Hooks are available via [pre-commit](https://pre-commit.com):

```sh
pre-commit install
```

Syntax, manifest and formatting checks run on commit; the AMO validator runs on
push, since it is slow enough to be annoying on every commit.

## Design notes

**There is no background script.** The content script queries the MediaWiki and
Wikidata APIs directly. This works because both endpoints answer with
`Access-Control-Allow-Origin: *` (via the `origin=*` parameter) and Wikipedia's
Content-Security-Policy allowlists `wikidata.org` — so the requests are legal
page-origin fetches even under Chrome MV3, where content scripts no longer
inherit the extension's host permissions.

The upshot is that one set of files runs unmodified in both Firefox and Chrome,
with no `browser`/`chrome` namespace shim and no message passing. If Wikimedia
ever tightens those headers, Chrome will break first and the lookups will need
to move into a background service worker.

**The banner is built with DOM methods, not `innerHTML`.** AMO's linter rejects
`innerHTML` assignment, and using `textContent` for parent names removes the
need for manual escaping.

**Navigation is watched, though Wikipedia does not currently need it.**
Article-to-article navigation is a full page load, so the script normally runs
once and the observer never fires. It is there so that a client-side
navigation — from a future Wikipedia change, a gadget, or back/forward through
one — cannot strand one article's banner above another. The observer watches
the `<title>` node rather than the article body, because any navigation must
update it and it is a single small element. Lookups carry a token so that a
request still in flight when the article changes is discarded rather than
drawing a banner for the page you just left.

**Claims are fetched one property at a time, on purpose.** `wbgetclaims` only
accepts a single property per call, so father and mother take two requests
rather than one. That looks wasteful next to a single `wbgetentities` call
until you measure the payloads: a full claim set is 20 KB gzipped for a minor
actor and 190 KB for a country, where the filtered requests are a few hundred
bytes each. They are issued in parallel, so it stays one round trip. Since this
runs on every article anyone opens, the bytes matter more than the request
count.

## Privacy

Nothing is collected, stored, or sent anywhere. The only network requests go to
Wikipedia and Wikidata, they carry no cookies or account information, and they
exist purely to look up the article you already have open. No tracking, no
analytics, no accounts, no settings.

## Limitations

- English Wikipedia only
- Relies on Wikidata having parent data, which is thorough for well-known
  figures and patchy further down the tail
- Only surfaces parents who have an English Wikipedia article of their own

## A note on fairness

A well-known parent is not evidence that anyone was handed anything. Plenty of
people with famous parents built their own careers entirely — hence "maybe".
The extension reports a fact and leaves the conclusion to you.

## License

[MPL 2.0](LICENSE)
