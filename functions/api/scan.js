// ============================================================================
// PYTHIA RATING ENGINE V3.1
// ============================================================================
// Formula: Lighthouse (40%) + Security (20%) + Privacy (20%) +
//          Sustainability (15%) + Infrastructure (5%)
//
// KEY CHANGE from v3.0:
//   Blocked sites (403/429/bot-wall) NO LONGER return a hard error.
//   Instead we set isPartialScan = true, skip HTML-dependent analysis,
//   and still run CrUX + Lighthouse (which contact Google's servers, not
//   the target site, so bot-blocking doesn't affect them).
//   This means ~100% of real, live sites now get a score.

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const { url } = await request.json();

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── API keys ────────────────────────────────────────────────────────────
    const CRUX_API_KEY   = 'AIzaSyD3vkIWqvctKx1BRu2CEEOF7goYTyAx5Bs';
    const CRUX_API_URL   = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    const PSI_API_KEY    = 'AIzaSyBYVTe6sRJGyB9vtI0cnvBxRFQ4ruNPf8M';
    const PSI_API_URL    = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const IS_PAID_USER   = true;
    const USE_LIGHTHOUSE = true;

    // ── Helpers ─────────────────────────────────────────────────────────────
    function clamp(val, min = 0, max = 100) {
      return Math.max(min, Math.min(max, val));
    }

    function smoothScore(value, points) {
      for (let i = 0; i < points.length - 1; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[i + 1];
        if (value >= x1 && value <= x2) {
          const ratio = (value - x1) / (x2 - x1);
          return y1 + ratio * (y2 - y1);
        }
      }
      return value <= points[0][0] ? points[0][1] : points[points.length - 1][1];
    }

    // ── CrUX ────────────────────────────────────────────────────────────────
    async function fetchCruxData(siteUrl) {
      try {
        const urlObj = new URL(siteUrl);
        const origin = `${urlObj.protocol}//${urlObj.hostname}`;

        console.log('📊 Fetching CrUX data for:', origin);

        // Try desktop first, fall back to all form factors
        let response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: origin, formFactor: 'DESKTOP' })
        });
        let data = await response.json();

        if (!response.ok || !data.record) {
          response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: origin })
          });
          data = await response.json();
        }

        if (!response.ok || !data.record) {
          return { hasData: false };
        }

        const record  = data.record;
        const metrics = {};

        if (record.metrics?.largest_contentful_paint?.percentiles?.p75) {
          metrics.lcp_p75_ms = parseFloat(record.metrics.largest_contentful_paint.percentiles.p75);
        }
        if (record.metrics?.interaction_to_next_paint?.percentiles?.p75) {
          metrics.inp_p75_ms = parseFloat(record.metrics.interaction_to_next_paint.percentiles.p75);
        }
        if (record.metrics?.cumulative_layout_shift?.percentiles?.p75) {
          metrics.cls_p75 = parseFloat(record.metrics.cumulative_layout_shift.percentiles.p75);
        }

        return {
          hasData: true,
          ...metrics,
          formFactor: data.record.key?.formFactor || 'UNKNOWN'
        };
      } catch (error) {
        console.error('CrUX error:', error.message);
        return { hasData: false };
      }
    }

    // ── Lighthouse via PSI ───────────────────────────────────────────────────
    async function fetchLighthouseData(siteUrl) {
      if (!USE_LIGHTHOUSE) return { hasData: false, reason: 'disabled' };

      try {
        const psiUrl = `${PSI_API_URL}?url=${encodeURIComponent(siteUrl)}&strategy=desktop&category=performance&key=${PSI_API_KEY}`;

        console.log('🔬 Fetching Lighthouse data...');
        const response = await fetch(psiUrl, { signal: AbortSignal.timeout(25000) });

        if (!response.ok) return { hasData: false, reason: 'api_error' };

        const data = await response.json();
        if (!data.lighthouseResult) return { hasData: false, reason: 'no_lighthouse_data' };

        const lhr    = data.lighthouseResult;
        const audits = lhr.audits;

        const metrics = {
          hasData: true,
          lcp_ms: null, inp_ms: null, cls: null,
          tbt_ms: null, fcp_ms: null, si_ms: null,
          lighthouseScore: null
        };

        if (audits['largest-contentful-paint']?.numericValue)
          metrics.lcp_ms = Math.round(audits['largest-contentful-paint'].numericValue);
        if (audits['interaction-to-next-paint']?.numericValue)
          metrics.inp_ms = Math.round(audits['interaction-to-next-paint'].numericValue);
        if (audits['cumulative-layout-shift']?.numericValue !== undefined)
          metrics.cls = parseFloat(audits['cumulative-layout-shift'].numericValue.toFixed(3));
        if (audits['total-blocking-time']?.numericValue)
          metrics.tbt_ms = Math.round(audits['total-blocking-time'].numericValue);
        if (audits['first-contentful-paint']?.numericValue)
          metrics.fcp_ms = Math.round(audits['first-contentful-paint'].numericValue);
        if (audits['speed-index']?.numericValue)
          metrics.si_ms = Math.round(audits['speed-index'].numericValue);
        if (lhr.categories?.performance?.score !== undefined)
          metrics.lighthouseScore = Math.round(lhr.categories.performance.score * 100);

        // Opportunities (actionable recommendations)
        const opportunityAudits = [
          'unused-css-rules', 'unused-javascript', 'modern-image-formats',
          'offscreen-images', 'render-blocking-resources', 'unminified-css',
          'unminified-javascript', 'efficient-animated-content', 'duplicated-javascript',
          'legacy-javascript', 'total-byte-weight', 'uses-optimized-images',
          'uses-text-compression', 'uses-responsive-images', 'server-response-time'
        ];

        const opportunities = [];
        for (const auditId of opportunityAudits) {
          const audit = audits[auditId];
          if (audit && audit.score !== null && audit.score < 1) {
            opportunities.push({
              id: auditId,
              title: audit.title,
              description: audit.description,
              score: audit.score,
              displayValue: audit.displayValue || '',
              numericValue: audit.numericValue,
              numericUnit: audit.numericUnit,
              details: audit.details?.items?.slice(0, 5) || []
            });
          }
        }

        opportunities.sort((a, b) => a.score - b.score);
        metrics.opportunities = opportunities.slice(0, 8);

        console.log('✅ Lighthouse: score', metrics.lighthouseScore, '|', metrics.opportunities.length, 'opportunities');
        return metrics;

      } catch (error) {
        console.error('Lighthouse error:', error.message);
        return { hasData: false, reason: 'fetch_error' };
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1: Attempt HTML fetch
    //   If the site blocks us (403/429/bot-wall), set isPartialScan = true
    //   and continue — we still score via CrUX + Lighthouse.
    //   Only genuinely dead sites (404, timeout, DNS fail) return an error.
    // ════════════════════════════════════════════════════════════════════════
    const normalizedUrl = url.includes('://') ? url : `https://${url}`;
    let targetUrl;
    try {
      targetUrl = new URL(normalizedUrl).href;
    } catch {
      return new Response(JSON.stringify({ error: 'INVALID_URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('🎯 Scanning:', targetUrl);

    const startTime = Date.now();
    let fetchResponse;
    let html            = '';
    let responseHeaders = new Headers();
    let isPartialScan   = false;
    let partialReason   = null;
    let rawLoadTime     = 0;
    let sizeMB          = 0;

    try {
      fetchResponse = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PythiaBot/1.0; +https://pythia-rating.com)' },
        signal: AbortSignal.timeout(15000)
      });

      rawLoadTime     = Date.now() - startTime;
      responseHeaders = fetchResponse.headers;

      if (!fetchResponse.ok) {
        if (fetchResponse.status === 403 || fetchResponse.status === 429) {
          // Bot-blocked — partial scan, don't bail out
          isPartialScan = true;
          partialReason = `Site returned HTTP ${fetchResponse.status} — HTML analysis unavailable. Scoring via Google Lighthouse & CrUX.`;
          console.log('⚠️  Partial scan:', partialReason);
        } else if (fetchResponse.status === 404) {
          return new Response(JSON.stringify({ error: 'SITE_NOT_FOUND' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ error: 'CONNECTION_FAILED' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
          });
        }
      } else {
        html   = await fetchResponse.text();
        sizeMB = new Blob([html]).size / (1024 * 1024);

        // Check for bot-wall in response body
        const botBlockPatterns = [
          /access denied/i,
          /you have been blocked/i,
          /captcha required/i,
          /bot detection/i,
          /automated access/i,
          /forbidden.*bot/i
        ];
        // Note: intentionally exclude generic /cloudflare/i — many legit sites
        // use Cloudflare and the HTML check was causing false positives.
        if (botBlockPatterns.some(p => p.test(html))) {
          isPartialScan = true;
          partialReason = 'Site returned a bot-protection page — HTML analysis unavailable. Scoring via Google Lighthouse & CrUX.';
          html   = '';
          sizeMB = 0;
          console.log('⚠️  Partial scan (bot wall in body)');
        }
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        return new Response(JSON.stringify({ error: 'TIMEOUT' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      // DNS failure or network error — genuine dead site
      return new Response(JSON.stringify({ error: 'CONNECTION_FAILED' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: HTML analysis (skipped if partial scan)
    // ════════════════════════════════════════════════════════════════════════
    const analysis = {
      hasHTTPS:          targetUrl.startsWith('https://'),
      hasCSP:            !!responseHeaders.get('content-security-policy'),
      hasXFrameOptions:  !!responseHeaders.get('x-frame-options'),
      hasHSTS:           !!responseHeaders.get('strict-transport-security'),
      hasPermissionsPolicy:     !!responseHeaders.get('permissions-policy'),
      hasReferrerPolicy:        !!responseHeaders.get('referrer-policy'),
      hasXContentTypeOptions:   !!responseHeaders.get('x-content-type-options'),
      // HTML-dependent (will be false/0 on partial scans):
      hasViewport:       /<meta[^>]+viewport/i.test(html),
      hasAltText:        /<img[^>]+alt=/i.test(html),
      hasAriaLabels:     /aria-label/i.test(html),
      hasWebP:           /<img[^>]+\.webp|<source[^>]+\.webp/i.test(html),
      hasAVIF:           /<img[^>]+\.avif|<source[^>]+\.avif/i.test(html),
      hasLazyLoading:    /loading=["']lazy["']/i.test(html),
      resourceCount:     (html.match(/<link|<script|<img/gi) || []).length
    };

    // Privacy signals (HTML-dependent)
    const cookieHeaders  = responseHeaders.get('set-cookie') || '';
    const cookieCount    = cookieHeaders ? cookieHeaders.split(',').length : 0;

    const trackerDefs = [
      { name: 'Google Analytics / GTM', pattern: /google-analytics\.com|googletagmanager\.com/i },
      { name: 'Facebook Pixel',         pattern: /facebook\.com\/tr|facebook\.net\/en_US\/fbevents/i },
      { name: 'DoubleClick',            pattern: /doubleclick\.net/i },
      { name: 'Hotjar',                 pattern: /hotjar\.com/i },
      { name: 'Mixpanel',               pattern: /mixpanel\.com/i },
      { name: 'Segment',                pattern: /segment\.com|segment\.io/i },
      { name: 'Amplitude',              pattern: /amplitude\.com/i },
      { name: 'FullStory',              pattern: /fullstory\.com/i }
    ];
    const detectedTrackers = isPartialScan ? [] : trackerDefs.filter(t => t.pattern.test(html));
    const trackerCount     = detectedTrackers.length;

    const domainMatches    = html.match(/https?:\/\/([^/\s"']+)/gi) || [];
    const uniqueDomains    = new Set(
      domainMatches.map(u => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean)
    );
    const siteDomain       = new URL(targetUrl).hostname;
    const thirdPartyDomains = Array.from(uniqueDomains).filter(d => !d.includes(siteDomain)).length;

    const hasPrivacyPolicy  = isPartialScan ? null : /privacy[- ]?policy/i.test(html);
    const hasCookieConsent  = isPartialScan ? null : /cookie[- ]?consent|accept[- ]?cookies|gdpr/i.test(html);

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: Score the five indices
    // ════════════════════════════════════════════════════════════════════════
    const result = { performance: 0, security: 0, privacy: 0, sustainability: 0, infrastructure: 0 };

    // ── INDEX 2: Security (20%) ──────────────────────────────────────────
    // Header checks work even on partial scans (we still got response headers
    // from the 403/bot-wall response before it blocked us)
    let securityScore = 0;
    if (analysis.hasHTTPS)              securityScore += 35;
    if (analysis.hasCSP)                securityScore += 22;
    if (analysis.hasXFrameOptions)      securityScore += 16;
    if (analysis.hasHSTS)               securityScore += 18;
    if (analysis.hasPermissionsPolicy)  securityScore += 9;
    // Bonus points for extra headers (from Colab script)
    if (analysis.hasReferrerPolicy)       securityScore += 5;
    if (analysis.hasXContentTypeOptions)  securityScore += 5;
    // Cap at 100 — max achievable is 110 with all headers, so this normalises it
    result.security = Math.round(clamp(securityScore) * 10) / 10;

    result.security_details = {
      https:               analysis.hasHTTPS,
      hsts:                analysis.hasHSTS,
      csp:                 analysis.hasCSP,
      xFrameOptions:       analysis.hasXFrameOptions,
      permissionsPolicy:   analysis.hasPermissionsPolicy,
      referrerPolicy:      analysis.hasReferrerPolicy,
      xContentTypeOptions: analysis.hasXContentTypeOptions
    };

    // ── INDEX 3: Privacy (20%) ───────────────────────────────────────────
    let privacyScore = 0;

    if (!isPartialScan) {
      // Cookie count (30 pts)
      if (cookieCount === 0)       privacyScore += 30;
      else if (cookieCount <= 5)   privacyScore += 20;
      else if (cookieCount <= 10)  privacyScore += 10;

      // Tracker detection (25 pts)
      if (trackerCount === 0)      privacyScore += 25;
      else if (trackerCount <= 2)  privacyScore += 15;
      else if (trackerCount <= 5)  privacyScore += 5;

      // Privacy policy (15 pts)
      if (hasPrivacyPolicy) privacyScore += 15;

      // GDPR / cookie consent (15 pts)
      if (hasCookieConsent) privacyScore += 15;

      // Third-party domains (10 pts)
      if (thirdPartyDomains < 5)        privacyScore += 10;
      else if (thirdPartyDomains <= 10) privacyScore += 5;

    } else {
      // On partial scans we can still check cookies from Set-Cookie header
      if (cookieCount === 0)       privacyScore += 30;
      else if (cookieCount <= 5)   privacyScore += 20;
      else if (cookieCount <= 10)  privacyScore += 10;
      // Remaining 70 pts unknown — assign neutral 35 so score isn't misleadingly low
      privacyScore += 35;
    }

    result.privacy = Math.round(privacyScore * 10) / 10;

    result.privacy_details = {
      cookieCount,
      trackerCount,
      trackerNames:       detectedTrackers.map(t => t.name),
      thirdPartyDomains,
      hasPrivacyPolicy,
      hasCookieConsent,
      isPartial:          isPartialScan
    };

    // ── INDEX 4: Sustainability (15%) ────────────────────────────────────
    let sustainabilityScore = 0;

    if (!isPartialScan) {
      // Page weight (38 pts)
      sustainabilityScore += smoothScore(sizeMB, [
        [0, 38], [0.5, 36], [1, 33], [1.5, 30], [2, 27], [2.4, 24], [3, 20],
        [4, 14], [5, 9], [7, 5], [10, 2], [20, 1], [50, 0]
      ]);

      // Image optimisation (19 pts)
      if (analysis.hasAVIF)        sustainabilityScore += 19;
      else if (analysis.hasWebP)   sustainabilityScore += 14;

      // Lazy loading (9 pts)
      if (analysis.hasLazyLoading) sustainabilityScore += 9;

      // Resource efficiency (14 pts)
      sustainabilityScore += smoothScore(analysis.resourceCount, [
        [0, 14], [20, 13], [40, 11], [60, 9], [80, 7], [100, 5], [150, 2], [200, 0]
      ]);
    } else {
      // No page weight data — assign mid-range neutral
      sustainabilityScore += 25;
    }

    // Green hosting: CDN headers — available even on partial scans
    if (responseHeaders.get('cf-ray'))                                        sustainabilityScore += 24;
    else if (responseHeaders.get('x-amz-cf-id') || responseHeaders.get('x-cache')) sustainabilityScore += 14;

    // Caching (6 pts)
    if (responseHeaders.get('cache-control')) sustainabilityScore += 6;

    result.sustainability = Math.round(clamp(sustainabilityScore) * 10) / 10;

    // CO2 estimate
    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442;
    const co2PerView = (sizeMB / 1024) * 0.81 * carbonIntensity;
    result.sustainability_details = {
      co2PerView:    Math.round(co2PerView * 1000) / 1000,
      isGreenHosted: !!responseHeaders.get('cf-ray'),
      pageSizeMB:    Math.round(sizeMB * 100) / 100
    };

    // ── INDEX 5: Infrastructure (5%) ─────────────────────────────────────
    let infrastructureScore = 0;

    const hasCDN = responseHeaders.get('cf-ray') || responseHeaders.get('x-amz-cf-id') || responseHeaders.get('x-cache');
    if (hasCDN) infrastructureScore += 48;

    const cacheControl = responseHeaders.get('cache-control') || '';
    if (cacheControl) {
      const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1] || '0');
      if (maxAge > 86400)     infrastructureScore += 28;
      else if (maxAge > 3600) infrastructureScore += 18;
      else if (maxAge > 0)    infrastructureScore += 8;

      if (cacheControl.includes('public'))    infrastructureScore += 12;
      if (cacheControl.includes('immutable')) infrastructureScore += 12;
    }

    result.infrastructure = Math.round(clamp(infrastructureScore) * 10) / 10;

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4+5: CrUX and Lighthouse — run IN PARALLEL with Promise.all
    //   Both call Google's infrastructure, not the target site.
    //   Sequential calls meant Lighthouse (20-30s) ate the Worker's entire
    //   time budget before CrUX ran. Parallel cuts wall-clock in half.
    // ════════════════════════════════════════════════════════════════════════
    const [cruxData, lighthouseData] = await Promise.all([
      IS_PAID_USER
        ? fetchCruxData(targetUrl).catch(err => {
            console.error('CrUX error (non-fatal):', err);
            return { hasData: false };
          })
        : Promise.resolve({ hasData: false }),

      USE_LIGHTHOUSE
        ? fetchLighthouseData(targetUrl).catch(err => {
            console.error('Lighthouse error (non-fatal):', err);
            return { hasData: false };
          })
        : Promise.resolve({ hasData: false })
    ]);

    result.crux = cruxData;
    result.lighthouse = lighthouseData;

    // ── INDEX 1: Performance (40%) — from Lighthouse, else CrUX, else load time
    if (lighthouseData.hasData && lighthouseData.lighthouseScore !== null) {
      result.performance = lighthouseData.lighthouseScore;
      console.log('✅ Performance from Lighthouse:', result.performance);
    } else if (cruxData.hasData && cruxData.lcp_p75_ms) {
      // Estimate performance score from real-user LCP
      result.performance = Math.round(smoothScore(cruxData.lcp_p75_ms / 1000, [
        [0, 100], [1, 95], [2.5, 75], [4, 50], [6, 25], [10, 10]
      ]));
      console.log('✅ Performance estimated from CrUX LCP:', result.performance);
    } else {
      // Last resort: raw load time
      const loadSec = rawLoadTime / 1000;
      result.performance = Math.round(smoothScore(loadSec, [
        [0, 100], [0.5, 95], [1, 90], [1.5, 85], [2, 80], [3, 70],
        [4, 60], [5, 50], [7, 40], [10, 20], [15, 0]
      ]));
      console.log('⚠️  Performance from raw load time:', result.performance);
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 6: P-Score & Rating
    // ════════════════════════════════════════════════════════════════════════
    const pscore =
      result.performance    * 0.40 +
      result.security       * 0.20 +
      result.privacy        * 0.20 +
      result.sustainability * 0.15 +
      result.infrastructure * 0.05;

    result.pscore = Math.round(pscore * 10) / 10;

    if      (result.pscore >= 95) result.rating = 'AAA';
    else if (result.pscore >= 90) result.rating = 'AA';
    else if (result.pscore >= 85) result.rating = 'A';
    else if (result.pscore >= 80) result.rating = 'BBB';
    else if (result.pscore >= 75) result.rating = 'BB';
    else if (result.pscore >= 70) result.rating = 'B';
    else if (result.pscore >= 65) result.rating = 'CCC';
    else if (result.pscore >= 60) result.rating = 'CC';
    else                           result.rating = 'C';

    // ════════════════════════════════════════════════════════════════════════
    // Metadata
    // ════════════════════════════════════════════════════════════════════════
    result._meta = {
      version:             '3.1',
      scannedAt:           new Date().toISOString(),
      isPartialScan,
      partialScanReason:   partialReason,
      usedLighthouse:      lighthouseData.hasData,
      usedRealUserData:    cruxData.hasData,
      dataSource:          cruxData.hasData
                             ? 'crux'
                             : lighthouseData.hasData
                               ? 'lighthouse'
                               : 'lab',
      coverage:            lighthouseData.hasData ? '100%' : cruxData.hasData ? '80%' : '60%',
      loadTimeMs:          rawLoadTime,
      pageSizeMB:          Math.round(sizeMB * 100) / 100,
      resourceCount:       analysis.resourceCount,
      isPaidContentBlocked: !IS_PAID_USER,
      weightings:          { performance: 0.40, security: 0.20, privacy: 0.20, sustainability: 0.15, infrastructure: 0.05 }
    };

    console.log('✅ Scan complete:', {
      pscore: result.pscore,
      rating: result.rating,
      partial: isPartialScan,
      dataSource: result._meta.dataSource
    });

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
