// ============================================================================
// PYTHIA RATING ENGINE V3.0 - STRATEGIC PIVOT
// ============================================================================
// New Formula: Lighthouse (40%) + Security (20%) + Privacy (20%) + 
//              Sustainability (15%) + Infrastructure (5%)

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { url } = await request.json();
    
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API Keys
    const CRUX_API_KEY = 'AIzaSyD3vkIWqvctKx1BRu2CEEOF7goYTyAx5Bs';
    const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    const PSI_API_KEY = 'AIzaSyBYVTe6sRJGyB9vtI0cnvBxRFQ4ruNPf8M';
    const PSI_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const IS_PAID_USER = false; // <-- NEW: Set to 'false' for free tier. Integrate with your auth.
    const USE_LIGHTHOUSE = IS_PAID_USER; // Use the paid flag to control Lighthouse
    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================
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

    // ========================================================================
    // CRUX DATA FETCH
    // ========================================================================
    async function fetchCruxData(siteUrl) {
      try {
        const urlObj = new URL(siteUrl);
        const origin = `${urlObj.protocol}//${urlObj.hostname}`;
        
        console.log('🔍 Fetching CrUX data for:', origin);
        
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
        
        const record = data.record;
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

    // ========================================================================
    // LIGHTHOUSE DATA FETCH
    // ========================================================================
    async function fetchLighthouseData(siteUrl) {
      if (!USE_LIGHTHOUSE) {
        return { hasData: false, reason: 'disabled' };
      }

      try {
        const psiUrl = `${PSI_API_URL}?url=${encodeURIComponent(siteUrl)}&strategy=desktop&category=performance&key=${PSI_API_KEY}`;
        
        console.log('🔍 Fetching Lighthouse data...');
        
        const response = await fetch(psiUrl, {
          signal: AbortSignal.timeout(30000)
        });
        
        if (!response.ok) {
          return { hasData: false, reason: 'api_error' };
        }
        
        const data = await response.json();
        
        if (!data.lighthouseResult) {
          return { hasData: false, reason: 'no_lighthouse_data' };
        }
        
        const lhr = data.lighthouseResult;
        const audits = lhr.audits;
        
        const metrics = {
          hasData: true,
          lcp_ms: null,
          inp_ms: null,
          cls: null,
          tbt_ms: null,
          fcp_ms: null,
          si_ms: null,
          lighthouseScore: null
        };
        
        if (audits['largest-contentful-paint']?.numericValue) {
          metrics.lcp_ms = Math.round(audits['largest-contentful-paint'].numericValue);
        }
        
        if (audits['interaction-to-next-paint']?.numericValue) {
          metrics.inp_ms = Math.round(audits['interaction-to-next-paint'].numericValue);
        }
        
        if (audits['cumulative-layout-shift']?.numericValue !== undefined) {
          metrics.cls = parseFloat(audits['cumulative-layout-shift'].numericValue.toFixed(3));
        }
        
        if (audits['total-blocking-time']?.numericValue) {
          metrics.tbt_ms = Math.round(audits['total-blocking-time'].numericValue);
        }
        
        if (audits['first-contentful-paint']?.numericValue) {
          metrics.fcp_ms = Math.round(audits['first-contentful-paint'].numericValue);
        }
        
        if (audits['speed-index']?.numericValue) {
          metrics.si_ms = Math.round(audits['speed-index'].numericValue);
        }
        
        if (lhr.categories?.performance?.score !== undefined) {
          metrics.lighthouseScore = Math.round(lhr.categories.performance.score * 100);
        }
        
        // Extract Lighthouse opportunities (recommendations)
        const opportunities = [];
        const opportunityAudits = [
          'unused-css-rules',
          'unused-javascript',
          'modern-image-formats',
          'offscreen-images',
          'render-blocking-resources',
          'unminified-css',
          'unminified-javascript',
          'efficient-animated-content',
          'duplicated-javascript',
          'legacy-javascript',
          'total-byte-weight',
          'uses-optimized-images',
          'uses-text-compression',
          'uses-responsive-images',
          'server-response-time'
        ];
        
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
        
        // Sort by impact (lower score = higher priority)
        opportunities.sort((a, b) => a.score - b.score);
        metrics.opportunities = opportunities.slice(0, 8); // Top 8 opportunities
        
        console.log('✅ Lighthouse data received with', metrics.opportunities.length, 'opportunities');
        return metrics;
        
      } catch (error) {
        console.error('Lighthouse error:', error.message);
        return { hasData: false, reason: 'fetch_error' };
      }
    }

    // ========================================================================
    // PHASE 1: HTML Analysis
    // ========================================================================
    const normalizedUrl = url.includes('://') ? url : `https://${url}`;
    let targetUrl;
    try {
      const urlObj = new URL(normalizedUrl);
      targetUrl = urlObj.href;
    } catch (error) {
      return new Response(JSON.stringify({ error: 'INVALID_URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('🎯 Scanning:', targetUrl);
    
    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PythiaBot/1.0; +https://pythia.dev)'
      },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!response.ok) {
      return new Response(JSON.stringify({ 
        error: response.status === 404 ? 'SITE_NOT_FOUND' : 'CONNECTION_FAILED' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const rawLoadTime = Date.now() - startTime;
    const html = await response.text();
    const responseHeaders = response.headers;

    // Calculate page size
    const sizeMB = new Blob([html]).size / (1024 * 1024);

    // Basic HTML analysis
    const analysis = {
      hasHTTPS: targetUrl.startsWith('https://'),
      hasCSP: !!responseHeaders.get('content-security-policy'),
      hasXFrameOptions: !!responseHeaders.get('x-frame-options'),
      hasHSTS: !!responseHeaders.get('strict-transport-security'),
      hasPermissionsPolicy: !!responseHeaders.get('permissions-policy'),
      hasViewport: /<meta[^>]+viewport/i.test(html),
      hasAltText: /<img[^>]+alt=/i.test(html),
      hasAriaLabels: /aria-label/i.test(html),
      hasWebP: /<img[^>]+\.webp|<source[^>]+\.webp/i.test(html),
      hasAVIF: /<img[^>]+\.avif|<source[^>]+\.avif/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      resourceCount: (html.match(/<link|<script|<img/gi) || []).length
    };

    // Extract cookies from headers
    const cookieHeaders = responseHeaders.get('set-cookie') || '';
    const cookieCount = cookieHeaders ? cookieHeaders.split(',').length : 0;

    // Detect trackers in HTML
    const trackerPatterns = [
      /google-analytics\.com|googletagmanager\.com/i,
      /facebook\.com\/tr|facebook\.net\/en_US\/fbevents/i,
      /doubleclick\.net/i,
      /hotjar\.com/i,
      /mixpanel\.com/i,
      /segment\.com|segment\.io/i,
      /amplitude\.com/i,
      /fullstory\.com/i
    ];
    const trackerCount = trackerPatterns.filter(pattern => pattern.test(html)).length;

    // Count third-party domains
    const domainMatches = html.match(/https?:\/\/([^\/\s"']+)/gi) || [];
    const uniqueDomains = new Set(
      domainMatches.map(url => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      }).filter(Boolean)
    );
    const siteDomain = new URL(targetUrl).hostname;
    const thirdPartyDomains = Array.from(uniqueDomains).filter(d => !d.includes(siteDomain)).length;

    // Detect privacy policy
    const hasPrivacyPolicy = /privacy[- ]?policy/i.test(html);

    // Detect cookie consent mechanism
    const hasCookieConsent = /cookie[- ]?consent|accept[- ]?cookies|gdpr/i.test(html);

    // Initialize result object
    const result = {
      performance: 0,
      security: 0,
      privacy: 0,
      sustainability: 0,
      infrastructure: 0
    };

    // ========================================================================
    // INDEX 1: PERFORMANCE (40%) - FROM LIGHTHOUSE
    // ========================================================================
    // This will be populated from Lighthouse data
    result.performance = 0; // Placeholder, updated below

    // ========================================================================
    // INDEX 2: SECURITY (20%)
    // ========================================================================
    let securityScore = 0;
    if (analysis.hasHTTPS) securityScore += 35;
    if (analysis.hasCSP) securityScore += 22;
    if (analysis.hasXFrameOptions) securityScore += 16;
    if (analysis.hasHSTS) securityScore += 18;
    if (analysis.hasPermissionsPolicy) securityScore += 9;
    result.security = Math.round(securityScore * 10) / 10;

    // ========================================================================
    // INDEX 3: PRIVACY & TRACKING (20%)
    // ========================================================================
    let privacyScore = 0;

    // Cookie count (30 points max)
    if (cookieCount === 0) privacyScore += 30;
    else if (cookieCount <= 5) privacyScore += 20;
    else if (cookieCount <= 10) privacyScore += 10;
    else privacyScore += 0;

    // Tracker detection (25 points max)
    if (trackerCount === 0) privacyScore += 25;
    else if (trackerCount <= 2) privacyScore += 15;
    else if (trackerCount <= 5) privacyScore += 5;
    else privacyScore += 0;

    // Privacy policy presence (15 points)
    if (hasPrivacyPolicy) privacyScore += 15;

    // GDPR compliance signals (20 points)
    if (hasCookieConsent) privacyScore += 15;
    // Additional 5 points for opt-out mechanism would require deeper analysis

    // Third-party domain count (10 points)
    if (thirdPartyDomains < 5) privacyScore += 10;
    else if (thirdPartyDomains <= 10) privacyScore += 5;
    else privacyScore += 0;

    result.privacy = Math.round(privacyScore * 10) / 10;

    // ========================================================================
    // INDEX 4: SUSTAINABILITY (15%)
    // ========================================================================
    let sustainabilityScore = 0;

    // Page weight efficiency (38 points)
    const weightScore = smoothScore(sizeMB, [
      [0, 38], [0.5, 36], [1, 33], [1.5, 30], [2, 27], [2.4, 24], [3, 20],
      [4, 14], [5, 9], [7, 5], [10, 2], [20, 1], [50, 0]
    ]);
    sustainabilityScore += weightScore;

    // Green hosting (24 points)
    if (responseHeaders.get('cf-ray')) sustainabilityScore += 24;
    else if (responseHeaders.get('x-amz-cf-id') || responseHeaders.get('x-cache')) sustainabilityScore += 14;

    // Caching strategy (6 points)
    if (responseHeaders.get('cache-control')) sustainabilityScore += 6;

    // Image format optimization (19 points)
    if (analysis.hasAVIF) sustainabilityScore += 19;
    else if (analysis.hasWebP) sustainabilityScore += 14;

    // Lazy loading (9 points)
    if (analysis.hasLazyLoading) sustainabilityScore += 9;

    // Resource efficiency (14 points)
    const resourceEfficiency = smoothScore(analysis.resourceCount, [
      [0, 14], [20, 13], [40, 11], [60, 9], [80, 7], [100, 5], [150, 2], [200, 0]
    ]);
    sustainabilityScore += resourceEfficiency;

    result.sustainability = Math.round(clamp(sustainabilityScore) * 10) / 10;

    // Calculate CO2
    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442;
    const co2PerView = (sizeMB / 1024) * 0.81 * carbonIntensity;
    result.sustainability_details = {
      score: result.sustainability,
      co2PerView: Math.round(co2PerView * 1000) / 1000,
      isGreenHosted: !!responseHeaders.get('cf-ray')
    };

    // ========================================================================
    // INDEX 5: INFRASTRUCTURE (5%)
    // ========================================================================
    let infrastructureScore = 0;

    // CDN usage (48 points)
    const hasCDN = responseHeaders.get('cf-ray') || responseHeaders.get('x-amz-cf-id') || responseHeaders.get('x-cache');
    if (hasCDN) infrastructureScore += 48;

    // Cache-Control headers (40 points)
    const cacheControl = responseHeaders.get('cache-control');
    if (cacheControl) {
      if (cacheControl.includes('max-age')) {
        const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1] || '0');
        if (maxAge > 86400) infrastructureScore += 28;
        else if (maxAge > 3600) infrastructureScore += 18;
        else if (maxAge > 0) infrastructureScore += 8;
      }
      if (cacheControl.includes('public')) infrastructureScore += 12;
      if (cacheControl.includes('immutable')) infrastructureScore += 12;
    }

    result.infrastructure = Math.round(infrastructureScore * 10) / 10;

    // ========================================================================
    // PHASE 2: Fetch CrUX data
    // ========================================================================
    console.log('📊 Fetching CrUX data...');
    let cruxData = { hasData: false };
    
    // START GATING BLOCK
    if (IS_PAID_USER) {
        try {
            cruxData = await fetchCruxData(targetUrl);
        } catch (error) {
            console.error('CrUX error (non-fatal):', error);
        }
    } else {
        console.log('🔒 CrUX data skipped (Paid feature).');
    }

    result.crux = cruxData; // <-- ADD THIS LINE RIGHT HERE (after line 253)

    // END GATING BLOCK

    // START GATING BLOCK
if (IS_PAID_USER) {
    try {
        cruxData = await fetchCruxData(targetUrl);
    } catch (error) {
        console.error('CrUX error (non-fatal):', error);
    }
} else {
    console.log('🔒 CrUX data skipped (Paid feature).');
}
result.crux = cruxData; // <-- ADD THIS LINE HERE
// END GATING BLOCK
    
    // ========================================================================
    // PHASE 3: Fetch Lighthouse data
    // ========================================================================
    console.log('🔬 Fetching Lighthouse data...');
    let lighthouseData = { hasData: false };
    
    if (USE_LIGHTHOUSE) {
      try {
        lighthouseData = await fetchLighthouseData(targetUrl);
      } catch (error) {
        console.error('Lighthouse error (non-fatal):', error);
      }
    }
    result.lighthouse = lighthouseData;

    // ========================================================================
    // UPDATE PERFORMANCE SCORE FROM LIGHTHOUSE
    // ========================================================================
    if (lighthouseData.hasData && lighthouseData.lighthouseScore !== null) {
      result.performance = lighthouseData.lighthouseScore;
      console.log('✅ Using Lighthouse Performance Score:', result.performance);
    } else {
      // Fallback: estimate from load time if no Lighthouse data
      console.log('⚠️ No Lighthouse data - using fallback performance estimate');
      const loadTimeSeconds = rawLoadTime / 1000;
      result.performance = Math.round(smoothScore(loadTimeSeconds, [
        [0, 100], [0.5, 95], [1, 90], [1.5, 85], [2, 80], [3, 70], 
        [4, 60], [5, 50], [7, 40], [10, 20], [15, 0]
      ]));
    }

    // ========================================================================
    // CALCULATE P-SCORE WITH NEW WEIGHTS
    // ========================================================================
    const pscore = 
      result.performance * 0.40 +
      result.security * 0.20 +
      result.privacy * 0.20 +
      result.sustainability * 0.15 +
      result.infrastructure * 0.05;
    
    result.pscore = Math.round(pscore * 10) / 10;

    // Assign rating
    if (result.pscore >= 95) result.rating = 'AAA';
    else if (result.pscore >= 90) result.rating = 'AA';
    else if (result.pscore >= 85) result.rating = 'A';
    else if (result.pscore >= 80) result.rating = 'BBB';
    else if (result.pscore >= 75) result.rating = 'BB';
    else if (result.pscore >= 70) result.rating = 'B';
    else if (result.pscore >= 65) result.rating = 'CCC';
    else if (result.pscore >= 60) result.rating = 'CC';
    else result.rating = 'C';

    // ========================================================================
    // METADATA
    // ========================================================================
    result._meta = {
      usedRealUserData: cruxData.hasData,
      isPaidContentBlocked: !IS_PAID_USER, // <-- NEW FLAG: True if user is NOT paid
      usedLighthouse: lighthouseData.hasData,
      scannedAt: new Date().toISOString(),
      version: '3.0-pivot',
      loadTimeMs: rawLoadTime,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      dataSource: cruxData.hasData ? 'crux' : (lighthouseData.hasData ? 'lighthouse' : 'lab'),
      usedRealUserData: cruxData.hasData,
      usedLighthouse: lighthouseData.hasData,
      coverage: lighthouseData.hasData ? '100%' : (cruxData.hasData ? '80%' : '60%'),
      weightings: {
        performance: 0.40,
        security: 0.20,
        privacy: 0.20,
        sustainability: 0.15,
        infrastructure: 0.05
      },
      privacyMetrics: {
        cookieCount: cookieCount,
        trackerCount: trackerCount,
        thirdPartyDomains: thirdPartyDomains,
        hasPrivacyPolicy: hasPrivacyPolicy,
        hasCookieConsent: hasCookieConsent
      }
    };

    console.log('✅ Scan complete:', {
      pscore: result.pscore,
      rating: result.rating,
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
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
