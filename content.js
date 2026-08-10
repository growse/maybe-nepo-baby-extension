/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

(async function () {
  'use strict';

  const path = decodeURIComponent(window.location.pathname);
  if (!path.startsWith('/wiki/')) return;

  const rawTitle = path.replace(/^\/wiki\//, '');
  if (rawTitle.includes(':')) return;

  try {
    const qid = await findQid();
    if (!qid) return;

    const parentQids = await fetchParentQids(qid);
    if (parentQids.length === 0) return;

    const parents = await fetchParentPages(parentQids);
    if (parents.length > 0) renderBanner(parents);
  } catch (error) {
    console.error('[nepo-maybe-baby]', error);
  }

  // Deliberately no background script: every request below is a legal
  // page-origin CORS call on its own merits. The `origin=*` param makes
  // Wikimedia respond with `Access-Control-Allow-Origin: *`, and Wikipedia's
  // CSP `default-src` allowlists www.wikidata.org.
  //
  // This is what keeps the extension working on Chrome, where MV3 content
  // scripts fetch as the page origin and `host_permissions` do not apply to
  // them. If Wikimedia ever tightens its CORS or CSP headers, Chrome will
  // break first and this logic has to move back into a background
  // service worker reached via runtime.sendMessage.
  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    return response.json();
  }

  // The article already carries its own Wikidata id in the "Wikidata item"
  // sidebar link, so the overwhelmingly common case costs no lookup request
  // at all. A page with no such link usually has no Wikidata item, and we
  // stop there having made zero requests.
  async function findQid() {
    const link = document.querySelector('#t-wikibase a');
    const href = link?.getAttribute('href') ?? '';
    const fromDom = /\/(Q\d+)(?:[?#]|$)/.exec(href);
    if (fromDom) return fromDom[1];

    return fetchQidFromApi();
  }

  // Fallback for when that link is missing. Rarely used, but it means a
  // change to Wikipedia's markup degrades to the old behaviour rather than
  // silently showing no banners forever.
  //
  // It reads the canonical title rather than the URL: visiting a redirect
  // leaves the redirecting title in the address bar, and Wikidata cannot
  // resolve those.
  async function fetchQidFromApi() {
    const canonical = document.querySelector('link[rel="canonical"]');
    const title = canonical
      ? decodeURIComponent(new URL(canonical.href).pathname.replace(/^\/wiki\//, ''))
      : rawTitle;

    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=pageprops&ppprop=wikibase_item&format=json&origin=*`;
    const data = await fetchJson(url);
    const pages = Object.values(data?.query?.pages ?? {});
    return pages[0]?.pageprops?.wikibase_item ?? null;
  }

  // Father (P22) and mother (P25), fetched as two property-filtered requests
  // in parallel. wbgetclaims takes only one property per call, but filtering
  // is worth the extra request: fetching an entity's full claim set costs
  // 20-190 KB gzipped, where these are a few hundred bytes each. Running them
  // together keeps it to a single round trip.
  async function fetchParentQids(qid) {
    const responses = await Promise.all(['P22', 'P25'].map(property => fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=${property}&format=json&origin=*`
    )));

    const parentQids = [];
    for (const response of responses) {
      for (const claims of Object.values(response?.claims ?? {})) {
        for (const claim of claims) {
          const id = claim.mainsnak?.datavalue?.value?.id;
          if (id) parentQids.push(id);
        }
      }
    }
    return parentQids;
  }

  // Resolve parent ids to English Wikipedia articles, dropping any parent who
  // has a Wikidata item but no article of their own.
  async function fetchParentPages(parentQids) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${parentQids.map(encodeURIComponent).join('|')}&props=sitelinks/urls&sitefilter=enwiki&format=json&origin=*`;
    const data = await fetchJson(url);

    const parents = [];
    for (const pid of parentQids) {
      const enwiki = data?.entities?.[pid]?.sitelinks?.enwiki;
      if (enwiki) {
        parents.push({ title: enwiki.title, url: enwiki.url });
      }
    }
    return parents;
  }

  function renderBanner(parents) {
    if (document.getElementById('nepo-maybe-baby-root')) return;
    if (!document.body) return;

    const banner = document.createElement('div');
    banner.id = 'nepo-maybe-baby-root';
    banner.setAttribute('role', 'note');

    const many = parents.length > 1;

    // Built node by node rather than via innerHTML: AMO's linter flags any
    // innerHTML assignment, and textContent makes escaping unnecessary.
    const icon = document.createElement('span');
    icon.className = 'nmb-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '👶';

    const text = document.createElement('p');
    text.className = 'nmb-text';

    const title = document.createElement('strong');
    title.className = 'nmb-title';
    title.textContent = 'Just so you know...';
    text.append(title, " This person's parents: ");

    parents.forEach((parent, i) => {
      if (i > 0) text.append(' and ');

      const link = document.createElement('a');
      link.className = 'nmb-link';
      link.href = parent.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = parent.title;
      text.append(link);
    });

    text.append(
      ` ${many ? 'both have' : 'has'} their own Wikipedia page${many ? 's' : ''}.` +
      " We're not saying it helped. We're just saying. 🍼"
    );

    const inner = document.createElement('div');
    inner.className = 'nmb-inner';
    inner.append(icon, text);
    banner.append(inner);

    // Full-bleed, above everything the skin renders.
    document.body.insertBefore(banner, document.body.firstChild);
  }
})();
