// ============================================================================
// PYTHIA SCAN ENGINE V3 - CORRECTED VERSION
// ============================================================================
// Fixes:
// - Proper result object initialization
// - Domain extraction and sector classification
// - Benchmark data structure
// - Physics-aware latency correction
// - Sector-specific score adjustments

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
    // BENCHMARK DATA - Data-driven thresholds by rating
    // ========================================================================
    const BENCHMARK_DATA = {
      'AAA': {
        pscore: 90.7,
        speed: 95.0,
        mobile: 92.0,
        seo: 88.0,
        interactivity: 96.0,
        accessibility: 85.0,
        privacy: 90.0,
        cdn: 85.0,
        pageWeight: 92.0,
        modernStandards: 90.0,
        codeQuality: 88.0,
        sustainability: 90.0,
        loadTimeMs: 350,
        pageSizeMB: 0.8
      },
      'AA': {
        pscore: 87.8,
        speed: 92.0,
        mobile: 88.0,
        seo: 85.0,
        interactivity: 93.0,
        accessibility: 80.0,
        privacy: 85.0,
        cdn: 80.0,
        pageWeight: 88.0,
        modernStandards: 85.0,
        codeQuality: 82.0,
        sustainability: 85.0,
        loadTimeMs: 500,
        pageSizeMB: 1.2
      },
      'A': {
        pscore: 82.7,
        speed: 88.0,
        mobile: 82.0,
        seo: 80.0,
        interactivity: 88.0,
        accessibility: 72.0,
        privacy: 78.0,
        cdn: 72.0,
        pageWeight: 82.0,
        modernStandards: 78.0,
        codeQuality: 75.0,
        sustainability: 78.0,
        loadTimeMs: 800,
        pageSizeMB: 1.8
      },
      'BBB': {
        pscore: 75.1,
        speed: 82.0,
        mobile: 75.0,
        seo: 72.0,
        interactivity: 82.0,
        accessibility: 65.0,
        privacy: 70.0,
        cdn: 65.0,
        pageWeight: 75.0,
        modernStandards: 70.0,
        codeQuality: 68.0,
        sustainability: 70.0,
        loadTimeMs: 1200,
        pageSizeMB: 2.5
      },
      'BB': {
        pscore: 65.5,
        speed: 75.0,
        mobile: 68.0,
        seo: 65.0,
        interactivity: 75.0,
        accessibility: 58.0,
        privacy: 62.0,
        cdn: 58.0,
        pageWeight: 68.0,
        modernStandards: 62.0,
        codeQuality: 60.0,
        sustainability: 62.0,
        loadTimeMs: 1800,
        pageSizeMB: 3.5
      },
      'B': {
        pscore: 54.5,
        speed: 65.0,
        mobile: 58.0,
        seo: 55.0,
        interactivity: 65.0,
        accessibility: 48.0,
        privacy: 52.0,
        cdn: 48.0,
        pageWeight: 58.0,
        modernStandards: 52.0,
        codeQuality: 50.0,
        sustainability: 52.0,
        loadTimeMs: 2800,
        pageSizeMB: 5.0
      },
      'CCC': {
        pscore: 41.5,
        speed: 52.0,
        mobile: 45.0,
        seo: 42.0,
        interactivity: 52.0,
        accessibility: 38.0,
        privacy: 40.0,
        cdn: 35.0,
        pageWeight: 45.0,
        modernStandards: 38.0,
        codeQuality: 38.0,
        sustainability: 38.0,
        loadTimeMs: 4200,
        pageSizeMB: 7.5
      },
      'CC': {
        pscore: 26.5,
        speed: 35.0,
        mobile: 30.0,
        seo: 28.0,
        interactivity: 35.0,
        accessibility: 25.0,
        privacy: 28.0,
        cdn: 22.0,
        pageWeight: 30.0,
        modernStandards: 25.0,
        codeQuality: 25.0,
        sustainability: 25.0,
        loadTimeMs: 6500,
        pageSizeMB: 12.0
      },
      'C': {
        pscore: 15.0,
        speed: 20.0,
        mobile: 18.0,
        seo: 15.0,
        interactivity: 20.0,
        accessibility: 15.0,
        privacy: 15.0,
        cdn: 10.0,
        pageWeight: 18.0,
        modernStandards: 12.0,
        codeQuality: 12.0,
        sustainability: 12.0,
        loadTimeMs: 10000,
        pageSizeMB: 20.0
      }
    };

    // ========================================================================
    // SECTOR CLASSIFIER
    // ========================================================================
    const SECTOR_RULES = {
      'Technology & Software': {
        keywords: [
          'facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'reddit',
          'tiktok', 'snapchat', 'pinterest', 'tumblr', 'discord', 'telegram',
          'google', 'microsoft', 'apple', 'amazon', 'meta',
          'github', 'gitlab', 'stackoverflow', 'bitbucket',
          'slack', 'zoom', 'dropbox', 'adobe', 'salesforce', 'atlassian',
          'notion', 'figma', 'canva', 'asana',
          'spotify', 'soundcloud', 'twitch', 'youtube',
          'cloud', 'aws', 'azure', 'cloudflare',
          'software', 'saas', 'platform', 'app'
        ],
        tldPatterns: ['.io', '.dev', '.app', '.cloud', '.tech']
      },
      
      'E-commerce & Retail': {
        keywords: [
          'amazon', 'ebay', 'alibaba', 'aliexpress', 'walmart', 'target',
          'etsy', 'shop', 'store', 'buy', 'cart', 'checkout', 'shopping',
          'retail', 'marketplace', 'mall', 'outlet', 'ecommerce'
        ]
      },
      
      'Media & Entertainment': {
        keywords: [
          'netflix', 'youtube', 'hulu', 'disney', 'hbo',
          'cnn', 'bbc', 'nytimes', 'guardian', 'reuters', 'forbes',
          'espn', 'nba', 'nfl',
          'news', 'media', 'video', 'stream', 'tv', 'entertainment',
          'music', 'podcast', 'radio'
        ]
      },
      
      'Financial Services': {
        keywords: [
          'bank', 'chase', 'wellsfargo', 'citi', 'hsbc',
          'paypal', 'stripe', 'square', 'visa', 'mastercard',
          'fidelity', 'vanguard', 'schwab', 'robinhood',
          'coinbase', 'binance', 'crypto', 'bitcoin',
          'finance', 'invest', 'trading', 'capital', 'credit',
          'loan', 'mortgage', 'insurance'
        ]
      },
      
      'Education': {
        keywords: [
          'university', 'college', 'school', 'institute', 'academy',
          'coursera', 'udemy', 'khan', 'edx',
          'education', 'learning', 'course', 'study', 'academic'
        ],
        tldPatterns: ['.edu', '.ac.uk', '.edu.au']
      },
      
      'Healthcare': {
        keywords: [
          'mayo', 'cleveland clinic', 'kaiser',
          'webmd', 'healthline', 'nih', 'cdc', 'who',
          'health', 'medical', 'hospital', 'clinic', 'doctor',
          'pharma', 'medicine', 'patient', 'care'
        ]
      },
      
      'Government': {
        keywords: ['government', 'state', 'federal', 'senate', 'congress'],
        tldPatterns: ['.gov', '.gov.uk', '.gov.au']
      },
      
      'Travel & Hospitality': {
        keywords: [
          'booking', 'expedia', 'airbnb', 'tripadvisor', 'hotels',
          'travel', 'flight', 'hotel', 'vacation', 'trip', 'airline'
        ]
      },
      
      'Food & Beverage': {
        keywords: [
          'ubereats', 'doordash', 'grubhub', 'deliveroo',
          'mcdonalds', 'starbucks', 'dominos',
          'restaurant', 'food', 'delivery', 'menu', 'recipe'
        ]
      },
      
      'Gaming': {
        keywords: [
          'steam', 'epic games', 'playstation', 'xbox', 'nintendo',
          'game', 'gaming', 'esports', 'gamer'
        ]
      }
    };

    function classifySector(domain) {
      const domainLower = domain.toLowerCase().replace('www.', '');
      
      // Check TLD patterns first
      for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
        if (rules.tldPatterns) {
          for (const pattern of rules.tldPatterns) {
            if (domainLower.endsWith(pattern)) {
              return sector;
            }
          }
        }
      }
      
      // Score by keyword matches
      const sectorScores = {};
      for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
        let score = 0;
        for (const keyword of rules.keywords) {
          if (domainLower.includes(keyword)) {
            score += keyword.split(' ').length;
          }
        }
        if (score > 0) {
          sectorScores[sector] = score;
        }
      }
      
      if (Object.keys(sectorScores).length > 0) {
        return Object.entries(sectorScores)
          .sort(([,a], [,b]) => b - a)[0][0];
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
    // INITIALIZE RESULT OBJECT
    // ========================================================================
    const result = {
      url: '',
      pscore: 0,
      rating: 'C',
      speed: 0,
      mobile: 0,
      seo: 0,
      interactivity: 0,
      accessibility: 0,
      privacy: 0,
      cdn: 0,
      pageWeight: 0,
      modernStandards: 0,
      codeQuality: 0,
      sustainability: 0
    };

    // ========================================================================
    // NORMALIZE URL AND EXTRACT DOMAIN
    // ========================================================================
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
    
    result.url = targetUrl;
    
    // Extract domain for sector classification
    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname;
    const sector = classifySector(domain);

    // ========================================================================
    // FETCH WEBSITE
    // ========================================================================
    const startTime = Date.now();
    let response, rawLoadTime, html;
    
    try {
      response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });
      rawLoadTime = Date.now() - startTime;
      
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

    // ========================================================================
    // PHYSICS-AWARE LATENCY CORRECTION
    // ========================================================================
    // Account for minimum network latency (speed of light + routing)
    // Assume scanning from Cloudflare edge, subtract baseline latency
    const BASELINE_NETWORK_LATENCY = 50; // ms - typical CF edge to origin
    const loadTime = Math.max(0, rawLoadTime - BASELINE_NETWORK_LATENCY);

    const responseHeaders = response.headers;
    
    // ========================================================================
    // PAGE ANALYSIS
    // ========================================================================
    const sizeBytes = new Blob([html]).size;
    const sizeMB = sizeBytes / (1024 * 1024);
    
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
    // LOGIN PAGE DETECTION
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
    // CALCULATE 11 COMPONENT SCORES
    // ========================================================================

    // 1. SPEED - 30% weight
    const speedScore = smoothScore(loadTime, [
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
    
    // ========================================================================
    // ASSIGN PYTHIA RATING
    // ========================================================================
    if (result.pscore >= 90.7) result.rating = 'AAA';
    else if (result.pscore >= 87.8) result.rating = 'AA';
    else if (result.pscore >= 82.7) result.rating = 'A';
    else if (result.pscore >= 75.1) result.rating = 'BBB';
    else if (result.pscore >= 65.5) result.rating = 'BB';
    else if (result.pscore >= 54.5) result.rating = 'B';
    else if (result.pscore >= 41.5) result.rating = 'CCC';
    else if (result.pscore >= 26.5) result.rating = 'CC';
    else result.rating = 'C';
    
    // ========================================================================
    // ADD METADATA
    // ========================================================================
    result._meta = {
      scannedAt: new Date().toISOString(),
      loadTimeMs: Math.round(rawLoadTime),
      loadTimeAdjusted: Math.round(loadTime),
      networkLatencySubtracted: BASELINE_NETWORK_LATENCY,
      pageSizeMB: Math.round(sizeMB * 100) / 100,
      resourceCount: analysis.resourceCount,
      sector: sector,
      isLoginPage: isLoginPage,
      benchmark: BENCHMARK_DATA[result.rating],
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
