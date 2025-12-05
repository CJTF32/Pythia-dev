// ============================================================================
// PYTHIA RATING ENGINE V2.0 - PHASE 2: CRUX REAL-USER DATA
// ============================================================================
// Adds Chrome User Experience Report (CrUX) data to blend real-user metrics
// with lab HTML scan for maximum accuracy.
//
// NEW IN PHASE 2:
// - Speed score capped by real LCP (Largest Contentful Paint)
// - Responsiveness upgraded from load-time proxy to real INP
// - Visual Stability (CLS) measured from real users
// - Graceful fallback to lab estimates when CrUX unavailable
//
// CrUX API: Free, unlimited, Google's official field data

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

    // ========================================================================
    // CRUX API CONFIGURATION
    // ========================================================================
    const CRUX_API_KEY = 'AIzaSyCxhwaXKjHZ0cGhF5V_klxfvpCXAeYpj94';
    const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

    // ========================================================================
    // FETCH CRUX DATA FUNCTION
    // ========================================================================
    async function fetchCruxData(targetUrl) {
      try {
        // Normalize URL to origin only
        const urlObj = new URL(targetUrl);
        const origin = `${urlObj.protocol}//${urlObj.hostname}`;

        // Validate origin format
    if (!origin.match(/^https?:\/\/[a-zA-Z0-9.-]+$/)) {
      console.log('Invalid origin format:', origin);
      return { hasData: false };
    }
        
        // Try DESKTOP first (more stable for business sites)
        let response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: origin,
            formFactor: 'DESKTOP'
          })
        });
        
        let data = await response.json();
        
        // If no desktop data, try ALL (mobile + desktop combined)
        if (!response.ok || !data.record) {
          response = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: origin,
              formFactor: 'ALL'
            })
          });
          
          data = await response.json();
        }
        
        if (!response.ok || !data.record) {
          return { hasData: false };
        }
        
        const record = data.record;
        const metrics = {};
        
        // Extract LCP (Largest Contentful Paint) - CRITICAL: values are STRINGS
        if (record.metrics?.largest_contentful_paint) {
          const lcp = record.metrics.largest_contentful_paint;
          const p75 = lcp.percentiles?.p75;
          if (p75) {
            metrics.lcp_p75_ms = parseFloat(p75); // Convert string to number
          }
        }
        
        // Extract INP (Interaction to Next Paint) - replaced FID in March 2024
        if (record.metrics?.interaction_to_next_paint) {
          const inp = record.metrics.interaction_to_next_paint;
          const p75 = inp.percentiles?.p75;
          if (p75) {
            metrics.inp_p75_ms = parseFloat(p75);
          }
        }
        
        // Extract CLS (Cumulative Layout Shift)
        if (record.metrics?.cumulative_layout_shift) {
          const cls = record.metrics.cumulative_layout_shift;
          const p75 = cls.percentiles?.p75;
          if (p75) {
            metrics.cls_p75 = parseFloat(p75); // Already 0-1 scale, no division needed
          }
        }
        
        return {
          hasData: true,
          ...metrics,
          formFactor: data.record.key?.formFactor || 'UNKNOWN'
        };
        
      } catch (error) {
        console.error('CrUX fetch error:', error);
        return { hasData: false };
      }
    }

    // ========================================================================
    // BENCHMARK DATA (same as Phase 1)
    // ========================================================================
    const BENCHMARK_DATA = {
      'AAA': { pscore: 95.0, speed: 98.0, mobile: 95.0, seo: 95.0, responsiveness: 98.0, accessibility: 95.0, privacy: 95.0, delivery: 95.0, sustainability: 90.0, loadTimeMs: 200, pageSizeMB: 0.5 },
      'AA': { pscore: 90.0, speed: 94.0, mobile: 90.0, seo: 90.0, responsiveness: 94.0, accessibility: 90.0, privacy: 90.0, delivery: 90.0, sustainability: 85.0, loadTimeMs: 350, pageSizeMB: 0.8 },
      'A': { pscore: 85.0, speed: 88.0, mobile: 85.0, seo: 85.0, responsiveness: 88.0, accessibility: 85.0, privacy: 85.0, delivery: 85.0, sustainability: 75.0, loadTimeMs: 600, pageSizeMB: 1.2 },
      'BBB': { pscore: 80.0, speed: 82.0, mobile: 78.0, seo: 80.0, responsiveness: 82.0, accessibility: 75.0, privacy: 75.0, delivery: 75.0, sustainability: 65.0, loadTimeMs: 900, pageSizeMB: 1.8 },
      'BB': { pscore: 75.0, speed: 75.0, mobile: 70.0, seo: 72.0, responsiveness: 75.0, accessibility: 68.0, privacy: 65.0, delivery: 65.0, sustainability: 55.0, loadTimeMs: 1300, pageSizeMB: 2.5 },
      'B': { pscore: 70.0, speed: 68.0, mobile: 62.0, seo: 65.0, responsiveness: 68.0, accessibility: 60.0, privacy: 55.0, delivery: 55.0, sustainability: 45.0, loadTimeMs: 1800, pageSizeMB: 3.5 },
      'CCC': { pscore: 65.0, speed: 58.0, mobile: 50.0, seo: 55.0, responsiveness: 58.0, accessibility: 50.0, privacy: 45.0, delivery: 45.0, sustainability: 35.0, loadTimeMs: 2500, pageSizeMB: 5.0 },
      'CC': { pscore: 60.0, speed: 45.0, mobile: 38.0, seo: 45.0, responsiveness: 45.0, accessibility: 40.0, privacy: 35.0, delivery: 35.0, sustainability: 25.0, loadTimeMs: 3500, pageSizeMB: 7.5 },
      'C': { pscore: 0.0, speed: 30.0, mobile: 25.0, seo: 30.0, responsiveness: 30.0, accessibility: 30.0, privacy: 25.0, delivery: 25.0, sustainability: 15.0, loadTimeMs: 6000, pageSizeMB: 12.0 }
    };

    const RATING_THRESHOLDS = {
      AAA: 95.0, AA: 90.0, A: 85.0, BBB: 80.0, BB: 75.0, B: 70.0, CCC: 65.0, CC: 60.0, C: 0.0
    };

    // ========================================================================
    // SECTOR CLASSIFIER (unchanged)
    // ========================================================================
    const SECTOR_RULES = {
      'Technology & Software': {
        keywords: ['facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'reddit', 'tiktok', 'snapchat', 'pinterest', 'tumblr', 'discord', 'telegram', 'google', 'microsoft', 'apple', 'amazon', 'meta', 'github', 'gitlab', 'stackoverflow', 'bitbucket', 'slack', 'zoom', 'dropbox', 'adobe', 'salesforce', 'atlassian', 'notion', 'figma', 'canva', 'asana', 'spotify', 'soundcloud', 'twitch', 'youtube', 'cloud', 'aws', 'azure', 'cloudflare', 'software', 'saas', 'platform', 'app'],
        tldPatterns: ['.io', '.dev', '.app', '.cloud', '.tech']
      },
      'E-commerce & Retail': { keywords: ['amazon', 'ebay', 'alibaba', 'aliexpress', 'walmart', 'target', 'etsy', 'shop', 'store', 'buy', 'cart', 'checkout', 'shopping', 'retail', 'marketplace', 'mall', 'outlet', 'ecommerce'] },
      'Media & Entertainment': { keywords: ['netflix', 'youtube', 'hulu', 'disney', 'hbo', 'cnn', 'bbc', 'nytimes', 'guardian', 'reuters', 'forbes', 'espn', 'nba', 'nfl', 'news', 'media', 'video', 'stream', 'tv', 'entertainment', 'music', 'podcast', 'radio'] },
      'Financial Services': { keywords: ['bank', 'chase', 'wellsfargo', 'citi', 'hsbc', 'paypal', 'stripe', 'square', 'visa', 'mastercard', 'fidelity', 'vanguard', 'schwab', 'robinhood', 'coinbase', 'binance', 'crypto', 'bitcoin', 'finance', 'invest', 'trading', 'capital', 'credit', 'loan', 'mortgage', 'insurance'] },
      'Education': { keywords: ['university', 'college', 'school', 'institute', 'academy', 'coursera', 'udemy', 'khan', 'edx', 'education', 'learning', 'course', 'study', 'academic'], tldPatterns: ['.edu', '.ac.uk', '.edu.au'] },
      'Healthcare': { keywords: ['mayo', 'cleveland clinic', 'kaiser', 'webmd', 'healthline', 'nih', 'cdc', 'who', 'health', 'medical', 'hospital', 'clinic', 'doctor', 'pharma', 'medicine', 'patient', 'care'] },
      'Government': { keywords: ['government', 'state', 'federal', 'senate', 'congress'], tldPatterns: ['.gov', '.gov.uk', '.gov.au'] },
      'Travel & Hospitality': { keywords: ['booking', 'expedia', 'airbnb', 'tripadvisor', 'hotels', 'travel', 'flight', 'hotel', 'vacation', 'trip', 'airline'] },
      'Food & Beverage': { keywords: ['ubereats', 'doordash', 'grubhub', 'deliveroo', 'mcdonalds', 'starbucks', 'dominos', 'restaurant', 'food', 'delivery', 'menu', 'recipe'] },
      'Gaming': { keywords: ['steam', 'epic games', 'playstation', 'xbox', 'nintendo', 'game', 'gaming', 'esports', 'gamer'] }
    };

    function classifySector(domain) {
      const domainLower = domain.toLowerCase();
      for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
        if (rules.keywords?.some(kw => domainLower.includes(kw))) return sector;
        if (rules.tldPatterns?.some(tld => domainLower.endsWith(tld))) return sector;
      }
      return 'General';
    }

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================
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

    // ========================================================================
    // FETCH & ANALYZE WEBSITE (same as Phase 1)
    // ========================================================================
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const BASELINE_NETWORK_LATENCY = 200;
    const startTime = Date.now();
    let response, rawLoadTime, html;

    try {
      response = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000)
      });
      rawLoadTime = Date.now() - startTime;
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          return new Response(JSON.stringify({ error: 'BLOCKED_SCAN', message: 'This site blocks automated scans. Request a manual scan.', status: response.status }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: `Failed to fetch: ${response.status}` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      html = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return new Response(JSON.stringify({ error: 'TIMEOUT', message: 'Site took too long to respond' }), { status: 504, headers: { 'Content-Type': 'application/json' } });
      }
      throw error;
    }

    const responseHeaders = response.headers;
    const sizeBytes = new Blob([html]).size;
    const sizeMB = sizeBytes / (1024 * 1024);
    const loadTime = Math.max(0, rawLoadTime - BASELINE_NETWORK_LATENCY);

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
    const isLoginPage = /login|signin|auth|account/i.test(targetUrl);
    const result = {};

    // ========================================================================
    // CALCULATE LAB SCORES (same as Phase 1)
    // ========================================================================
    
    // 1. Speed
    const adjustedLoadTime = Math.max(0, loadTime);
    const speedScore = smoothScore(adjustedLoadTime, [
      [0, 100], [100, 97], [200, 94], [300, 91], [400, 88],
      [500, 85], [600, 82], [800, 76], [1000, 70], [1500, 58],
      [2000, 46], [3000, 30], [5000, 15], [10000, 0]
    ]);
    result.speed = Math.round(speedScore * 10) / 10;

    // 2. Mobile
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

    // 3. SEO
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

    // 4. Responsiveness (lab estimate - will be upgraded with CrUX INP)
    const responsivenessScore = smoothScore(loadTime, [
      [0, 100], [50, 98], [100, 96], [200, 93], [300, 90],
      [500, 85], [800, 78], [1000, 72], [1500, 62], [2000, 52],
      [3000, 38], [5000, 18], [10000, 0]
    ]);
    result.responsiveness = Math.round(responsivenessScore * 10) / 10;

    // 5. Accessibility
    let accessibilityScore = 15;
    if (analysis.hasAltText) accessibilityScore += 38;
    if (analysis.hasAriaLabels) accessibilityScore += 32;
    if (analysis.hasViewport) accessibilityScore += 10;
    if (/<h[1-6]/i.test(html)) accessibilityScore += 5;
    result.accessibility = Math.round(accessibilityScore * 10) / 10;

    // 6. Privacy
    let privacyScore = 0;
    if (analysis.hasHTTPS) privacyScore += 35;
    if (analysis.hasCSP) privacyScore += 22;
    if (analysis.hasXFrameOptions) privacyScore += 16;
    if (analysis.hasHSTS) privacyScore += 18;
    if (analysis.hasPermissionsPolicy) privacyScore += 9;
    result.privacy = Math.round(privacyScore * 10) / 10;

    // 7. Delivery
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

    // 8. Sustainability
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
    // PHASE 2: FETCH CRUX DATA & BLEND WITH LAB SCORES
    // ========================================================================
    const cruxData = await fetchCruxData(targetUrl);
    result.crux = cruxData;

    if (cruxData.hasData) {
      // UPGRADE 1: Speed - cap based on real LCP
      if (cruxData.lcp_p75_ms) {
        if (cruxData.lcp_p75_ms > 4000) {
          // Site is actually very slow to real users
          result.speed = Math.min(result.speed, 60);
        } else if (cruxData.lcp_p75_ms > 2500) {
          // Site is slow to real users
          result.speed = Math.min(result.speed, 80);
        }
        // else: lab and field agree site is fast, no cap needed
      }

      // UPGRADE 2: Responsiveness - replace lab estimate with real INP
      if (cruxData.inp_p75_ms !== undefined && cruxData.inp_p75_ms !== null) {
        const inp = cruxData.inp_p75_ms;
        if (inp <= 100) result.responsiveness = 100;
        else if (inp <= 200) result.responsiveness = 90;
        else if (inp <= 300) result.responsiveness = 70;
        else if (inp <= 500) result.responsiveness = 50;
        else result.responsiveness = 20;
      }
    }

    // ========================================================================
    // CALCULATE FINAL P-SCORE (with CrUX adjustments if available)
    // ========================================================================
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

    // ========================================================================
    // ASSIGN RATING
    // ========================================================================
    if (result.pscore >= RATING_THRESHOLDS.AAA) result.rating = 'AAA';
    else if (result.pscore >= RATING_THRESHOLDS.AA) result.rating = 'AA';
    else if (result.pscore >= RATING_THRESHOLDS.A) result.rating = 'A';
    else if (result.pscore >= RATING_THRESHOLDS.BBB) result.rating = 'BBB';
    else if (result.pscore >= RATING_THRESHOLDS.BB) result.rating = 'BB';
    else if (result.pscore >= RATING_THRESHOLDS.B) result.rating = 'B';
    else if (result.pscore >= RATING_THRESHOLDS.CCC) result.rating = 'CCC';
    else if (result.pscore >= RATING_THRESHOLDS.CC) result.rating = 'CC';
    else result.rating = 'C';

    // ========================================================================
    // METADATA
    // ========================================================================
    result._meta = {
      scannedAt: new Date().toISOString(),
      version: '2.0-phase2',
      loadTimeMs: Math.round(rawLoadTime),
      loadTimeAdjusted: Math.round(loadTime),
      networkLatencySubtracted: BASELINE_NETWORK_LATENCY,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      sector: sector,
      isLoginPage: isLoginPage,
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
      },
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
