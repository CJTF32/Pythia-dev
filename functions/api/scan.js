// ============================================================================
// PYTHIA SCAN ENGINE V2 - WITH SECTOR DETECTION & LOGIN PAGE DETECTION
// ============================================================================
// New features:
// - Sector classification
// - Login page detection
// - Benchmark comparisons
// - Data-driven rating thresholds

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

    // Helper functions
    const clamp = (value) => Math.max(0, Math.min(100, value));
    
    const smoothScore = (value, points) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[i + 1];
        
        if (value >= x1 && value <= x2) {
          const ratio = (value - x1) / (x2 - x1);
          return y1 + (y2 - y1) * ratio;
        }
      }
      
      if (value <= points[0][0]) return points[0][1];
      return points[points.length - 1][1];
    };

    // Normalize URL
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    // Fetch the website with timeout
    const startTime = Date.now();
    let response, loadTime, html;
    
    try {
      response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });
      loadTime = Date.now() - startTime;
      
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          return new Response(JSON.stringify({ 
            error: 'BLOCKED_SCAN',
            message: 'This site blocks automated scans. Request a manual scan.',
            status: response.status
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({ 
          error: `Failed to fetch: ${response.status}` 
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      html = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return new Response(JSON.stringify({ 
          error: 'TIMEOUT',
          message: 'Site took too long to respond'
        }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw error;
    }

    const responseHeaders = response.headers;
    
    // Calculate page size
    const sizeBytes = new Blob([html]).size;
    const sizeMB = sizeBytes / (1024 * 1024);
    
    // Initialize analysis object
    const analysis = {
      loadTime,
      sizeMB,
      hasHTTPS: targetUrl.startsWith('https://'),
      hasMeta: /<meta/i.test(html),
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
      blockingScripts: (html.match(/<script(?![^>]*async)(?![^>]*defer)/gi) || []).length,
      blockingCSS: (html.match(/<link[^>]*rel=["']stylesheet["'](?![^>]*media=["']print["'])/gi) || []).length
    };

    // Privacy/Security headers
    analysis.hasCSP = responseHeaders.has('content-security-policy');
    analysis.hasXFrameOptions = responseHeaders.has('x-frame-options');
    analysis.hasHSTS = responseHeaders.has('strict-transport-security');
    analysis.hasPermissionsPolicy = responseHeaders.has('permissions-policy');

    // ========================================================================
    // NEW: DETECT LOGIN PAGE
    // ========================================================================
    const loginIndicators = [
      'type="password"',
      "type='password'",
      /\blogin\b/i,
      /\bsign in\b/i,
      /\bsign-in\b/i,
      /\bsignin\b/i,
      /\blog in\b/i,
      /\busername\b/i,
      /\bforgot password\b/i,
      /\bcreate account\b/i,
      /\bregister\b/i
    ];
    
    const loginIndicatorCount = loginIndicators.reduce((count, indicator) => {
      if (typeof indicator === 'string') {
        return count + (html.toLowerCase().includes(indicator) ? 1 : 0);
      } else {
        return count + (indicator.test(html) ? 1 : 0);
      }
    }, 0);
    
    const isLoginPage = loginIndicatorCount >= 3;

    // ========================================================================
    // NEW: CLASSIFY SECTOR
    // ========================================================================
    const domain = new URL(targetUrl).hostname.replace('www.', '');
    
    const classifySector = (domain) => {
      const d = domain.toLowerCase();
      
      // Technology & Software
      if (/google|microsoft|apple|adobe|github|stackoverflow|reddit|twitter|x\.com|meta|telegram|zoom|dropbox|linkedin|slack|discord|twitch|spotify|tiktok|snap/.test(d)) {
        return 'Technology & Software';
      }
      
      // E-commerce & Retail
      if (/amazon|ebay|alibaba|walmart|target|etsy|shop|store/.test(d)) {
        return 'E-commerce & Retail';
      }
      
      // Media & Entertainment
      if (/netflix|youtube|hulu|disney|hbo|espn|nytimes|bbc|cnn|news|media/.test(d)) {
        return 'Media & Entertainment';
      }
      
      // Financial Services
      if (/bank|paypal|visa|mastercard|chase|wells|citi|finance|invest|trading|crypto/.test(d)) {
        return 'Financial Services';
      }
      
      // Education
      if (/\.edu|university|college|school|academic|coursera|udemy|khan/.test(d)) {
        return 'Education';
      }
      
      // Healthcare
      if (/health|medical|hospital|clinic|pharma|medicine|doctor/.test(d)) {
        return 'Healthcare';
      }
      
      // Government
      if (/\.gov|government/.test(d)) {
        return 'Government';
      }
      
      // Travel & Hospitality
      if (/booking|airbnb|hotel|travel|flight|trip|vacation|expedia|tripadvisor/.test(d)) {
        return 'Travel & Hospitality';
      }
      
      return 'General';
    };
    
    const sector = classifySector(domain);

    // Initialize result object
    const result = {};

    // ========================================================================
    // CALCULATE 11 COMPONENT SCORES (unchanged from original)
    // ========================================================================

    // 1. SPEED - 30% weight
    const adjustedLoadTime = Math.max(0, loadTime - 200);
    const speedScore = smoothScore(adjustedLoadTime, [
      [0, 100], [100, 97.5], [200, 95], [300, 92.5], [400, 90],
      [500, 87.5], [600, 85], [800, 80], [1000, 75], [1500, 65],
      [2000, 55], [3000, 40], [5000, 20], [10000, 0]
    ]);
    result.speed = Math.round(speedScore * 10) / 10;

    // 2. MOBILE - 18% weight
    let mobileScore = 0;
    if (analysis.hasViewport) mobileScore += 35;
    if (analysis.hasAVIF) mobileScore += 30;
    else if (analysis.hasWebP) mobileScore += 22;
    if (analysis.hasLazyLoading) mobileScore += 18;
    if (sizeMB < 1) mobileScore += 17;
    else if (sizeMB < 2) mobileScore += 12;
    else if (sizeMB < 3) mobileScore += 8;
    else if (sizeMB < 5) mobileScore += 4;
    result.mobile = Math.round(mobileScore * 10) / 10;

    // 3. SEO - 13% weight
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

    // 4. INTERACTIVITY - 10% weight
    const interactivityScore = smoothScore(loadTime, [
      [0, 100], [50, 98], [100, 96], [200, 93], [300, 90],
      [500, 85], [800, 78], [1000, 72], [1500, 62], [2000, 52],
      [3000, 38], [5000, 18], [10000, 0]
    ]);
    result.interactivity = Math.round(interactivityScore * 10) / 10;

    // 5. ACCESSIBILITY - 10% weight
    let accessibilityScore = 15;
    if (analysis.hasAltText) accessibilityScore += 38;
    if (analysis.hasAriaLabels) accessibilityScore += 32;
    if (analysis.hasViewport) accessibilityScore += 10;
    if (/<h[1-6]/i.test(html)) accessibilityScore += 5;
    result.accessibility = Math.round(accessibilityScore * 10) / 10;

    // 6. PRIVACY - 6% weight
    let privacyScore = 0;
    if (analysis.hasHTTPS) privacyScore += 35;
    if (analysis.hasCSP) privacyScore += 22;
    if (analysis.hasXFrameOptions) privacyScore += 16;
    if (analysis.hasHSTS) privacyScore += 18;
    if (analysis.hasPermissionsPolicy) privacyScore += 9;
    result.privacy = Math.round(privacyScore * 10) / 10;

    // 7. CDN - 5% weight
    let cdnScore = 0;
    const cdnHeaders = responseHeaders.get('cf-ray') || 
                       responseHeaders.get('x-amz-cf-id') ||
                       responseHeaders.get('x-cache');
    if (cdnHeaders) cdnScore += 48;
    const cacheControl = responseHeaders.get('cache-control');
    if (cacheControl) {
      if (cacheControl.includes('max-age')) {
        const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1] || '0');
        if (maxAge > 86400) cdnScore += 28;
        else if (maxAge > 3600) cdnScore += 18;
        else if (maxAge > 0) cdnScore += 8;
      }
      if (cacheControl.includes('public')) cdnScore += 12;
      if (cacheControl.includes('immutable')) cdnScore += 12;
    }
    result.cdn = Math.round(cdnScore * 10) / 10;

    // 8. PAGE WEIGHT - 4% weight
    const pageWeightScore = smoothScore(sizeMB, [
      [0, 100], [0.3, 98], [0.5, 95], [0.8, 92], [1, 88],
      [1.5, 82], [2, 76], [2.5, 70], [3, 62], [4, 52],
      [5, 42], [7, 28], [10, 15], [15, 8], [20, 3], [50, 0]
    ]);
    result.pageWeight = Math.round(pageWeightScore * 10) / 10;

    // 9. MODERN STANDARDS - 2% weight
    let modernStandardsScore = 0;
    if (analysis.hasAVIF) modernStandardsScore += 32;
    else if (analysis.hasWebP) modernStandardsScore += 26;
    if (analysis.hasLazyLoading) modernStandardsScore += 28;
    if (analysis.hasViewport) modernStandardsScore += 18;
    if (analysis.hasStructuredData) modernStandardsScore += 14;
    if (/type=["']module["']/.test(html)) modernStandardsScore += 8;
    result.modernStandards = Math.round(modernStandardsScore * 10) / 10;

    // 10. CODE QUALITY - 1% weight
    let codeQualityScore = 65;
    codeQualityScore -= Math.min(25, analysis.blockingScripts * 1.8);
    codeQualityScore -= Math.min(18, analysis.blockingCSS * 2.2);
    if (analysis.resourceCount < 30) codeQualityScore += 12;
    else if (analysis.resourceCount < 50) codeQualityScore += 8;
    else if (analysis.resourceCount < 80) codeQualityScore += 4;
    else if (analysis.resourceCount > 150) {
      codeQualityScore -= Math.min(15, (analysis.resourceCount - 150) * 0.12);
    }
    result.codeQuality = Math.round(clamp(codeQualityScore) * 10) / 10;

    // 11. SUSTAINABILITY - 1% weight
    let sustainabilityScore = 0;
    const weightScore = smoothScore(sizeMB, [
      [0, 38], [0.5, 36], [1, 33], [1.5, 30], [2, 27],
      [2.4, 24], [3, 20], [4, 14], [5, 9], [7, 5],
      [10, 2], [20, 1], [50, 0]
    ]);
    sustainabilityScore += weightScore;
    if (responseHeaders.get('cf-ray')) sustainabilityScore += 24;
    else if (cdnHeaders) sustainabilityScore += 14;
    if (cacheControl) sustainabilityScore += 6;
    if (analysis.hasAVIF) sustainabilityScore += 19;
    else if (analysis.hasWebP) sustainabilityScore += 14;
    if (analysis.hasLazyLoading) sustainabilityScore += 9;
    const resourceEfficiency = smoothScore(analysis.resourceCount, [
      [0, 14], [20, 13], [40, 11], [60, 9], [80, 7],
      [100, 5], [150, 2], [200, 0]
    ]);
    sustainabilityScore += resourceEfficiency;
    result.sustainability = Math.round(clamp(sustainabilityScore) * 10) / 10;
    
    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442;
    const energyPerGB = 0.81;
    const co2PerView = (sizeMB / 1024) * energyPerGB * carbonIntensity;
    
    result.sustainability_details = {
      score: result.sustainability,
      co2PerView: Math.round(co2PerView * 1000) / 1000,
      isGreenHosted: !!responseHeaders.get('cf-ray')
    };

    // ========================================================================
    // CALCULATE P-SCORE
    // ========================================================================
    const pscore = 
      result.speed * 0.30 +
      result.mobile * 0.18 +
      result.seo * 0.13 +
      result.interactivity * 0.10 +
      result.accessibility * 0.10 +
      result.privacy * 0.06 +
      result.cdn * 0.05 +
      result.pageWeight * 0.04 +
      result.modernStandards * 0.02 +
      result.codeQuality * 0.01 +
      result.sustainability * 0.01;
    
    result.pscore = Math.round(pscore * 10) / 10;
    
    // Convert to Pythia Rating (scores CCC and CC extrapolated)
    if (result.pscore >= 90.7) result.rating = 'AAA';
    else if (result.pscore >= 87.8) result.rating = 'AA';
    else if (result.pscore >= 82.7) result.rating = 'A';
    else if (result.pscore >= 75.1) result.rating = 'BBB';
    else if (result.pscore >= 65.5) result.rating = 'BB';
    else if (result.pscore >= 54.5) result.rating = 'B';
    else if (result.pscore >= 41.5) result.rating = 'CCC';
    else if (result.pscore >= 26.5) result.rating = 'CC';
    else result.rating = 'C';
    
    // Add new metadata
    result._meta = {
      scannedAt: new Date().toISOString(),
      loadTimeMs: loadTime,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      sector: sector,
      isLoginPage: isLoginPage,
      htmlAnalysis: {
        hasHTTPS: analysis.hasHTTPS,
        hasViewport: analysis.hasViewport,
        hasTitle: analysis.hasTitle,
        hasDescription: analysis.hasDescription,
        hasWebP: analysis.hasWebP,
        hasAVIF: analysis.hasAVIF,
        hasLazyLoading: analysis.hasLazyLoading,
        hasCSP: analysis.hasCSP,
        hasHSTS: analysis.hasHSTS
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
