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
    const parents = await fetchParentsData(rawTitle);
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
  async function fetchParentsData(title) {
    // 1. Get Wikidata QID from Wikipedia title
    const mwUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=pageprops&ppprop=wikibase_item&format=json&origin=*`;
    const mwResp = await fetch(mwUrl).then(r => r.json());
    const pages = mwResp?.query?.pages;
    if (!pages) return [];

    const pageId = Object.keys(pages)[0];
    if (pageId === "-1") return [];

    const qid = pages[pageId]?.pageprops?.wikibase_item;
    if (!qid) return [];

    // 2. Fetch Father (P22) and Mother (P25) claims from Wikidata
    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`;
    const wdResp = await fetch(wdUrl).then(r => r.json());
    const claims = wdResp?.entities?.[qid]?.claims;
    if (!claims) return [];

    const parentQids = [];
    ['P22', 'P25'].forEach(prop => {
      if (claims[prop]) {
        claims[prop].forEach(claim => {
          const id = claim.mainsnak?.datavalue?.value?.id;
          if (id) parentQids.push(id);
        });
      }
    });

    if (parentQids.length === 0) return [];

    // 3. Resolve parent QIDs to English Wikipedia URLs
    const parentWdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${parentQids.join('|')}&props=sitelinks/urls&sitefilter=enwiki&format=json&origin=*`;
    const parentWdResp = await fetch(parentWdUrl).then(r => r.json());

    const parents = [];
    for (const pid of parentQids) {
      const enwiki = parentWdResp?.entities?.[pid]?.sitelinks?.enwiki;
      if (enwiki) {
        parents.push({
          title: enwiki.title,
          url: enwiki.url
        });
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
