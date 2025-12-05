// ============================================================================
// PYTHIA RATING ENGINE V2.0 - PHASE 3: LIGHTHOUSE VIA PAGESPEED INSIGHTS
// ============================================================================
// Uses FREE PageSpeed Insights API to get Lighthouse data for 100% coverage
// No API key required! (or use free key with generous limits)

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

    const CRUX_API_KEY = 'AIzaSyD3vkIWqvctKx1BRu2CEEOF7goYTyAx5Bs';
    const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    
    // PageSpeed Insights API
const PSI_API_KEY = 'AIzaSyBYVTe6sRJGyB9vtI0cnvBxRFQ4ruNPf8M';  // ADD THIS LINE - paste your PSI key
const PSI_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const USE_LIGHTHOUSE = true;

    // ========================================================================
    // FETCH CRUX DATA
    // ========================================================================
    async function fetchCruxData(siteUrl) {
      try {
        const urlObj = new URL(siteUrl);
        const origin = `${urlObj.protocol}//${urlObj.hostname}`;
        
        console.log('Fetching CrUX data for:', origin);
        
        let response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: origin, formFactor: 'DESKTOP' })
        });
        
        let data = await response.json();
        console.log('CrUX DESKTOP response:', response.status, data);
        
        if (!response.ok || !data.record) {
          console.log('Trying CrUX with ALL form factors...');
          response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: origin, formFactor: 'ALL' })
          });
          data = await response.json();
          console.log('CrUX ALL response:', response.status, data);
        }
        
        if (!response.ok || !data.record) {
          console.log('No CrUX data available');
          return { hasData: false };
        }
        
        const record = data.record;
        const metrics = {};
        
        if (record.metrics?.largest_contentful_paint) {
          const p75 = record.metrics.largest_contentful_paint.percentiles?.p75;
          if (p75) metrics.lcp_p75_ms = parseFloat(p75);
        }
        
        if (record.metrics?.interaction_to_next_paint) {
          const p75 = record.metrics.interaction_to_next_paint.percentiles?.p75;
          if (p75) metrics.inp_p75_ms = parseFloat(p75);
        }
        
        if (record.metrics?.cumulative_layout_shift) {
          const p75 = record.metrics.cumulative_layout_shift.percentiles?.p75;
          if (p75) metrics.cls_p75 = parseFloat(p75);
        }
        
        console.log('CrUX metrics extracted:', metrics);
        
        return {
          hasData: true,
          ...metrics,
          formFactor: data.record.key?.formFactor || 'UNKNOWN'
        };
        
      } catch (error) {
        console.error('CrUX error:', error);
        return { hasData: false };
      }
    }

    // ========================================================================
    // FETCH LIGHTHOUSE DATA VIA PAGESPEED INSIGHTS (NEW - FREE!)
    // ========================================================================
    async function fetchLighthouseData(siteUrl) {
      if (!USE_LIGHTHOUSE) {
        return { hasData: false, reason: 'disabled' };
      }

      try {
        // 🔥 FIX: Include the API key in the URL
        const psiUrl = `${PSI_API_URL}?url=${encodeURIComponent(siteUrl)}&strategy=desktop&category=PERFORMANCE&key=${PSI_API_KEY}`;
        
        console.log('Fetching Lighthouse data via PSI...');
        
        const response = await fetch(psiUrl, {
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        
        console.log('PSI response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log('PSI API error:', response.status, errorText);
          return { hasData: false, reason: 'api_error', status: response.status };
        }
        
        const data = await response.json();
        
        if (!data.lighthouseResult) {
          console.log('No lighthouse result in PSI response');
          return { hasData: false, reason: 'no_lighthouse_data' };
        }
        
        console.log('Lighthouse data received successfully');
        
        const lhr = data.lighthouseResult;
        const audits = lhr.audits;
        
        // Extract metrics
        const metrics = {
          hasData: true,
          lcp_ms: null,
          inp_ms: null,
          cls: null,
          tbt_ms: null,
          tti_ms: null,
          fcp_ms: null,
          si_ms: null,
          lighthouseScore: null
        };
        
        // Largest Contentful Paint
        if (audits['largest-contentful-paint']?.numericValue) {
          metrics.lcp_ms = Math.round(audits['largest-contentful-paint'].numericValue);
        }
        
        // Interaction to Next Paint (may not always be available in lab)
        if (audits['interaction-to-next-paint']?.numericValue) {
          metrics.inp_ms = Math.round(audits['interaction-to-next-paint'].numericValue);
        }
        
        // Cumulative Layout Shift
        if (audits['cumulative-layout-shift']?.numericValue !== undefined) {
          metrics.cls = parseFloat(audits['cumulative-layout-shift'].numericValue.toFixed(3));
        }
        
        // Total Blocking Time
        if (audits['total-blocking-time']?.numericValue) {
          metrics.tbt_ms = Math.round(audits['total-blocking-time'].numericValue);
        }
        
        // Time to Interactive
        if (audits['interactive']?.numericValue) {
          metrics.tti_ms = Math.round(audits['interactive'].numericValue);
        }
        
        // First Contentful Paint
        if (audits['first-contentful-paint']?.numericValue) {
          metrics.fcp_ms = Math.round(audits['first-contentful-paint'].numericValue);
        }
        
        // Speed Index
        if (audits['speed-index']?.numericValue) {
          metrics.si_ms = Math.round(audits['speed-index'].numericValue);
        }
        
        // Lighthouse Performance Score
        if (lhr.categories?.performance?.score !== undefined) {
          metrics.lighthouseScore = Math.round(lhr.categories.performance.score * 100);
        }
        
        console.log('Lighthouse metrics extracted:', metrics);
        
        return metrics;
        
      } catch (error) {
        console.error('PageSpeed Insights error:', error);
        return { hasData: false, reason: 'error', error: error.message };
      }
    }

    const BENCHMARK_DATA = {
      'AAA': { pscore: 95.0, speed: 98.0, mobile: 95.0, seo: 95.0, responsiveness: 98.0, accessibility: 95.0, privacy: 95.0, delivery: 95.0, sustainability: 90.0 },
      'AA': { pscore: 90.0, speed: 94.0, mobile: 90.0, seo: 90.0, responsiveness: 94.0, accessibility: 90.0, privacy: 90.0, delivery: 90.0, sustainability: 85.0 },
      'A': { pscore: 85.0, speed: 88.0, mobile: 85.0, seo: 85.0, responsiveness: 88.0, accessibility: 85.0, privacy: 85.0, delivery: 85.0, sustainability: 75.0 },
      'BBB': { pscore: 80.0, speed: 82.0, mobile: 78.0, seo: 80.0, responsiveness: 82.0, accessibility: 75.0, privacy: 75.0, delivery: 75.0, sustainability: 65.0 },
      'BB': { pscore: 75.0, speed: 75.0, mobile: 70.0, seo: 72.0, responsiveness: 75.0, accessibility: 68.0, privacy: 65.0, delivery: 65.0, sustainability: 55.0 },
      'B': { pscore: 70.0, speed: 68.0, mobile: 62.0, seo: 65.0, responsiveness: 68.0, accessibility: 60.0, privacy: 55.0, delivery: 55.0, sustainability: 45.0 },
      'CCC': { pscore: 65.0, speed: 58.0, mobile: 50.0, seo: 55.0, responsiveness: 58.0, accessibility: 50.0, privacy: 45.0, delivery: 45.0, sustainability: 35.0 },
      'CC': { pscore: 60.0, speed: 45.0, mobile: 38.0, seo: 45.0, responsiveness: 45.0, accessibility: 40.0, privacy: 35.0, delivery: 35.0, sustainability: 25.0 },
      'C': { pscore: 0.0, speed: 30.0, mobile: 25.0, seo: 30.0, responsiveness: 30.0, accessibility: 30.0, privacy: 25.0, delivery: 25.0, sustainability: 15.0 }
    };

    const SECTOR_RULES = {
      'Technology & Software': { keywords: ['facebook', 'instagram', 'twitter', 'linkedin', 'github', 'google', 'microsoft', 'apple', 'amazon', 'software', 'saas'], tldPatterns: ['.io', '.dev', '.app'] },
      'E-commerce & Retail': { keywords: ['shop', 'store', 'buy', 'cart', 'checkout', 'retail', 'ecommerce'], tldPatterns: ['.shop', '.store'] },
      'Finance & Banking': { keywords: ['bank', 'finance', 'invest', 'trading', 'insurance', 'loan', 'credit'], tldPatterns: ['.bank', '.financial'] },
      'Healthcare': { keywords: ['health', 'medical', 'hospital', 'clinic', 'pharma', 'doctor'], tldPatterns: ['.health', '.clinic'] },
      'Education': { keywords: ['university', 'college', 'school', 'education', 'learn', 'academy'], tldPatterns: ['.edu', '.ac'] },
      'Media & Entertainment': { keywords: ['news', 'media', 'blog', 'magazine', 'entertainment', 'streaming'], tldPatterns: ['.news', '.media'] },
      'Travel & Hospitality': { keywords: ['hotel', 'travel', 'booking', 'flight', 'tourism', 'resort'], tldPatterns: ['.travel', '.hotel'] },
      'Professional Services': { keywords: ['consulting', 'legal', 'law', 'accounting', 'agency'], tldPatterns: ['.law', '.consulting'] },
      'Other': { keywords: [], tldPatterns: [] }
    };

    function detectSector(url) {
      const urlLower = url.toLowerCase();
      for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
        if (rules.tldPatterns.some(tld => urlLower.includes(tld))) return sector;
        if (rules.keywords.some(kw => urlLower.includes(kw))) return sector;
      }
      return 'Other';
    }

    function clamp(val, min = 0, max = 100) {
      return Math.max(min, Math.min(max, val));
    }

    function smoothScore(x, points) {
      if (!Array.isArray(points) || points.length < 2) return 0;
      points.sort((a, b) => a[0] - b[0]);
      if (x <= points[0][0]) return clamp(points[0][1]);
      if (x >= points[points.length - 1][0]) return clamp(points[points.length - 1][1]);
      for (let i = 0; i < points.length - 1; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[i + 1];
        if (x >= x1 && x <= x2) {
          const ratio = (x - x1) / (x2 - x1);
          const interpolated = y1 + ratio * (y2 - y1);
          return clamp(interpolated);
        }
      }
      return clamp(0);
    }

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    const result = {
      url: targetUrl,
      pscore: 0,
      rating: 'C',
      speed: 0,
      mobile: 0,
      seo: 0,
      responsiveness: 0,
      accessibility: 0,
      privacy: 0,
      delivery: 0,
      sustainability: 0
    };

    const sector = detectSector(targetUrl);

    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Pythia-Scanner/2.0' },
      signal: AbortSignal.timeout(10000)
    });
    const rawLoadTime = Date.now() - startTime;
    const loadTime = Math.max(0, rawLoadTime - 50);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const responseHeaders = response.headers;

    const sizeMB = new Blob([html]).size / (1024 * 1024);

    const analysis = {
      hasViewport: /<meta[^>]*name=["']viewport["'][^>]*>/i.test(html),
      hasTitle: /<title/i.test(html),
      hasDescription: /<meta[^>]*name=["']description["'][^>]*>/i.test(html),
      hasOG: /<meta[^>]*property=["']og:/i.test(html),
      hasStructuredData: /<script[^>]*type=["']application\/ld\+json["'][^>]*>/i.test(html),
      hasHTTPS: targetUrl.startsWith('https'),
      hasCSP: !!responseHeaders.get('content-security-policy'),
      hasXFrameOptions: !!responseHeaders.get('x-frame-options'),
      hasHSTS: !!responseHeaders.get('strict-transport-security'),
      hasPermissionsPolicy: !!responseHeaders.get('permissions-policy'),
      hasAltText: (html.match(/<img[^>]*alt=/gi) || []).length > 0,
      hasAriaLabels: /aria-label/i.test(html),
      hasWebP: /\.webp/i.test(html),
      hasAVIF: /\.avif/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      resourceCount: (html.match(/<(?:img|script|link|video|audio|iframe)/gi) || []).length
    };

    const speedScore = smoothScore(loadTime, [[0, 100], [50, 98], [100, 96], [200, 93], [300, 90], [500, 85], [800, 78], [1000, 72], [1500, 62], [2000, 52], [3000, 38], [5000, 18], [10000, 0]]);
    result.speed = Math.round(speedScore * 10) / 10;

    let mobileScore = 0;
    if (analysis.hasViewport) mobileScore += 35;
    const isMobileOptimized = html.match(/viewport.*width=device-width/i);
    if (isMobileOptimized) mobileScore += 30;
    if (analysis.hasLazyLoading) mobileScore += 18;
    if (sizeMB < 1.0) mobileScore += 17;
    else if (sizeMB < 2.0) mobileScore += 12;
    else if (sizeMB < 3.0) mobileScore += 8;
    else if (sizeMB < 5.0) mobileScore += 4;
    result.mobile = Math.round(mobileScore * 10) / 10;

    let seoScore = 0;
    if (analysis.hasTitle) seoScore += 22;
    if (analysis.hasDescription) seoScore += 24;
    if (analysis.hasOG) seoScore += 18;
    if (analysis.hasStructuredData) seoScore += 16;
    if (analysis.hasHTTPS) seoScore += 12;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const titleLength = titleMatch[1].length;
      if (titleLength >= 30 && titleLength <= 60) seoScore += 8;
      else if (titleLength >= 20 && titleLength <= 70) seoScore += 4;
    }
    result.seo = Math.round(seoScore * 10) / 10;

    const responsivenessScore = smoothScore(loadTime, [[0, 100], [50, 98], [100, 96], [200, 93], [300, 90], [500, 85], [800, 78], [1000, 72], [1500, 62], [2000, 52], [3000, 38], [5000, 18], [10000, 0]]);
    result.responsiveness = Math.round(responsivenessScore * 10) / 10;

    let accessibilityScore = 15;
    if (analysis.hasAltText) accessibilityScore += 38;
    if (analysis.hasAriaLabels) accessibilityScore += 32;
    if (analysis.hasViewport) accessibilityScore += 10;
    if (/<h[1-6]/i.test(html)) accessibilityScore += 5;
    result.accessibility = Math.round(accessibilityScore * 10) / 10;

    let privacyScore = 0;
    if (analysis.hasHTTPS) privacyScore += 35;
    if (analysis.hasCSP) privacyScore += 22;
    if (analysis.hasXFrameOptions) privacyScore += 16;
    if (analysis.hasHSTS) privacyScore += 18;
    if (analysis.hasPermissionsPolicy) privacyScore += 9;
    result.privacy = Math.round(privacyScore * 10) / 10;

    let deliveryScore = 0;
    const cdnHeaders = responseHeaders.get('cf-ray') || responseHeaders.get('x-amz-cf-id') || responseHeaders.get('x-cache');
    if (cdnHeaders) deliveryScore += 48;
    const cacheControl = responseHeaders.get('cache-control');
    if (cacheControl) {
      if (cacheControl.includes('max-age')) {
        const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1] || '0');
        if (maxAge > 86400) deliveryScore += 28;
        else if (maxAge > 3600) deliveryScore += 18;
        else if (maxAge > 0) deliveryScore += 8;
      }
      if (cacheControl.includes('public')) deliveryScore += 12;
      if (cacheControl.includes('immutable')) deliveryScore += 12;
    }
    result.delivery = Math.round(deliveryScore * 10) / 10;

    let sustainabilityScore = 0;
    const weightScore = smoothScore(sizeMB, [[0, 38], [0.5, 36], [1, 33], [1.5, 30], [2, 27], [2.4, 24], [3, 20], [4, 14], [5, 9], [7, 5], [10, 2], [20, 1], [50, 0]]);
    sustainabilityScore += weightScore;
    if (responseHeaders.get('cf-ray')) sustainabilityScore += 24;
    else if (cdnHeaders) sustainabilityScore += 14;
    if (cacheControl) sustainabilityScore += 6;
    if (analysis.hasAVIF) sustainabilityScore += 19;
    else if (analysis.hasWebP) sustainabilityScore += 14;
    if (analysis.hasLazyLoading) sustainabilityScore += 9;
    const resourceEfficiency = smoothScore(analysis.resourceCount, [[0, 14], [20, 13], [40, 11], [60, 9], [80, 7], [100, 5], [150, 2], [200, 0]]);
    sustainabilityScore += resourceEfficiency;
    result.sustainability = Math.round(clamp(sustainabilityScore) * 10) / 10;

    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442;
    const co2PerView = (sizeMB / 1024) * 0.81 * carbonIntensity;
    result.sustainability_details = {
      score: result.sustainability,
      co2PerView: Math.round(co2PerView * 1000) / 1000,
      isGreenHosted: !!responseHeaders.get('cf-ray')
    };

    // ========================================================================
    // PHASE 2: Fetch CrUX data
    // ========================================================================
    let cruxData = { hasData: false };
    try {
      cruxData = await fetchCruxData(targetUrl);
    } catch (error) {
      console.error('CrUX error (non-fatal):', error);
    }
    result.crux = cruxData;

    // ========================================================================
    // PHASE 3: Fetch Lighthouse data (ALWAYS try to get it for better data)
    // 🔥 FIX: Changed to always attempt Lighthouse if enabled
    // ========================================================================
    let lighthouseData = { hasData: false };
    
    if (USE_LIGHTHOUSE) {
      try {
        console.log('Attempting to fetch Lighthouse data...');
        lighthouseData = await fetchLighthouseData(targetUrl);
      } catch (error) {
        console.error('Lighthouse error (non-fatal):', error);
      }
    } else {
      lighthouseData.reason = 'lighthouse_disabled';
    }
    result.lighthouse = lighthouseData;

    // ========================================================================
    // BLEND CRUX OR LIGHTHOUSE DATA
    // 🔥 FIX: Prefer CrUX but use Lighthouse as fallback
    // ========================================================================
    const dataSource = cruxData.hasData ? cruxData : lighthouseData;

    if (dataSource.hasData) {
      console.log('Using data source:', cruxData.hasData ? 'CrUX' : 'Lighthouse');
      
      // Speed capping by real/lab LCP
      const lcp = dataSource.lcp_p75_ms || dataSource.lcp_ms;
      if (lcp) {
        console.log('LCP value:', lcp, 'ms');
        if (lcp > 4000) result.speed = Math.min(result.speed, 60);
        else if (lcp > 2500) result.speed = Math.min(result.speed, 80);
      }

      // Responsiveness upgrade to real/lab INP
      const inp = dataSource.inp_p75_ms || dataSource.inp_ms;
      if (inp !== undefined && inp !== null) {
        console.log('INP value:', inp, 'ms');
        if (inp <= 100) result.responsiveness = 100;
        else if (inp <= 200) result.responsiveness = 90;
        else if (inp <= 300) result.responsiveness = 70;
        else if (inp <= 500) result.responsiveness = 50;
        else result.responsiveness = 20;
      }
    } else {
      console.log('No CrUX or Lighthouse data available - using lab data only');
    }

    // Calculate P-Score
    const pscore = 
      result.speed * 0.25 +
      result.mobile * 0.20 +
      result.seo * 0.15 +
      result.responsiveness * 0.12 +
      result.accessibility * 0.10 +
      result.privacy * 0.08 +
      result.delivery * 0.06 +
      result.sustainability * 0.04;
    
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

    result._meta = {
      scannedAt: new Date().toISOString(),
      version: '2.0-phase3-psi-fixed',
      loadTimeMs: rawLoadTime,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      sector: sector,
      benchmark: BENCHMARK_DATA[result.rating],
      dataSource: cruxData.hasData ? 'crux' : (lighthouseData.hasData ? 'lighthouse' : 'lab'),
      usedRealUserData: cruxData.hasData,
      usedLighthouse: lighthouseData.hasData,
      coverage: '100%',
      weightings: {
        speed: 0.25,
        mobile: 0.20,
        seo: 0.15,
        responsiveness: 0.12,
        accessibility: 0.10,
        privacy: 0.08,
        delivery: 0.06,
        sustainability: 0.04
      }
    };

    return new Response(JSON.stringify(result), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
