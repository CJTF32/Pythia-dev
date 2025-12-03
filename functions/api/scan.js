// Pythia Scan Engine - Working Version for Benchmark Dataset
// No rate limiting, proper server-side parsing, physics-aware scoring

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
    const { url } = await context.request.json();
    
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const hostname = new URL(url).hostname.replace('www.', '');
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
    // STEP 2: HTTP FETCH (with realistic user agent)
    // ============================================================================
    let html = '';
    let responseHeaders = new Headers();
    let loadTime = 0;
    let ttfb = 0;
    let scanMethod = 'fetch';
    
    const fetchStart = Date.now();
    
    try {
      const response = await fetch(url, {
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
      html = await response.text();
      loadTime = Date.now() - fetchStart;
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
    } catch (fetchError) {
      // If fetch fails, try browser rendering if available
      if (context.env.MYBROWSER) {
        try {
          scanMethod = 'browser';
          const { default: puppeteer } = await import('@cloudflare/puppeteer');
          
          const browserStart = Date.now();
          const browser = await puppeteer.launch(context.env.MYBROWSER);
          const page = await browser.newPage();
          
          await page.setViewport({ width: 1920, height: 1080 });
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          
          html = await page.content();
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
    // STEP 3: ANALYZE HTML (server-side compatible)
    // ============================================================================
    
    // Simple regex-based analysis (no DOMParser needed)
    const analysis = {
      hasViewport: /<meta[^>]*name=["']viewport["']/i.test(html),
      hasDescription: /<meta[^>]*name=["']description["']/i.test(html),
      hasTitle: /<title[^>]*>([^<]+)<\/title>/i.test(html),
      hasH1: /<h1[^>]*>/i.test(html),
      hasStructuredData: /<script[^>]*type=["']application\/ld\+json["']/i.test(html),
      hasCanonical: /<link[^>]*rel=["']canonical["']/i.test(html),
      hasOpenGraph: /<meta[^>]*property=["']og:/i.test(html),
      
      // Count resources
      scriptCount: (html.match(/<script[^>]*>/gi) || []).length,
      cssCount: (html.match(/<link[^>]*rel=["']stylesheet["']/gi) || []).length,
      imgCount: (html.match(/<img[^>]*>/gi) || []).length,
      
      // Detect blocking resources
      blockingScripts: (html.match(/<script(?![^>]*(?:async|defer))[^>]*>/gi) || []).length,
      blockingCSS: (html.match(/<link[^>]*rel=["']stylesheet["'](?![^>]*media=["']print["'])[^>]*>/gi) || []).length,
      
      // Modern tech
      hasWebP: /\.webp["']/i.test(html),
      hasAVIF: /\.avif["']/i.test(html),
      hasLazyLoading: /loading=["']lazy["']/i.test(html),
      
      // Accessibility
      hasAlt: /<img[^>]*alt=/i.test(html),
      hasAriaLabels: /aria-label=/i.test(html),
      hasLang: /<html[^>]*lang=/i.test(html),
      
      // Security
      hasHTTPS: url.startsWith('https://'),
      
      // Third-party
      hasGoogleAnalytics: /google-analytics\.com|googletagmanager\.com/i.test(html),
      hasFacebookPixel: /facebook\.com\/tr\?id=/i.test(html),
      
      contentLength: html.length,
      resourceCount: (html.match(/<script[^>]*>/gi) || []).length + 
                     (html.match(/<link[^>]*>/gi) || []).length +
                     (html.match(/<img[^>]*>/gi) || []).length
    };
    
    // ============================================================================
    // STEP 4: PHYSICS-AWARE SCORING
    // ============================================================================
    
    // Separate network latency (TTFB) from rendering time
    const renderingTime = loadTime - ttfb;
    
    // KARPOV: Speed (30% weight) - Physics-aware
    let karpovScore = 85; // Baseline
    
    // Score TTFB (network infrastructure)
    if (ttfb > 800) karpovScore -= 18;
    else if (ttfb > 600) karpovScore -= 12;
    else if (ttfb > 400) karpovScore -= 8;
    else if (ttfb > 200) karpovScore -= 4;
    else if (ttfb < 100) karpovScore += 5; // Bonus for CDN
    
    // Score rendering time (controllable by developer)
    const baselineRender = 800; // Optimal render time
    if (renderingTime > 5000) karpovScore -= 25;
    else if (renderingTime > 4000) karpovScore -= 18;
    else if (renderingTime > 3000) karpovScore -= 12;
    else if (renderingTime > 2000) karpovScore -= 8;
    else if (renderingTime > 1500) karpovScore -= 4;
    else if (renderingTime < 1000) karpovScore += 8; // Bonus
    
    // Penalties for blocking resources
    karpovScore -= Math.min(15, analysis.blockingScripts * 2.5);
    karpovScore -= Math.min(12, analysis.blockingCSS * 3.5);
    
    // Resource count penalty
    if (analysis.resourceCount > 150) karpovScore -= 12;
    else if (analysis.resourceCount > 100) karpovScore -= 8;
    else if (analysis.resourceCount > 75) karpovScore -= 2;
    else if (analysis.resourceCount < 20) karpovScore += 3;
    
    karpovScore = Math.max(0, Math.min(100, karpovScore));
    
    // TYCHE: Interactivity (18% weight)
    let tycheScore = 80;
    const thirdPartyScripts = (html.match(/google-analytics|googletagmanager|facebook\.com|doubleclick/gi) || []).length;
    tycheScore -= Math.min(20, thirdPartyScripts * 4);
    tycheScore -= Math.min(15, analysis.blockingScripts * 3);
    tycheScore = Math.max(0, Math.min(100, tycheScore));
    
    // PULSE: SEO (12% weight)
    let pulseScore = 50;
    if (analysis.hasTitle) pulseScore += 10;
    if (analysis.hasDescription) pulseScore += 10;
    if (analysis.hasH1) pulseScore += 8;
    if (analysis.hasStructuredData) pulseScore += 8;
    if (analysis.hasCanonical) pulseScore += 6;
    if (analysis.hasOpenGraph) pulseScore += 6;
    if (karpovScore >= 70) pulseScore += 2; // Core Web Vitals bonus
    pulseScore = Math.max(0, Math.min(100, pulseScore));
    
    // NEXUS: Mobile (12% weight)
    let nexusScore = 50;
    if (analysis.hasViewport) nexusScore += 20;
    if (analysis.imgCount > 0 && analysis.hasAlt) nexusScore += 15;
    if (analysis.hasLazyLoading) nexusScore += 10;
    if (loadTime < 3000) nexusScore += 5; // Mobile speed
    nexusScore = Math.max(0, Math.min(100, nexusScore));
    
    // VORTEX: Accessibility (8% weight)
    let vortexScore = 50;
    if (analysis.hasAlt) vortexScore += 15;
    if (analysis.hasAriaLabels) vortexScore += 15;
    if (analysis.hasLang) vortexScore += 10;
    if (analysis.hasH1) vortexScore += 10;
    vortexScore = Math.max(0, Math.min(100, vortexScore));
    
    // NOVA: Scalability (7% weight)
    let novaScore = 70;
    if (analysis.contentLength > 500000) novaScore -= 20;
    else if (analysis.contentLength > 200000) novaScore -= 10;
    if (analysis.resourceCount > 100) novaScore -= 10;
    novaScore = Math.max(0, Math.min(100, novaScore));
    
    // HELIX: Privacy (6% weight)
    let helixScore = 60;
    if (analysis.hasHTTPS) helixScore += 20;
    if (!analysis.hasGoogleAnalytics) helixScore += 10;
    if (!analysis.hasFacebookPixel) helixScore += 10;
    helixScore = Math.max(0, Math.min(100, helixScore));
    
    // EDEN: Efficiency (4% weight)
    let edenScore = 60;
    if (analysis.hasWebP || analysis.hasAVIF) edenScore += 20;
    if (analysis.hasLazyLoading) edenScore += 10;
    if (analysis.contentLength < 100000) edenScore += 10;
    edenScore = Math.max(0, Math.min(100, edenScore));
    
    // AETHER: Modern Tech (2% weight)
    let aetherScore = 20;
    if (analysis.hasWebP) aetherScore += 30;
    if (analysis.hasAVIF) aetherScore += 30;
    if (analysis.hasLazyLoading) aetherScore += 20;
    aetherScore = Math.max(0, Math.min(100, aetherScore));
    
    // QUANTUM: Code Quality (1% weight)
    let quantumScore = 70;
    if (analysis.blockingScripts === 0) quantumScore += 15;
    if (analysis.blockingCSS === 0) quantumScore += 15;
    quantumScore = Math.max(0, Math.min(100, quantumScore));
    
    // Calculate overall P-Score
    const pscore = Math.round(
      karpovScore * 0.30 +
      tycheScore * 0.18 +
      pulseScore * 0.12 +
      nexusScore * 0.12 +
      vortexScore * 0.08 +
      novaScore * 0.07 +
      helixScore * 0.06 +
      edenScore * 0.04 +
      aetherScore * 0.02 +
      quantumScore * 0.01
    );
    
    // Build response
    const result = {
      pscore,
      hostname,
      url,
      timestamp,
      scanMethod,
      data: {
        karpov: { 
          score: karpovScore,
          ttfb,
          renderTime: renderingTime,
          loadTime,
          blockingScripts: analysis.blockingScripts,
          blockingCSS: analysis.blockingCSS,
          resourceCount: analysis.resourceCount
        },
        tyche: { score: tycheScore, thirdPartyScripts },
        pulse: { 
          score: pulseScore,
          hasTitle: analysis.hasTitle,
          hasDescription: analysis.hasDescription,
          hasStructuredData: analysis.hasStructuredData
        },
        nexus: { 
          score: nexusScore,
          hasViewport: analysis.hasViewport,
          hasLazyLoading: analysis.hasLazyLoading
        },
        vortex: { score: vortexScore },
        nova: { score: novaScore },
        helix: { score: helixScore, hasHTTPS: analysis.hasHTTPS },
        eden: { score: edenScore },
        aether: { score: aetherScore },
        quantum: { score: quantumScore }
      }
    };
    
    // Cache in D1
    if (context.env.DB) {
      try {
        await context.env.DB.prepare(`
          INSERT OR REPLACE INTO precomputed_scores 
          (hostname, score_data, scan_method, last_updated)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          hostname,
          JSON.stringify(result),
          scanMethod
        ).run();
      } catch (e) {
        console.error('D1 cache failed:', e);
      }
    }
    
    return new Response(JSON.stringify(result), {
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
