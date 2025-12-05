// ============================================================================
// PYTHIA RATING ENGINE V2.0 - PHASE 2: CRUX REAL-USER DATA
// ============================================================================
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

    const CRUX_API_KEY = 'AIzaSyCxhwaXKjHZ0cGhF5V_klxfvpCXAeYpj94';
    const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

    async function fetchCruxData(siteUrl) {
      try {
        const urlObj = new URL(siteUrl);
        const origin = `${urlObj.protocol}//${urlObj.hostname}`;
        
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
            body: JSON.stringify({ url: origin, formFactor: 'ALL' })
          });
          data = await response.json();
        }
        
        if (!response.ok || !data.record) {
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

    const RATING_THRESHOLDS = { AAA: 95.0, AA: 90.0, A: 85.0, BBB: 80.0, BB: 75.0, B: 70.0, CCC: 65.0, CC: 60.0, C: 0.0 };

    const SECTOR_RULES = {
      'Technology & Software': { keywords: ['facebook', 'instagram', 'twitter', 'linkedin', 'github', 'google', 'microsoft', 'apple', 'amazon', 'software', 'saas'], tldPatterns: ['.io', '.dev', '.app'] },
      'E-commerce & Retail': { keywords: ['amazon', 'ebay', 'walmart', 'shop', 'store', 'buy', 'cart'] },
      'Media & Entertainment': { keywords: ['netflix', 'youtube', 'cnn', 'bbc', 'news', 'media'] },
      'Financial Services': { keywords: ['bank', 'paypal', 'stripe', 'finance', 'trading'] },
      'Education': { keywords: ['university', 'college', 'school', 'education'], tldPatterns: ['.edu'] },
      'Healthcare': { keywords: ['health', 'medical', 'hospital', 'clinic'] },
      'Government': { keywords: ['government'], tldPatterns: ['.gov'] },
      'Travel & Hospitality': { keywords: ['booking', 'hotel', 'travel', 'flight'] },
      'Food & Beverage': { keywords: ['restaurant', 'food', 'delivery'] },
      'Gaming': { keywords: ['steam', 'game', 'gaming'] }
    };

    function classifySector(domain) {
      const domainLower = domain.toLowerCase();
      for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
        if (rules.keywords?.some(kw => domainLower.includes(kw))) return sector;
        if (rules.tldPatterns?.some(tld => domainLower.endsWith(tld))) return sector;
      }
      return 'General';
    }

    const clamp = (value) => Math.max(0, Math.min(100, value));
    const smoothScore = (value, points) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[i + 1];
        if (value >= x1 && value <= x2) {
          return y1 + (y2 - y1) * ((value - x1) / (x2 - x1));
        }
      }
      return value <= points[0][0] ? points[0][1] : points[points.length - 1][1];
    };

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    // Validate URL before fetching
try {
  new URL(targetUrl);
} catch (e) {
  return new Response(JSON.stringify({ 
    error: 'INVALID_URL', 
    message: 'Invalid URL format' 
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}
    
    const startTime = Date.now();
    let response, html;

    try {
      response = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          return new Response(JSON.stringify({ error: 'BLOCKED_SCAN', message: 'Site blocks automated scans' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: 'Failed to fetch', message: 'Site unreachable' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      
      html = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return new Response(JSON.stringify({ error: 'TIMEOUT', message: 'Site took too long' }), { status: 504, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Failed to fetch', message: error.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const rawLoadTime = Date.now() - startTime;
    const responseHeaders = response.headers;
    const sizeBytes = new Blob([html]).size;
    const sizeMB = sizeBytes / (1024 * 1024);
    const loadTime = Math.max(0, rawLoadTime - 200);

    const analysis = {
      hasHTTPS: targetUrl.startsWith('https://'),
      hasViewport: /<meta[^>]*viewport/i.test(html),
      hasTitle: /<title[^>]*>([^<]+)<\/title>/i.test(html),
      hasDescription: /<meta[^>]*name=["']description["'][^>]*>/i.test(html),
      hasOG: /<meta[^>]*property=["']og:/i.test(html),
      hasAltText: /<img[^>]*alt=["'][^"']+["']/i.test(html),
      hasAriaLabels: /aria-label/i.test(html),
      hasWebP: /\.webp/i.test(html),
      hasAVIF: /\.avif/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      hasStructuredData: /<script[^>]*type=["']application\/ld\+json["']/i.test(html),
      resourceCount: (html.match(/<script|<link|<img|<style/gi) || []).length,
      hasCSP: responseHeaders.has('content-security-policy'),
      hasXFrameOptions: responseHeaders.has('x-frame-options'),
      hasHSTS: responseHeaders.has('strict-transport-security'),
      hasPermissionsPolicy: responseHeaders.has('permissions-policy')
    };

    const domain = new URL(targetUrl).hostname;
    const sector = classifySector(domain);
    const result = {};

    // Speed
    const speedScore = smoothScore(loadTime, [[0, 100], [100, 97], [200, 94], [300, 91], [400, 88], [500, 85], [600, 82], [800, 76], [1000, 70], [1500, 58], [2000, 46], [3000, 30], [5000, 15], [10000, 0]]);
    result.speed = Math.round(speedScore * 10) / 10;

    // Mobile
    let mobileScore = 0;
    if (analysis.hasViewport) mobileScore += 35;
    if (analysis.hasAVIF) mobileScore += 30;
    else if (analysis.hasWebP) mobileScore += 22;
    if (analysis.hasLazyLoading) mobileScore += 18;
    if (sizeMB < 1.0) mobileScore += 17;
    else if (sizeMB < 2.0) mobileScore += 12;
    else if (sizeMB < 3.0) mobileScore += 8;
    else if (sizeMB < 5.0) mobileScore += 4;
    result.mobile = Math.round(mobileScore * 10) / 10;

    // SEO
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

    // Responsiveness
    const responsivenessScore = smoothScore(loadTime, [[0, 100], [50, 98], [100, 96], [200, 93], [300, 90], [500, 85], [800, 78], [1000, 72], [1500, 62], [2000, 52], [3000, 38], [5000, 18], [10000, 0]]);
    result.responsiveness = Math.round(responsivenessScore * 10) / 10;

    // Accessibility
    let accessibilityScore = 15;
    if (analysis.hasAltText) accessibilityScore += 38;
    if (analysis.hasAriaLabels) accessibilityScore += 32;
    if (analysis.hasViewport) accessibilityScore += 10;
    if (/<h[1-6]/i.test(html)) accessibilityScore += 5;
    result.accessibility = Math.round(accessibilityScore * 10) / 10;

    // Privacy
    let privacyScore = 0;
    if (analysis.hasHTTPS) privacyScore += 35;
    if (analysis.hasCSP) privacyScore += 22;
    if (analysis.hasXFrameOptions) privacyScore += 16;
    if (analysis.hasHSTS) privacyScore += 18;
    if (analysis.hasPermissionsPolicy) privacyScore += 9;
    result.privacy = Math.round(privacyScore * 10) / 10;

    // Delivery
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

    // Sustainability
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

    // PHASE 2: Fetch CrUX data
    let cruxData = { hasData: false };
    try {
      cruxData = await fetchCruxData(targetUrl);
    } catch (error) {
      console.error('CrUX error (non-fatal):', error);
    }
    result.crux = cruxData;

    if (cruxData.hasData) {
      // Speed capping by real LCP
      if (cruxData.lcp_p75_ms) {
        if (cruxData.lcp_p75_ms > 4000) result.speed = Math.min(result.speed, 60);
        else if (cruxData.lcp_p75_ms > 2500) result.speed = Math.min(result.speed, 80);
      }

      // Responsiveness upgrade to real INP
      if (cruxData.inp_p75_ms !== undefined && cruxData.inp_p75_ms !== null) {
        const inp = cruxData.inp_p75_ms;
        if (inp <= 100) result.responsiveness = 100;
        else if (inp <= 200) result.responsiveness = 90;
        else if (inp <= 300) result.responsiveness = 70;
        else if (inp <= 500) result.responsiveness = 50;
        else result.responsiveness = 20;
      }
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
      version: '2.0-phase2',
      loadTimeMs: rawLoadTime,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      sector: sector,
      benchmark: BENCHMARK_DATA[result.rating],
      usedRealUserData: cruxData.hasData,
      cruxCoverage: cruxData.hasData ? cruxData.formFactor : 'none',
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
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
