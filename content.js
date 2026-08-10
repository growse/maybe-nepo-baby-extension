/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

(async function () {
  'use strict';

  const BANNER_ID = 'nepo-maybe-baby-root';

  // The article the banner currently reflects, plus a token that invalidates
  // lookups still in flight when the article changes underneath them.
  let shownPath = null;
  let latestRun = 0;

  update({ trustPageMarkup: true });
  watchForNavigation();

  async function update({ trustPageMarkup }) {
    const path = decodeURIComponent(window.location.pathname);
    if (path === shownPath) return;
    shownPath = path;

    // Drop the previous article's banner before doing anything slow, so a
    // stale one is never left sitting above a different article.
    const run = ++latestRun;
    document.getElementById(BANNER_ID)?.remove();

    if (!path.startsWith('/wiki/')) return;

    const rawTitle = path.replace(/^\/wiki\//, '');
    if (rawTitle.includes(':')) return;

    try {
      const qid = await findQid(rawTitle, trustPageMarkup);
      if (!qid || run !== latestRun) return;

      const parentQids = await fetchParentQids(qid);
      if (parentQids.length === 0 || run !== latestRun) return;

      const parents = await fetchParentPages(parentQids);
      if (parents.length === 0 || run !== latestRun) return;

      renderBanner(parents);
    } catch (error) {
      console.error('[nepo-maybe-baby]', error);
    }
  }

  // Wikipedia serves article-to-article navigation as full page loads, so on a
  // normal visit this never fires and the script runs exactly once. It exists
  // so that a client-side navigation -- from a future Wikipedia change, a
  // gadget, or back/forward through one -- cannot strand the previous
  // article's banner above a different article.
  //
  // Watching the <title> node is deliberate: it is a single small element that
  // any navigation must update, where a subtree observer on the article body
  // would fire constantly for no benefit.
  function watchForNavigation() {
    const rerun = () => update({ trustPageMarkup: false });

    window.addEventListener('popstate', rerun);

    const title = document.querySelector('title');
    if (title) {
      new MutationObserver(rerun).observe(title, { childList: true });
    }
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
  // sidebar link, so a normal page load costs no lookup request at all. A page
  // with no such link usually has no Wikidata item, and we stop there having
  // made zero requests.
  //
  // After a client-side navigation that link may still describe the article we
  // just left, so it is not trusted there and the id is looked up by title
  // instead.
  async function findQid(rawTitle, trustPageMarkup) {
    if (trustPageMarkup) {
      const link = document.querySelector('#t-wikibase a');
      const fromDom = /\/(Q\d+)(?:[?#]|$)/.exec(link?.getAttribute('href') ?? '');
      if (fromDom) return fromDom[1];
    }

    return fetchQidFromApi(rawTitle);
  }

  // Fallback for when the sidebar link is missing or untrusted. Rarely used on
  // a normal load, but it means a change to Wikipedia's markup degrades to the
  // old behaviour rather than silently showing no banners forever.
  //
  // `redirects=1` resolves redirect titles server-side, so the title taken
  // from the URL works even when the reader arrived via a redirect.
  async function fetchQidFromApi(rawTitle) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(rawTitle)}&redirects=1&prop=pageprops&ppprop=wikibase_item&format=json&origin=*`;
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
