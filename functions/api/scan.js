// ============================================================================
// PYTHIA SCAN ENGINE - Research-Backed Weights + Plain Names
// ============================================================================
// All indices use plain descriptive names (speed, mobile, seo, etc.)
// Weights based on revenue impact research from Amazon, Walmart, Google, etc.
// Includes verification metadata to prove scans are real
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

    // Helper function to clamp scores between 0-100
    const clamp = (value) => Math.max(0, Math.min(100, value));
    
    // Helper function for smooth score interpolation
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

    // Fetch the website
    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const loadTime = Date.now() - startTime;
    
    if (!response.ok) {
      return new Response(JSON.stringify({ 
        error: `Failed to fetch: ${response.status}` 
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = await response.text();
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

    // Initialize result object
    const result = {};

    // ========================================================================
    // CALCULATE 11 COMPONENT SCORES (Plain Names)
    // ========================================================================

    // 1. SPEED - 30% weight
    // Physics-aware: Apply 200ms baseline for network latency
    const adjustedLoadTime = Math.max(0, loadTime - 200);
    const speedScore = smoothScore(adjustedLoadTime, [
      [0, 100],
      [300, 95],
      [500, 90],
      [800, 85],
      [1000, 80],
      [1500, 70],
      [2000, 60],
      [3000, 40],
      [5000, 20],
      [10000, 0]
    ]);
    result.speed = clamp(speedScore);

    // 2. MOBILE - 18% weight
    let mobileScore = 0;
    if (analysis.hasViewport) mobileScore += 40;
    
    // Responsive images
    if (analysis.hasWebP || analysis.hasAVIF) mobileScore += 25;
    if (analysis.hasLazyLoading) mobileScore += 15;
    
    // Mobile-friendly size
    if (sizeMB < 2) mobileScore += 20;
    else if (sizeMB < 5) mobileScore += 10;
    
    result.mobile = clamp(mobileScore);

    // 3. SEO - 13% weight
    let seoScore = 0;
    if (analysis.hasTitle) seoScore += 25;
    if (analysis.hasDescription) seoScore += 25;
    if (analysis.hasOG) seoScore += 20;
    if (analysis.hasStructuredData) seoScore += 15;
    if (analysis.hasHTTPS) seoScore += 15;
    
    result.seo = clamp(seoScore);

    // 4. INTERACTIVITY - 10% weight
    const interactivityScore = smoothScore(loadTime, [
      [0, 100],
      [100, 95],
      [300, 90],
      [500, 85],
      [1000, 75],
      [2000, 60],
      [3000, 40],
      [5000, 20],
      [10000, 0]
    ]);
    result.interactivity = clamp(interactivityScore);

    // 5. ACCESSIBILITY - 10% weight
    let accessibilityScore = 20; // Base for valid HTML
    if (analysis.hasAltText) accessibilityScore += 40;
    if (analysis.hasAriaLabels) accessibilityScore += 30;
    if (analysis.hasViewport) accessibilityScore += 10;
    
    result.accessibility = clamp(accessibilityScore);

    // 6. PRIVACY - 6% weight
    let privacyScore = 0;
    if (analysis.hasHTTPS) privacyScore += 40;
    if (analysis.hasCSP) privacyScore += 20;
    if (analysis.hasXFrameOptions) privacyScore += 15;
    if (analysis.hasHSTS) privacyScore += 15;
    if (analysis.hasPermissionsPolicy) privacyScore += 10;
    
    result.privacy = clamp(privacyScore);

    // 7. CDN - 5% weight
    let cdnScore = 0;
    const cdnHeaders = responseHeaders.get('cf-ray') || 
                       responseHeaders.get('x-amz-cf-id') ||
                       responseHeaders.get('x-cache');
    
    if (cdnHeaders) cdnScore += 50;
    
    const cacheControl = responseHeaders.get('cache-control');
    if (cacheControl) {
      if (cacheControl.includes('max-age')) cdnScore += 30;
      if (cacheControl.includes('public')) cdnScore += 10;
      if (cacheControl.includes('immutable')) cdnScore += 10;
    }
    
    result.cdn = clamp(cdnScore);

    // 8. PAGE WEIGHT - 4% weight
    const pageWeightScore = smoothScore(sizeMB, [
      [0, 100],
      [0.5, 95],
      [1, 90],
      [2, 80],
      [3, 70],
      [5, 50],
      [10, 25],
      [20, 10],
      [50, 0]
    ]);
    result.pageWeight = clamp(pageWeightScore);

    // 9. MODERN STANDARDS - 2% weight
    let modernStandardsScore = 0;
    if (analysis.hasAVIF) modernStandardsScore += 35;
    else if (analysis.hasWebP) modernStandardsScore += 30;
    if (analysis.hasLazyLoading) modernStandardsScore += 30;
    if (analysis.hasViewport) modernStandardsScore += 20;
    if (analysis.hasStructuredData) modernStandardsScore += 15;
    
    result.modernStandards = clamp(modernStandardsScore);

    // 10. CODE QUALITY - 1% weight
    let codeQualityScore = 60; // Baseline
    
    if (analysis.blockingScripts === 0) {
      codeQualityScore += 20;
    } else {
      codeQualityScore -= Math.min(20, analysis.blockingScripts * 3);
    }
    
    if (analysis.blockingCSS === 0) {
      codeQualityScore += 20;
    } else {
      codeQualityScore -= Math.min(15, analysis.blockingCSS * 2.5);
    }
    
    if (analysis.resourceCount < 50) codeQualityScore += 10;
    else if (analysis.resourceCount > 150) {
      codeQualityScore -= Math.min(10, (analysis.resourceCount - 150) * 0.1);
    }
    
    result.codeQuality = clamp(codeQualityScore);

    // 11. SUSTAINABILITY - 1% weight
    let sustainabilityScore = 0;
    
    // Page Weight Efficiency (40 points max)
    const weightScore = smoothScore(sizeMB, [
      [0, 40],
      [0.5, 38],
      [1, 35],
      [2, 28],
      [2.4, 25],
      [3, 20],
      [5, 10],
      [10, 5],
      [20, 2],
      [50, 0]
    ]);
    sustainabilityScore += weightScore;
    
    // Green Hosting Detection (25 points max)
    if (responseHeaders.get('cf-ray')) {
      sustainabilityScore += 25; // Cloudflare uses renewable energy
    } else if (cdnHeaders) {
      sustainabilityScore += 15; // Other CDNs
    }
    
    // Cache bonus
    if (cacheControl) {
      sustainabilityScore += 5;
    }
    
    // Image Optimization (20 points max)
    if (analysis.hasAVIF) {
      sustainabilityScore += 20;
    } else if (analysis.hasWebP) {
      sustainabilityScore += 15;
    }
    
    if (analysis.hasLazyLoading) {
      sustainabilityScore += 10;
    }
    
    // Resource Efficiency (15 points max)
    const resourceEfficiency = smoothScore(analysis.resourceCount, [
      [0, 15],
      [25, 15],
      [50, 12],
      [100, 8],
      [150, 3],
      [200, 0]
    ]);
    sustainabilityScore += resourceEfficiency;
    
    result.sustainability = clamp(sustainabilityScore);
    
    // Calculate CO2 estimate
    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442; // g CO2/kWh
    const energyPerGB = 0.81; // kWh per GB
    const co2PerView = (sizeMB / 1024) * energyPerGB * carbonIntensity;
    
    result.sustainability_details = {
      score: result.sustainability,
      co2PerView: Math.round(co2PerView * 1000) / 1000, // Round to 3 decimals
      isGreenHosted: !!responseHeaders.get('cf-ray')
    };

    // ========================================================================
    // CALCULATE P-SCORE (Research-Backed Weights)
    // ========================================================================
    // Speed (30%): Strongest correlation (1% revenue per 100ms)
    // Mobile (18%): Critical for modern commerce
    // SEO (13%): Search users convert 2-6x more
    // Interactivity (10%): UX impact
    // Accessibility (10%): Legal requirement
    // Privacy (6%): GDPR compliance
    // CDN (5%): Speed enabler
    // Page Weight (4%): Mobile data costs
    // Modern Standards (2%): Future-proofing
    // Code Quality (1%): Technical foundation
    // Sustainability (1%): ESG/brand value
    // Total: 30+18+13+10+10+6+5+4+2+1+1 = 100% ✅
    
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
    
    result.pscore = Math.round(pscore * 10) / 10; // Round to 1 decimal
    
    // Convert to credit rating
    if (result.pscore >= 95) result.rating = 'AAA';
    else if (result.pscore >= 90) result.rating = 'AA';
    else if (result.pscore >= 85) result.rating = 'A';
    else if (result.pscore >= 80) result.rating = 'BBB';
    else if (result.pscore >= 75) result.rating = 'BB';
    else if (result.pscore >= 70) result.rating = 'B';
    else if (result.pscore >= 65) result.rating = 'CCC';
    else if (result.pscore >= 60) result.rating = 'CC';
    else result.rating = 'C';
    
    // Add transparency/verification data
    result._meta = {
      scannedAt: new Date().toISOString(),
      loadTimeMs: loadTime,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
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
