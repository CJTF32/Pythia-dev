// Pythia Scan Engine - Complete Working Version
// Physics-aware scoring, no rate limiting, proper server-side parsing

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
    // STEP 4: CALCULATE SCORES
    // ============================================================================
    
    const result = {};
    
    // 1. KARPOV: Speed (20% weight) - Physics-Aware
    const renderingTime = loadTime - ttfb;
    
    // Classify TTFB (network infrastructure - not developer-controlled)
    let ttfbCategory = 'poor';
    let ttfbScore = 50;
    
    if (ttfb < 200) {
      ttfbCategory = 'excellent';
      ttfbScore = 100;
    } else if (ttfb < 400) {
      ttfbCategory = 'good';
      ttfbScore = 85;
    } else if (ttfb < 600) {
      ttfbCategory = 'acceptable';
      ttfbScore = 70;
    } else if (ttfb < 800) {
      ttfbCategory = 'slow';
      ttfbScore = 55;
    }
    
    // Adjust rendering time for blocking resources
    let adjustedRenderTime = renderingTime;
    adjustedRenderTime += (analysis.blockingScripts * 100);
    adjustedRenderTime += (analysis.blockingCSS * 50);
    
    // Score rendering (developer-controlled)
    const RENDER_OPTIMAL = scanMethod === 'browser' ? 1500 : 800;
    const RENDER_ACCEPTABLE = scanMethod === 'browser' ? 3500 : 2000;
    const RENDER_POOR = scanMethod === 'browser' ? 6000 : 4000;
    
    let renderScore = 100;
    if (adjustedRenderTime <= RENDER_OPTIMAL) {
      renderScore = 100;
    } else if (adjustedRenderTime <= RENDER_ACCEPTABLE) {
      renderScore = 100 - ((adjustedRenderTime - RENDER_OPTIMAL) / (RENDER_ACCEPTABLE - RENDER_OPTIMAL)) * 40;
    } else if (adjustedRenderTime <= RENDER_POOR) {
      renderScore = 60 - ((adjustedRenderTime - RENDER_ACCEPTABLE) / (RENDER_POOR - RENDER_ACCEPTABLE)) * 40;
    } else {
      renderScore = Math.max(0, 20 - ((adjustedRenderTime - RENDER_POOR) / 1000) * 2);
    }
    
    // Composite: 70% rendering (controllable) + 30% network (infrastructure)
    result.karpov = Math.round(Math.max(0, Math.min(100, (renderScore * 0.70) + (ttfbScore * 0.30))));
    
    // 2. TYCHE: Interactivity (18% weight)
    const thirdPartyScripts = (html.match(/google-analytics|googletagmanager|facebook\.com|doubleclick/gi) || []).length;
    
    let tycheScore = 80;
    tycheScore -= Math.min(20, thirdPartyScripts * 4);
    tycheScore -= Math.min(15, analysis.blockingScripts * 3);
    result.tyche = Math.round(Math.max(0, Math.min(100, tycheScore)));
    
    // 3. VORTEX: Accessibility (20% weight)
    let vortexScore = 0;
    if (analysis.hasAlt) vortexScore += 25;
    if (analysis.hasAriaLabels) vortexScore += 25;
    if (analysis.hasLang) vortexScore += 20;
    if (analysis.hasH1) vortexScore += 15;
    if (analysis.hasTitle) vortexScore += 15;
    result.vortex = Math.round(Math.max(0, Math.min(100, vortexScore)));
    
    // 4. NEXUS: Mobile (10% weight)
    let nexusScore = 0;
    if (analysis.hasViewport) nexusScore += 40;
    if (analysis.imgCount > 0 && analysis.hasAlt) nexusScore += 20;
    if (analysis.hasLazyLoading) nexusScore += 20;
    if (loadTime < 3000) nexusScore += 20;
    result.nexus = Math.round(Math.max(0, Math.min(100, nexusScore)));
    
    // 5. HELIX: Privacy (15% weight)
    let helixScore = 60;
    if (analysis.hasHTTPS) helixScore += 20;
    if (!analysis.hasGoogleAnalytics) helixScore += 10;
    if (!analysis.hasFacebookPixel) helixScore += 10;
    result.helix = Math.round(Math.max(0, Math.min(100, helixScore)));
    
    // 6. PULSE: SEO (15% weight)
    let pulseScore = 0;
    if (analysis.hasTitle) pulseScore += 20;
    if (titleLength >= 30 && titleLength <= 60) pulseScore += 15;
    if (analysis.hasDescription) pulseScore += 20;
    if (analysis.hasStructuredData) pulseScore += 15;
    if (analysis.hasCanonical) pulseScore += 10;
    if (analysis.ogTags >= 4) pulseScore += 10;
    if (result.karpov >= 70) pulseScore += 10; // Core Web Vitals bonus
    result.pulse = Math.round(Math.max(0, Math.min(100, pulseScore)));
    
    // 7. NOVA: CDN & Caching (7% weight)
    const isCDN = responseHeaders.get('cf-ray') || responseHeaders.get('x-cache') || responseHeaders.get('x-amz-cf-id');
    const hasCache = responseHeaders.get('cache-control');
    const compression = responseHeaders.get('content-encoding');
    
    let novaScore = 0;
    if (isCDN) novaScore += 40;
    if (hasCache) novaScore += 30;
    if (compression === 'br') novaScore += 30;
    else if (compression === 'gzip') novaScore += 20;
    result.nova = Math.round(Math.max(0, Math.min(100, novaScore)));
    
    // 8. EDEN: Page Weight (7% weight)
    let edenScore = 100;
    if (analysis.sizeMB > 5) {
      edenScore = Math.max(20, 100 - ((analysis.sizeMB - 5) * 10));
    } else if (analysis.sizeMB > 3) {
      edenScore = 85 - ((analysis.sizeMB - 3) * 7.5);
    } else if (analysis.sizeMB > 1) {
      edenScore = 95 - ((analysis.sizeMB - 1) * 5);
    }
    result.eden = Math.round(Math.max(0, Math.min(100, edenScore)));
    
    // 9. AETHER: Modern Tech (3% weight)
    let aetherScore = 0;
    if (analysis.hasWebP) aetherScore += 40;
    if (analysis.hasAVIF) aetherScore += 30;
    if (analysis.hasLazyLoading) aetherScore += 30;
    result.aether = Math.round(Math.max(0, Math.min(100, aetherScore)));
    
    // 10. QUANTUM: Code Quality (2% weight)
    let quantumScore = 70;
    if (analysis.blockingScripts === 0) quantumScore += 15;
    if (analysis.blockingCSS === 0) quantumScore += 15;
    result.quantum = Math.round(Math.max(0, Math.min(100, quantumScore)));
    
    // ============================================================================
    // STEP 5: CALCULATE P-SCORE
    // ============================================================================
    
    const pscore = Math.round(
      result.karpov * 0.20 +
      result.tyche * 0.18 +
      result.vortex * 0.20 +
      result.nexus * 0.10 +
      result.helix * 0.15 +
      result.pulse * 0.15 +
      result.nova * 0.07 +
      result.eden * 0.07 +
      result.aether * 0.03 +
      result.quantum * 0.02
    );
    
    // ============================================================================
    // STEP 6: BUILD RESPONSE
    // ============================================================================
    
    const finalResult = {
      pscore,
      hostname,
      url: finalUrl,
      timestamp,
      scanMethod,
      data: {
        karpov: { 
          score: result.karpov,
          ttfb,
          ttfbCategory,
          renderTime: renderingTime,
          adjustedRenderTime,
          loadTime,
          blockingScripts: analysis.blockingScripts,
          blockingCSS: analysis.blockingCSS
        },
        tyche: { 
          score: result.tyche,
          thirdPartyScripts,
          blockingScripts: analysis.blockingScripts
        },
        vortex: {
          score: result.vortex,
          hasAlt: analysis.hasAlt,
          hasAriaLabels: analysis.hasAriaLabels,
          hasLang: analysis.hasLang
        },
        nexus: {
          score: result.nexus,
          hasViewport: analysis.hasViewport,
          hasLazyLoading: analysis.hasLazyLoading
        },
        helix: {
          score: result.helix,
          hasHTTPS: analysis.hasHTTPS,
          hasTracking: analysis.hasGoogleAnalytics || analysis.hasFacebookPixel
        },
        pulse: {
          score: result.pulse,
          hasTitle: analysis.hasTitle,
          titleLength,
          hasDescription: analysis.hasDescription,
          hasStructuredData: analysis.hasStructuredData,
          ogTags: analysis.ogTags
        },
        nova: {
          score: result.nova,
          isCDN: !!isCDN,
          hasCache: !!hasCache,
          compression
        },
        eden: {
          score: result.eden,
          sizeMB: Math.round(analysis.sizeMB * 100) / 100
        },
        aether: {
          score: result.aether,
          hasWebP: analysis.hasWebP,
          hasAVIF: analysis.hasAVIF,
          hasLazyLoading: analysis.hasLazyLoading
        },
        quantum: {
          score: result.quantum,
          blockingScripts: analysis.blockingScripts,
          blockingCSS: analysis.blockingCSS
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
