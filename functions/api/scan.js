// ============================================================================
// PYTHIA RATING ENGINE V2.1 - DIAGNOSTIC VERSION
// ============================================================================
// Enhanced with better error handling and logging

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

    // API Keys - You may need to replace these with fresh ones
    const CRUX_API_KEY = 'AIzaSyD3vkIWqvctKx1BRu2CEEOF7goYTyAx5Bs';
    const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    
    // PageSpeed Insights API
    const PSI_API_KEY = 'AIzaSyBYVTe6sRJGyB9vtI0cnvBxRFQ4ruNPf8M';
    const PSI_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    const USE_LIGHTHOUSE = true;

    // ========================================================================
    // ENHANCED CRUX FETCH WITH DETAILED ERROR LOGGING
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
        console.log('📊 CrUX DESKTOP response:', {
          status: response.status,
          hasRecord: !!data.record,
          error: data.error
        });
        
        if (!response.ok || !data.record) {
          console.log('🔄 Trying CrUX with ALL form factors...');
          response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: origin })
          });
          data = await response.json();
          console.log('📊 CrUX ALL response:', {
            status: response.status,
            hasRecord: !!data.record,
            error: data.error
          });
        }
        
        if (!response.ok) {
          console.error('❌ CrUX API error:', data.error);
          return { 
            hasData: false, 
            reason: 'api_error',
            errorDetails: data.error 
          };
        }
        
        if (!data.record) {
          console.log('⚠️ No CrUX data available for this origin');
          return { 
            hasData: false,
            reason: 'no_data'
          };
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
        
        console.log('✅ CrUX metrics extracted:', metrics);
        
        return {
          hasData: true,
          ...metrics,
          formFactor: data.record.key?.formFactor || 'UNKNOWN'
        };
        
      } catch (error) {
        console.error('❌ CrUX fetch error:', error.message);
        return { 
          hasData: false,
          reason: 'fetch_error',
          errorMessage: error.message
        };
      }
    }

    // ========================================================================
    // ENHANCED LIGHTHOUSE FETCH WITH DETAILED ERROR LOGGING
    // ========================================================================
    async function fetchLighthouseData(siteUrl) {
      if (!USE_LIGHTHOUSE) {
        return { hasData: false, reason: 'disabled' };
      }

      try {
        const psiUrl = `${PSI_API_URL}?url=${encodeURIComponent(siteUrl)}&strategy=desktop&category=performance&key=${PSI_API_KEY}`;
        
        console.log('🔍 Fetching Lighthouse data via PSI...');
        
        const response = await fetch(psiUrl, {
          signal: AbortSignal.timeout(30000)
        });
        
        console.log('📊 PSI response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ PSI API error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorText
          });
          return { 
            hasData: false, 
            reason: 'api_error', 
            status: response.status,
            errorDetails: errorText
          };
        }
        
        const data = await response.json();
        
        if (!data.lighthouseResult) {
          console.error('❌ No lighthouse result in PSI response');
          return { hasData: false, reason: 'no_lighthouse_data' };
        }
        
        console.log('✅ Lighthouse data received successfully');
        
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
        
        // Interaction to Next Paint
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
        
        console.log('✅ Lighthouse metrics extracted:', {
          lcp: metrics.lcp_ms,
          inp: metrics.inp_ms,
          cls: metrics.cls,
          score: metrics.lighthouseScore
        });
        
        // Extract opportunities and diagnostics
        metrics.opportunities = [];
        metrics.diagnostics = [];
        
        const opportunityAudits = [
          'render-blocking-resources',
          'unused-css-rules',
          'unused-javascript',
          'uses-optimized-images',
          'modern-image-formats',
          'uses-text-compression',
          'uses-responsive-images',
          'offscreen-images',
          'unminified-css',
          'unminified-javascript',
          'efficient-animated-content',
          'duplicated-javascript',
          'legacy-javascript',
          'total-byte-weight',
          'uses-long-cache-ttl',
          'font-display',
          'third-party-summary',
          'largest-contentful-paint-element'
        ];
        
        opportunityAudits.forEach(auditId => {
          const audit = audits[auditId];
          if (audit && audit.score !== null && audit.score < 1) {
            metrics.opportunities.push({
              id: auditId,
              title: audit.title,
              description: audit.description,
              score: Math.round(audit.score * 100),
              displayValue: audit.displayValue || '',
              numericValue: audit.numericValue,
              numericUnit: audit.numericUnit
            });
          }
        });
        
        return metrics;
        
      } catch (error) {
        console.error('❌ Lighthouse fetch error:', error.message);
        return { 
          hasData: false,
          reason: 'fetch_error',
          errorMessage: error.message
        };
      }
    }

    // ========================================================================
    // REST OF YOUR PYTHIA SCAN CODE (unchanged)
    // ========================================================================
    
    function clamp(val, min = 0, max = 100) {
      return Math.max(min, Math.min(max, val));
    }

    function smoothScore(val, points) {
      if (val <= points[0][0]) return points[0][1];
      if (val >= points[points.length - 1][0]) return points[points.length - 1][1];
      for (let i = 0; i < points.length - 1; i++) {
        if (val >= points[i][0] && val <= points[i + 1][0]) {
          const t = (val - points[i][0]) / (points[i + 1][0] - points[i][0]);
          return points[i][1] + t * (points[i + 1][1] - points[i][1]);
        }
      }
      return 0;
    }

    const BENCHMARK_DATA = {
      'AAA': 'Top 1% of websites',
      'AA': 'Top 5% of websites',
      'A': 'Top 10% of websites',
      'BBB': 'Top 20% of websites',
      'BB': 'Top 30% of websites',
      'B': 'Top 50% of websites',
      'CCC': 'Bottom 50% of websites',
      'CC': 'Bottom 30% of websites',
      'C': 'Bottom 10% of websites'
    };

    let targetUrl = url.trim();
    if (!targetUrl.match(/^https?:\/\//i)) {
      targetUrl = 'https://' + targetUrl;
    }

    // Phase 1: Basic scan
    console.log('🚀 Starting scan for:', targetUrl);
    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ 
        error: 'SITE_NOT_FOUND',
        message: `HTTP ${response.status}` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = await response.text();
    const rawLoadTime = Date.now() - startTime;
    const responseHeaders = response.headers;

    const sector = 'General';
    const sizeMB = new Blob([html]).size / 1024 / 1024;

    const analysis = {
      resourceCount: (html.match(/<(script|link|img|video|audio|iframe)/gi) || []).length,
      hasTitle: /<title/i.test(html),
      hasDescription: /name=["']description["']/i.test(html),
      hasOG: /property=["']og:/i.test(html),
      hasStructuredData: /application\/ld\+json/i.test(html) || /<script[^>]*type=["']application\/ld\+json["']/i.test(html),
      hasHTTPS: targetUrl.startsWith('https://'),
      hasAltText: /alt=["']/i.test(html),
      hasAriaLabels: /aria-label/i.test(html),
      hasViewport: /name=["']viewport["']/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      hasWebP: /\.webp/i.test(html),
      hasAVIF: /\.avif/i.test(html),
      hasCSP: responseHeaders.get('content-security-policy') !== null,
      hasXFrameOptions: responseHeaders.get('x-frame-options') !== null,
      hasHSTS: responseHeaders.get('strict-transport-security') !== null,
      hasPermissionsPolicy: responseHeaders.get('permissions-policy') !== null
    };

    const result = {};
    const loadTime = rawLoadTime < 50 ? 300 : rawLoadTime;

    let speedScore = smoothScore(loadTime, [
      [0, 100], [50, 98], [100, 96], [200, 93], [300, 90], [500, 85], [800, 78],
      [1000, 72], [1500, 62], [2000, 52], [3000, 38], [5000, 18], [10000, 0]
    ]);
    if (sizeMB > 5) speedScore -= Math.min(15, (sizeMB - 5) * 3);
    result.speed = Math.round(clamp(speedScore) * 10) / 10;

    let mobileScore = 0;
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

    const responsivenessScore = smoothScore(loadTime, [
      [0, 100], [50, 98], [100, 96], [200, 93], [300, 90], [500, 85], [800, 78],
      [1000, 72], [1500, 62], [2000, 52], [3000, 38], [5000, 18], [10000, 0]
    ]);
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
    const weightScore = smoothScore(sizeMB, [
      [0, 38], [0.5, 36], [1, 33], [1.5, 30], [2, 27], [2.4, 24], [3, 20],
      [4, 14], [5, 9], [7, 5], [10, 2], [20, 1], [50, 0]
    ]);
    sustainabilityScore += weightScore;
    if (responseHeaders.get('cf-ray')) sustainabilityScore += 24;
    else if (cdnHeaders) sustainabilityScore += 14;
    if (cacheControl) sustainabilityScore += 6;
    if (analysis.hasAVIF) sustainabilityScore += 19;
    else if (analysis.hasWebP) sustainabilityScore += 14;
    if (analysis.hasLazyLoading) sustainabilityScore += 9;
    const resourceEfficiency = smoothScore(analysis.resourceCount, [
      [0, 14], [20, 13], [40, 11], [60, 9], [80, 7], [100, 5], [150, 2], [200, 0]
    ]);
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
    console.log('📊 Phase 2: Fetching CrUX data...');
    let cruxData = { hasData: false };
    try {
      cruxData = await fetchCruxData(targetUrl);
      console.log('CrUX result:', cruxData);
    } catch (error) {
      console.error('CrUX error (non-fatal):', error);
    }
    result.crux = cruxData;

    // ========================================================================
    // PHASE 3: Fetch Lighthouse data
    // ========================================================================
    console.log('🔬 Phase 3: Fetching Lighthouse data...');
    let lighthouseData = { hasData: false };
    
    if (USE_LIGHTHOUSE) {
      try {
        lighthouseData = await fetchLighthouseData(targetUrl);
        console.log('Lighthouse result:', lighthouseData);
      } catch (error) {
        console.error('Lighthouse error (non-fatal):', error);
      }
    } else {
      lighthouseData.reason = 'lighthouse_disabled';
    }
    result.lighthouse = lighthouseData;

    // ========================================================================
    // BLEND CRUX OR LIGHTHOUSE DATA
    // ========================================================================
    const dataSource = cruxData.hasData ? cruxData : lighthouseData;

    if (dataSource.hasData) {
      console.log('✅ Using data source:', cruxData.hasData ? 'CrUX' : 'Lighthouse');
      
      // Speed capping by real/lab LCP
      const lcp = dataSource.lcp_p75_ms || dataSource.lcp_ms;
      if (lcp) {
        console.log('📈 LCP value:', lcp, 'ms');
        if (lcp > 4000) result.speed = Math.min(result.speed, 60);
        else if (lcp > 2500) result.speed = Math.min(result.speed, 80);
      }

      // Responsiveness upgrade to real/lab INP
      const inp = dataSource.inp_p75_ms || dataSource.inp_ms;
      if (inp !== undefined && inp !== null) {
        console.log('📈 INP value:', inp, 'ms');
        if (inp <= 100) result.responsiveness = 100;
        else if (inp <= 200) result.responsiveness = 90;
        else if (inp <= 300) result.responsiveness = 70;
        else if (inp <= 500) result.responsiveness = 50;
        else result.responsiveness = 20;
      }
    } else {
      console.log('⚠️ No CrUX or Lighthouse data available - using lab data only');
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
      version: '2.1-diagnostic',
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
      },
      // Add diagnostic info
      diagnostics: {
        cruxAttempted: true,
        cruxSuccess: cruxData.hasData,
        cruxError: cruxData.hasData ? null : (cruxData.errorDetails || cruxData.reason),
        lighthouseAttempted: USE_LIGHTHOUSE,
        lighthouseSuccess: lighthouseData.hasData,
        lighthouseError: lighthouseData.hasData ? null : (lighthouseData.errorDetails || lighthouseData.reason)
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
