// Pythia Scan Engine - REVISED WITH CORRECT WEIGHTS & GRANULAR SCORING
// Fixed: Weights now sum to 100%, granular continuous scoring

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Only POST allowed' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const { url, sector } = await context.request.json();
    
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const hostname = new URL(fullUrl).hostname.replace('www.', '');
    const timestamp = new Date().toISOString();
    
    // ============================================================================
    // STEP 1: CHECK D1 CACHE (24 hour TTL)
    // ============================================================================
    if (context.env.DB) {
      try {
        const cached = await context.env.DB.prepare(
          `SELECT * FROM precomputed_scores 
           WHERE hostname = ?
           AND datetime(last_updated) > datetime('now', '-24 hours')`
        ).bind(hostname).first();
        
        if (cached) {
          const scoreData = JSON.parse(cached.score_data);
          return new Response(JSON.stringify({
            ...scoreData,
            cached: true,
            cacheAge: cached.last_updated
          }), {
            status: 200,
            headers: corsHeaders
          });
        }
      } catch (e) {
        console.error('D1 lookup failed:', e);
      }
    }
    
    // ============================================================================
    // STEP 2: HTTP FETCH
    // ============================================================================
    let html = '';
    let responseHeaders = new Headers();
    let loadTime = 0;
    let ttfb = 0;
    let scanMethod = 'fetch';
    let finalUrl = fullUrl;
    
    const fetchStart = Date.now();
    
    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      ttfb = Date.now() - fetchStart;
      responseHeaders = response.headers;
      finalUrl = response.url;
      html = await response.text();
      loadTime = Date.now() - fetchStart;
      
      if (!response.ok && response.status !== 403 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}`);
      }
      
    } catch (fetchError) {
      // Try browser rendering if available
      if (context.env.MYBROWSER) {
        try {
          scanMethod = 'browser';
          const { default: puppeteer } = await import('@cloudflare/puppeteer');
          
          const browserStart = Date.now();
          const browser = await puppeteer.launch(context.env.MYBROWSER);
          const page = await browser.newPage();
          
          await page.setViewport({ width: 1920, height: 1080 });
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          
          html = await page.content();
          finalUrl = page.url();
          ttfb = Date.now() - browserStart;
          loadTime = ttfb;
          
          await browser.close();
          
        } catch (browserError) {
          return new Response(JSON.stringify({
            error: 'Scan failed',
            details: 'Site blocked automated scanning',
            hostname,
            timestamp
          }), {
            status: 503,
            headers: corsHeaders
          });
        }
      } else {
        return new Response(JSON.stringify({
          error: 'Scan failed',
          details: fetchError.message,
          hostname,
          timestamp
        }), {
          status: 503,
          headers: corsHeaders
        });
      }
    }
    
    // ============================================================================
    // STEP 3: ANALYZE HTML (Server-Side Compatible)
    // ============================================================================
    
    const analysis = {
      // Meta tags
      hasViewport: /<meta[^>]*name=["']viewport["']/i.test(html),
      hasDescription: /<meta[^>]*name=["']description["']/i.test(html),
      hasTitle: /<title[^>]*>([^<]+)<\/title>/i.test(html),
      titleMatch: html.match(/<title[^>]*>([^<]+)<\/title>/i),
      hasH1: /<h1[^>]*>/i.test(html),
      hasStructuredData: /<script[^>]*type=["']application\/ld\+json["']/i.test(html),
      hasCanonical: /<link[^>]*rel=["']canonical["']/i.test(html),
      
      // Open Graph
      ogTags: (html.match(/<meta[^>]*property=["']og:/gi) || []).length,
      
      // Resources
      scriptCount: (html.match(/<script[^>]*>/gi) || []).length,
      cssCount: (html.match(/<link[^>]*rel=["']stylesheet["']/gi) || []).length,
      imgCount: (html.match(/<img[^>]*>/gi) || []).length,
      
      // Blocking resources
      blockingScripts: (html.match(/<script(?![^>]*(?:async|defer))[^>]*src=/gi) || []).length,
      blockingCSS: (html.match(/<link[^>]*rel=["']stylesheet["'](?![^>]*media=["']print["'])[^>]*>/gi) || []).length,
      
      // Modern features
      hasWebP: /\.webp["']/i.test(html),
      hasAVIF: /\.avif["']/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      
      // Accessibility
      hasAlt: /<img[^>]*alt=/i.test(html),
      hasAriaLabels: /aria-label=/i.test(html),
      hasLang: /<html[^>]*lang=/i.test(html),
      
      // Security
      hasHTTPS: fullUrl.startsWith('https://'),
      
      // Third-party
      hasGoogleAnalytics: /google-analytics\.com|googletagmanager\.com/i.test(html),
      hasFacebookPixel: /facebook\.com\/tr\?id=/i.test(html),
      thirdPartyCount: (html.match(/google-analytics|googletagmanager|facebook\.com|doubleclick|connect\.facebook|googleadservices/gi) || []).length,
      
      // Size
      contentLength: html.length,
      sizeMB: html.length / (1024 * 1024),
      
      // Total resources
      resourceCount: (html.match(/<script[^>]*>/gi) || []).length + 
                     (html.match(/<link[^>]*>/gi) || []).length +
                     (html.match(/<img[^>]*>/gi) || []).length
    };
    
    // Title analysis
    const titleLength = analysis.titleMatch ? analysis.titleMatch[1].length : 0;
    
    // ============================================================================
    // STEP 4: CALCULATE SCORES (GRANULAR & CONTINUOUS)
    // ============================================================================
    
    // Helper: Smooth interpolation between points
    function smoothScore(value, points) {
      // points = [[threshold, score], [threshold, score], ...]
      // Returns continuous score between points
      for (let i = 0; i < points.length - 1; i++) {
        const [t1, s1] = points[i];
        const [t2, s2] = points[i + 1];
        if (value >= t1 && value <= t2) {
          const ratio = (value - t1) / (t2 - t1);
          return s1 + (s2 - s1) * ratio;
        }
      }
      // Before first or after last point
      if (value < points[0][0]) return points[0][1];
      return points[points.length - 1][1];
    }
    
    // Helper: Clamp to 0-100
    function clamp(score) {
      return Math.max(0, Math.min(100, score));
    }
    
    const result = {};
    
    // 1. KARPOV: Speed (25% weight) - Physics-Aware
    const renderingTime = Math.max(0, loadTime - ttfb);
    
    // Score TTFB (continuous, not discrete)
    const ttfbScore = smoothScore(ttfb, [
      [0, 100],      // 0ms = perfect
      [100, 95],     // 100ms = excellent
      [200, 90],     // 200ms = great
      [400, 75],     // 400ms = good
      [600, 60],     // 600ms = acceptable
      [800, 45],     // 800ms = slow
      [1000, 30],    // 1s = poor
      [2000, 10],    // 2s = very poor
      [5000, 0]      // 5s+ = failure
    ]);
    
    // Adjust rendering for blocking resources (granular penalties)
    let adjustedRenderTime = renderingTime;
    adjustedRenderTime += (analysis.blockingScripts * 75);  // More granular
    adjustedRenderTime += (analysis.blockingCSS * 40);
    
    // Score rendering (continuous curve)
    const RENDER_BASELINE = scanMethod === 'browser' ? 1500 : 800;
    const renderScore = smoothScore(adjustedRenderTime, [
      [0, 100],
      [RENDER_BASELINE * 0.5, 100],    // Half baseline = perfect
      [RENDER_BASELINE, 90],            // At baseline = great
      [RENDER_BASELINE * 1.5, 75],     // 1.5x baseline = good
      [RENDER_BASELINE * 2, 60],       // 2x baseline = acceptable
      [RENDER_BASELINE * 3, 40],       // 3x baseline = poor
      [RENDER_BASELINE * 5, 20],       // 5x baseline = very poor
      [RENDER_BASELINE * 8, 5],        // 8x baseline = critical
      [RENDER_BASELINE * 10, 0]        // 10x+ baseline = failure
    ]);
    
    // Composite: 65% rendering (controllable) + 35% network (infrastructure)
    result.karpov = clamp((renderScore * 0.65) + (ttfbScore * 0.35));
    
    // 2. TYCHE: Interactivity (18% weight) - Granular penalties
    let tycheScore = 100; // Start at perfect
    
    // Third-party scripts (exponential penalty for many trackers)
    tycheScore -= analysis.thirdPartyCount * 3.5;
    
    // Blocking scripts (severe penalty)
    tycheScore -= analysis.blockingScripts * 4.2;
    
    // Resource count penalty (too many resources slow interactivity)
    if (analysis.resourceCount > 150) {
      tycheScore -= (analysis.resourceCount - 150) * 0.15;
    }
    
    result.tyche = clamp(tycheScore);
    
    // 3. VORTEX: Accessibility (15% weight) - Granular scoring
    let vortexScore = 0;
    
    // Images with alt text (critical)
    if (analysis.imgCount > 0) {
      vortexScore += analysis.hasAlt ? 22 : 0;
    } else {
      vortexScore += 10; // Bonus for no images (no accessibility issues)
    }
    
    // ARIA labels (important for screen readers)
    if (analysis.hasAriaLabels) vortexScore += 20;
    
    // Language attribute (required for screen readers)
    if (analysis.hasLang) vortexScore += 18;
    
    // Heading structure (critical for navigation)
    if (analysis.hasH1) vortexScore += 16;
    
    // Title (screen reader announcement)
    if (analysis.hasTitle) vortexScore += 14;
    
    // Bonus for good viewport (mobile accessibility)
    if (analysis.hasViewport) vortexScore += 10;
    
    result.vortex = clamp(vortexScore);
    
    // 4. NEXUS: Mobile (12% weight) - Granular mobile scoring
    let nexusScore = 0;
    
    // Viewport (essential for mobile)
    if (analysis.hasViewport) nexusScore += 35;
    
    // Image optimization for mobile
    if (analysis.imgCount > 0 && analysis.hasAlt) nexusScore += 15;
    if (analysis.hasLazyLoading) nexusScore += 18;
    if (analysis.hasWebP || analysis.hasAVIF) nexusScore += 12;
    
    // Mobile speed (continuous scoring)
    const mobileSpeed = smoothScore(loadTime, [
      [0, 20],
      [1000, 20],    // <1s = perfect
      [2000, 15],    // <2s = good
      [3000, 10],    // <3s = acceptable
      [4000, 5],     // <4s = poor
      [5000, 0]      // 5s+ = failure
    ]);
    nexusScore += mobileSpeed;
    
    result.nexus = clamp(nexusScore);
    
    // 5. HELIX: Privacy (10% weight) - Granular privacy scoring
    let helixScore = 50; // Baseline
    
    // HTTPS (essential)
    if (analysis.hasHTTPS) helixScore += 25;
    
    // No Google Analytics (privacy-focused)
    if (!analysis.hasGoogleAnalytics) helixScore += 12.5;
    
    // No Facebook Pixel (privacy-focused)
    if (!analysis.hasFacebookPixel) helixScore += 12.5;
    
    // Fewer third-party trackers = better privacy
    const trackerPenalty = Math.min(25, analysis.thirdPartyCount * 2.5);
    helixScore -= trackerPenalty;
    
    result.helix = clamp(helixScore);
    
    // 6. PULSE: SEO (10% weight) - Granular SEO scoring
    let pulseScore = 0;
    
    // Title tag (critical)
    if (analysis.hasTitle) {
      pulseScore += 18;
      // Title length optimization (continuous curve)
      if (titleLength > 0) {
        const titleQuality = smoothScore(titleLength, [
          [0, 0],
          [20, 5],     // Too short
          [30, 10],    // Good start
          [50, 12],    // Optimal
          [60, 10],    // Good end
          [70, 5],     // Too long
          [100, 0]     // Way too long
        ]);
        pulseScore += titleQuality;
      }
    }
    
    // Meta description (important)
    if (analysis.hasDescription) pulseScore += 18;
    
    // Structured data (important for rich snippets)
    if (analysis.hasStructuredData) pulseScore += 15;
    
    // Canonical (important for duplicate content)
    if (analysis.hasCanonical) pulseScore += 12;
    
    // Open Graph tags (social media optimization)
    const ogScore = smoothScore(analysis.ogTags, [
      [0, 0],
      [4, 10],    // Basic OG tags
      [8, 12],    // Comprehensive OG
      [15, 12]    // Lots of OG (no more benefit)
    ]);
    pulseScore += ogScore;
    
    // Core Web Vitals correlation (speed helps SEO)
    if (result.karpov >= 80) pulseScore += 8;
    else if (result.karpov >= 60) pulseScore += 4;
    
    result.pulse = clamp(pulseScore);
    
    // 7. NOVA: CDN & Caching (7% weight) - Granular infrastructure scoring
    let novaScore = 0;
    
    // CDN detection (major performance boost)
    const isCDN = responseHeaders.get('cf-ray') || 
                  responseHeaders.get('x-cache') || 
                  responseHeaders.get('x-amz-cf-id');
    if (isCDN) novaScore += 45;
    
    // Cache headers (important for repeat visits)
    const cacheControl = responseHeaders.get('cache-control');
    if (cacheControl) {
      novaScore += 30;
      // Bonus for good cache directives
      if (cacheControl.includes('max-age=')) novaScore += 5;
    }
    
    // Compression (critical for bandwidth)
    const compression = responseHeaders.get('content-encoding');
    if (compression === 'br') novaScore += 20;       // Brotli = best
    else if (compression === 'gzip') novaScore += 15; // Gzip = good
    else if (compression) novaScore += 10;            // Some compression
    
    result.nova = clamp(novaScore);
    
    // 8. EDEN: Page Weight (6% weight) - Continuous weight penalty
    const edenScore = smoothScore(analysis.sizeMB, [
      [0, 100],      // 0 MB = perfect
      [0.5, 95],     // 500 KB = excellent
      [1, 90],       // 1 MB = great
      [2, 80],       // 2 MB = good
      [3, 70],       // 3 MB = acceptable
      [5, 50],       // 5 MB = heavy
      [10, 25],      // 10 MB = very heavy
      [20, 10],      // 20 MB = bloated
      [50, 0]        // 50+ MB = failure
    ]);
    
    result.eden = clamp(edenScore);
    
    // 9. AETHER: Modern Tech (4% weight) - Granular modern features
    let aetherScore = 0;
    
    // Next-gen image formats
    if (analysis.hasAVIF) aetherScore += 35;       // AVIF = cutting edge
    else if (analysis.hasWebP) aetherScore += 30;  // WebP = modern
    
    // Lazy loading (modern performance technique)
    if (analysis.hasLazyLoading) aetherScore += 30;
    
    // Modern viewport (responsive design)
    if (analysis.hasViewport) aetherScore += 20;
    
    // Structured data (modern SEO)
    if (analysis.hasStructuredData) aetherScore += 15;
    
    result.aether = clamp(aetherScore);
    
    // 10. QUANTUM: Code Quality (3% weight) - Granular code quality
    let quantumScore = 60; // Baseline for working code
    
    // No blocking scripts (best practice)
    if (analysis.blockingScripts === 0) {
      quantumScore += 20;
    } else {
      // Gradual penalty for blocking scripts
      quantumScore -= Math.min(20, analysis.blockingScripts * 3);
    }
    
    // No blocking CSS (best practice)
    if (analysis.blockingCSS === 0) {
      quantumScore += 20;
    } else {
      // Gradual penalty for blocking CSS
      quantumScore -= Math.min(15, analysis.blockingCSS * 2.5);
    }
    
    // Bonus for lean codebase
    if (analysis.resourceCount < 50) quantumScore += 10;
    else if (analysis.resourceCount > 150) quantumScore -= Math.min(10, (analysis.resourceCount - 150) * 0.1);
    
    result.quantum = clamp(quantumScore);
    
    // 11. ECHO: Sustainability (1% weight) - Environmental impact
    // Based on Sustainable Web Design methodology and Green Web Foundation research
    let echoScore = 0;
    
    // 1. Page Weight Efficiency (40 points max)
    // Based on 2.4 MB global average threshold
    const weightScore = smoothScore(analysis.sizeMB, [
      [0, 40],       // 0 MB = perfect
      [0.5, 38],     // 500 KB = excellent
      [1, 35],       // 1 MB = great
      [2, 28],       // 2 MB = good
      [2.4, 25],     // 2.4 MB = global average
      [3, 20],       // 3 MB = above average
      [5, 10],       // 5 MB = heavy
      [10, 5],       // 10 MB = very heavy
      [20, 2],       // 20 MB = bloated
      [50, 0]        // 50+ MB = failure
    ]);
    echoScore += weightScore;
    
    // 2. Green Hosting Detection (25 points max)
    // Cloudflare = renewable energy commitment
    // AWS/GCP regions vary, but generally moving to renewable
    const cdnHeaders = responseHeaders.get('cf-ray') || 
                       responseHeaders.get('x-amz-cf-id') || 
                       responseHeaders.get('x-cache');
    
    if (responseHeaders.get('cf-ray')) {
      // Cloudflare uses renewable energy
      echoScore += 25;
    } else if (cdnHeaders) {
      // Other CDNs may use some renewable energy
      echoScore += 15;
    }
    
    // Bonus for cache headers (reduces repeat energy use)
    if (responseHeaders.get('cache-control')) {
      echoScore += 5;
    }
    
    // 3. Image Optimization (20 points max)
    if (analysis.hasAVIF) {
      echoScore += 20; // AVIF = best compression
    } else if (analysis.hasWebP) {
      echoScore += 15; // WebP = modern compression
    }
    
    // Lazy loading reduces initial energy use
    if (analysis.hasLazyLoading) {
      echoScore += 10;
    }
    
    // 4. Resource Efficiency (15 points max)
    // Fewer resources = less energy to transfer and process
    const resourceEfficiency = smoothScore(analysis.resourceCount, [
      [0, 15],
      [25, 15],    // Very lean
      [50, 12],    // Lean
      [100, 8],    // Moderate
      [150, 3],    // Heavy
      [200, 0]     // Bloated
    ]);
    echoScore += resourceEfficiency;
    
    result.echo = clamp(echoScore);
    
    // Calculate CO2 estimate (for informational purposes)
    // Formula from Sustainable Web Design: 0.81 kWh per GB × carbon intensity
    const carbonIntensity = responseHeaders.get('cf-ray') ? 50 : 442; // g CO2 per kWh
    const co2PerView = (analysis.sizeMB * 0.81 * carbonIntensity) / 1000; // Convert to grams
    
    // ============================================================================
    // STEP 5: CALCULATE P-SCORE (CORRECTED WEIGHTS = 100%)
    // ============================================================================
    
    // RESEARCH-BACKED WEIGHTS (sum to exactly 100%):
    // Based on revenue impact research from Amazon, Walmart, Google, etc.
    // Speed (30%): Strongest correlation (1% revenue per 100ms)
    // Mobile (18%): Critical for modern commerce
    // SEO (13%): Search users convert 2-6x more
    // Interactivity (10%): UX impact
    // Accessibility (10%): Legal requirement, market expansion
    // Privacy (6%): GDPR compliance
    // CDN (5%): Speed enabler
    // Weight (4%): Mobile data costs
    // Modern (2%): Future-proofing
    // Code (1%): Technical foundation
    // Sustainability (1%): ESG/brand value
    // Total: 30+18+13+10+10+6+5+4+2+1+1 = 100% ✅
    
    const pscore = 
      result.karpov * 0.30 +
      result.nexus * 0.18 +
      result.pulse * 0.13 +
      result.tyche * 0.10 +
      result.vortex * 0.10 +
      result.helix * 0.06 +
      result.nova * 0.05 +
      result.eden * 0.04 +
      result.aether * 0.02 +
      result.quantum * 0.01 +
      result.echo * 0.01;
    
    // Final clamp and round (keep 1 decimal for granularity)
    const finalPscore = Math.round(clamp(pscore) * 10) / 10;
    
    // ============================================================================
    // STEP 6: BUILD RESPONSE (with detailed data)
    // ============================================================================
    
    const finalResult = {
      pscore: finalPscore,
      hostname,
      url: finalUrl,
      timestamp,
      scanMethod,
      data: {
        karpov: { 
          score: Math.round(result.karpov * 10) / 10,
          ttfb,
          ttfbScore: Math.round(ttfbScore * 10) / 10,
          renderTime: renderingTime,
          adjustedRenderTime,
          renderScore: Math.round(renderScore * 10) / 10,
          loadTime,
          blockingScripts: analysis.blockingScripts,
          blockingCSS: analysis.blockingCSS
        },
        tyche: { 
          score: Math.round(result.tyche * 10) / 10,
          thirdPartyScripts: analysis.thirdPartyCount,
          blockingScripts: analysis.blockingScripts,
          resourceCount: analysis.resourceCount
        },
        vortex: {
          score: Math.round(result.vortex * 10) / 10,
          hasAlt: analysis.hasAlt,
          hasAriaLabels: analysis.hasAriaLabels,
          hasLang: analysis.hasLang,
          hasH1: analysis.hasH1
        },
        nexus: {
          score: Math.round(result.nexus * 10) / 10,
          hasViewport: analysis.hasViewport,
          hasLazyLoading: analysis.hasLazyLoading,
          mobileSpeed: loadTime
        },
        helix: {
          score: Math.round(result.helix * 10) / 10,
          hasHTTPS: analysis.hasHTTPS,
          thirdPartyTrackers: analysis.thirdPartyCount,
          hasAnalytics: analysis.hasGoogleAnalytics,
          hasFacebookPixel: analysis.hasFacebookPixel
        },
        pulse: {
          score: Math.round(result.pulse * 10) / 10,
          hasTitle: analysis.hasTitle,
          titleLength,
          hasDescription: analysis.hasDescription,
          hasStructuredData: analysis.hasStructuredData,
          hasCanonical: analysis.hasCanonical,
          ogTags: analysis.ogTags
        },
        nova: {
          score: Math.round(result.nova * 10) / 10,
          isCDN: !!isCDN,
          hasCache: !!cacheControl,
          compression
        },
        eden: {
          score: Math.round(result.eden * 10) / 10,
          sizeMB: Math.round(analysis.sizeMB * 100) / 100
        },
        aether: {
          score: Math.round(result.aether * 10) / 10,
          hasWebP: analysis.hasWebP,
          hasAVIF: analysis.hasAVIF,
          hasLazyLoading: analysis.hasLazyLoading
        },
        quantum: {
          score: Math.round(result.quantum * 10) / 10,
          blockingScripts: analysis.blockingScripts,
          blockingCSS: analysis.blockingCSS,
          resourceCount: analysis.resourceCount
        },
        echo: {
          score: Math.round(result.echo * 10) / 10,
          sizeMB: Math.round(analysis.sizeMB * 100) / 100,
          co2PerView: Math.round(co2PerView * 1000) / 1000, // grams CO2
          greenHosting: !!responseHeaders.get('cf-ray'),
          hasImageOptimization: analysis.hasWebP || analysis.hasAVIF,
          hasLazyLoading: analysis.hasLazyLoading,
          resourceCount: analysis.resourceCount
        }
      }
    };
    
    // Cache in D1
    if (context.env.DB) {
      try {
        await context.env.DB.prepare(`
          INSERT OR REPLACE INTO precomputed_scores 
          (hostname, score_data, scan_method, sector, last_updated)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(
          hostname,
          JSON.stringify(finalResult),
          scanMethod,
          sector || 'other'
        ).run();
      } catch (e) {
        console.error('D1 cache failed:', e);
      }
    }
    
    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: corsHeaders
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Scan failed',
      details: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
