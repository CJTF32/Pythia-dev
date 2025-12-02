// Dynamic import to avoid bundling issues
// Puppeteer is provided by Cloudflare at runtime

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
    // ============================================================================
    // STEP 1: INPUT PARSING
    // ============================================================================
    const { url } = await context.request.json();
    
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const result = { url, timestamp: new Date().toISOString() };
    
    // ============================================================================
    // STEP 2: CHECK PRE-COMPUTED SCORES (TIER 1 - D1 DATABASE)
    // ============================================================================
    const hostname = new URL(url).hostname.replace('www.', '');
    
    // Check D1 database for pre-computed scores
    if (context.env.DB) {
      try {
        const precomputed = await context.env.DB.prepare(
          'SELECT * FROM precomputed_scores WHERE hostname = ?'
        ).bind(hostname).first();
        
        if (precomputed) {
          console.log(`✅ Using pre-computed score for ${hostname}`);
          return new Response(JSON.stringify({
            ...JSON.parse(precomputed.score_data),
            precomputed: true,
            last_updated: precomputed.last_updated,
            scan_method: precomputed.scan_method
          }), {
            status: 200,
            headers: corsHeaders
          });
        }
      } catch (e) {
        console.error('D1 lookup failed:', e);
        // Continue with live scan
      }
    }
    
    // ============================================================================
    // STEP 3: FETCH WEBSITE DATA (TIER 2 - SIMPLE HTTP FETCH)
    // ============================================================================
    
    let html = '';
    let siteHeaders = new Headers();
    let contentLength = 0;
    let loadTime = 0;
    let finalUrl = url;
    let ttfb = 0;
    let usedBrowser = false;

    try {
      const fetchStart = Date.now();
      
      // Try simple fetch first (faster, cheaper)
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        ttfb = Date.now() - fetchStart;

        // If we get blocked (403, 429) or bad response, try browser
        if (!response.ok || response.status === 403 || response.status === 429) {
          throw new Error(`HTTP ${response.status} - will try browser rendering`);
        }
        
        html = await response.text();
        siteHeaders = response.headers;
        contentLength = parseInt(siteHeaders.get('content-length') || '0');
        loadTime = Date.now() - fetchStart;
        finalUrl = response.url;
        
        console.log(`✅ HTTP fetch successful for ${hostname} in ${loadTime}ms`);
        
      } catch (fetchError) {
        console.log(`⚠️ HTTP fetch failed for ${hostname}: ${fetchError.message}`);
        console.log('🔄 Attempting browser rendering...');
        
        // ============================================================================
        // STEP 4: BROWSER RENDERING (TIER 3 - PUPPETEER)
        // ============================================================================
        if (context.env.MYBROWSER) {
          try {
            // Dynamic import of puppeteer (avoids bundling issues)
            const { default: puppeteer } = await import('@cloudflare/puppeteer');
            
            const browserStart = Date.now();
            const browser = await puppeteer.launch(context.env.MYBROWSER);
            const page = await browser.newPage();
            
            // Set viewport and user agent
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
            
            // Navigate with timeout
            await page.goto(url, { 
              waitUntil: 'networkidle2',
              timeout: 10000
            });
            
            loadTime = Date.now() - browserStart;
            html = await page.content();
            finalUrl = page.url();
            usedBrowser = true;
            
            await browser.close();
            
            console.log(`✅ Browser rendering successful for ${hostname} in ${loadTime}ms`);
            
          } catch (browserError) {
            console.error(`❌ Browser rendering failed for ${hostname}:`, browserError);
            throw new Error(`Failed to scan ${hostname}: ${browserError.message}`);
          }
        } else {
          throw new Error('Browser rendering not available');
        }
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      return new Response(JSON.stringify({ 
        error: `Failed to scan ${hostname}: ${error.message}` 
      }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // ============================================================================
    // STEP 5: PARSE HTML & EXTRACT METRICS (REGEX-BASED FOR CLOUDFLARE WORKERS)
    // ============================================================================
    
    // Count resources using regex (DOMParser not available in Workers)
    const scriptMatches = html.match(/<script[\s\S]*?<\/script>/gi) || [];
    const scripts = scriptMatches.length;
    const inlineScripts = scriptMatches.filter(s => !s.match(/src\s*=\s*["']/i)).length;
    const externalScripts = scripts - inlineScripts;
    
    const scriptSrcMatches = html.match(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi) || [];
    const thirdPartyScripts = scriptSrcMatches.filter(s => {
      const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
      return srcMatch && !srcMatch[1].includes(hostname);
    }).length;
    
    const imgMatches = html.match(/<img[^>]*>/gi) || [];
    const images = imgMatches.length;
    const imagesWithAlt = imgMatches.filter(img => img.match(/alt\s*=\s*["'][^"']*["']/i)).length;
    
    const stylesheets = (html.match(/<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*>/gi) || []).length;
    const inlineStyles = (html.match(/<style[\s\S]*?<\/style>/gi) || []).length;
    
    // Check for modern features
    const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
    const viewportMatch = html.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]+content\s*=\s*["']([^"']+)["']/i);
    const viewportContent = viewportMatch ? viewportMatch[1] : '';
    const viewportProperlyConfigured = viewportContent.includes('width=device-width');
    
    const hasManifest = /<link[^>]+rel\s*=\s*["']manifest["']/i.test(html);
    const hasModules = /<script[^>]+type\s*=\s*["']module["']/i.test(html);
    
    // SEO elements
    const hasTitle = /<title>/i.test(html);
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const titleLength = titleMatch ? titleMatch[1].length : 0;
    const ogTags = (html.match(/<meta[^>]+property\s*=\s*["']og:/gi) || []).length;
    const hasDescription = /<meta[^>]+name\s*=\s*["']description["']/i.test(html);
    
    // Security headers
    const hasHSTS = siteHeaders.has('strict-transport-security');
    const hasCSP = siteHeaders.has('content-security-policy');
    const hasXFrame = siteHeaders.has('x-frame-options');
    
    // Estimate trackers (basic heuristic)
    const trackerDomains = ['google-analytics', 'gtag', 'facebook', 'doubleclick', 'analytics', 'tracker'];
    const trackerCount = scriptSrcMatches.filter(s => 
      trackerDomains.some(t => s.toLowerCase().includes(t))
    ).length;
    
    // Check for CDN
    const cdnDomains = ['cloudflare', 'cloudfront', 'fastly', 'akamai', 'cdn'];
    const allResources = [...scriptSrcMatches, ...(html.match(/<link[^>]+href\s*=\s*["']([^"']+)["']/gi) || [])];
    const isCDN = cdnDomains.some(cdn => 
      finalUrl.includes(cdn) || allResources.some(r => r.toLowerCase().includes(cdn))
    );
    
    // Check caching
    const cacheControl = siteHeaders.get('cache-control') || '';
    const hasCache = cacheControl.includes('max-age') || cacheControl.includes('public');
    
    // Check compression
    const contentEncoding = siteHeaders.get('content-encoding') || '';
    const compression = contentEncoding.includes('br') ? 'br' : 
                       contentEncoding.includes('gzip') ? 'gzip' : 'none';
    
    // Estimate page size
    const sizeMB = contentLength ? (contentLength / 1024 / 1024) : (html.length / 1024 / 1024);
    
    // Total resources
    const resourceCount = scripts + images + stylesheets;
    
    // Console errors (simulated - can't get real errors from HTTP fetch)
    const consoleErrors = 0;

    // ============================================================================
    // STEP 6: CALCULATE COMPONENT SCORES (PHYSICS-AWARE)
    // ============================================================================
    
    // PHYSICS BASELINE: 200ms minimum due to network latency
    const PHYSICS_BASELINE = 200;
    const adjustedLoadTime = Math.max(0, loadTime - PHYSICS_BASELINE);
    
    // 1. KARPOV - Load Time Performance (25% weight)
    // Progressive penalty curve: 0-1s = excellent, 1-3s = good, 3-5s = fair, 5s+ = poor
    let karpovScore = 100;
    if (adjustedLoadTime < 1000) {
      karpovScore = 100;
    } else if (adjustedLoadTime < 3000) {
      karpovScore = 90 - ((adjustedLoadTime - 1000) / 2000 * 20); // 90-70
    } else if (adjustedLoadTime < 5000) {
      karpovScore = 70 - ((adjustedLoadTime - 3000) / 2000 * 20); // 70-50
    } else {
      karpovScore = Math.max(20, 50 - ((adjustedLoadTime - 5000) / 1000 * 5)); // 50-20
    }
    
    // TTFB penalty
    const ttfbPenalty = Math.min(20, Math.max(0, (ttfb - 500) / 100 * 5));
    karpovScore = Math.max(0, karpovScore - ttfbPenalty);
    
    // Resource count penalty
    if (resourceCount > 100) {
      karpovScore -= Math.min(15, (resourceCount - 100) / 10);
    }
    
    karpovScore = Math.round(Math.max(0, Math.min(100, karpovScore)));
    
    // 2. TYCHE - Script Optimization (20% weight)
    let tycheScore = 100;
    
    // Inline scripts penalty
    if (inlineScripts > 10) {
      tycheScore -= Math.min(30, (inlineScripts - 10) * 2);
    }
    
    // Third-party scripts penalty
    if (thirdPartyScripts > 5) {
      tycheScore -= Math.min(40, (thirdPartyScripts - 5) * 4);
    }
    
    tycheScore = Math.round(Math.max(0, Math.min(100, tycheScore)));
    
    // 3. VORTEX - Image Optimization (10% weight)
    let vortexScore = 100;
    
    if (images > 0) {
      const altRatio = imagesWithAlt / images;
      vortexScore = Math.round(altRatio * 100);
      
      // Too many images penalty
      if (images > 50) {
        vortexScore -= Math.min(30, (images - 50) / 5);
      }
    }
    
    vortexScore = Math.round(Math.max(0, Math.min(100, vortexScore)));
    
    // 4. NEXUS - Mobile Responsiveness (8% weight)
    let nexusScore = 0;
    if (hasViewport) nexusScore += 50;
    if (viewportProperlyConfigured) nexusScore += 50;
    
    nexusScore = Math.round(nexusScore);
    
    // 5. HELIX - Privacy & Security (7% weight)
    let helixScore = 60; // Base score
    
    // Security headers bonus
    if (hasHSTS) helixScore += 15;
    if (hasCSP) helixScore += 15;
    if (hasXFrame) helixScore += 10;
    
    // Tracker penalty
    if (trackerCount > 10) {
      helixScore -= Math.min(40, (trackerCount - 10) * 3);
    } else if (trackerCount > 5) {
      helixScore -= (trackerCount - 5) * 4;
    }
    
    helixScore = Math.round(Math.max(0, Math.min(100, helixScore)));
    
    // 6. PULSE - SEO Foundations (6% weight)
    let pulseScore = 0;
    if (hasTitle) pulseScore += 30;
    if (titleLength >= 30 && titleLength <= 60) pulseScore += 20;
    if (hasDescription) pulseScore += 25;
    if (ogTags >= 4) pulseScore += 25;
    
    pulseScore = Math.round(Math.max(0, Math.min(100, pulseScore)));
    
    // 7. NOVA - CDN & Caching (6% weight)
    let novaScore = 0;
    if (isCDN) novaScore += 40;
    if (hasCache) novaScore += 30;
    if (compression === 'br') novaScore += 30;
    else if (compression === 'gzip') novaScore += 20;
    
    novaScore = Math.round(Math.max(0, Math.min(100, novaScore)));
    
    // 8. EDEN - Page Weight (6% weight)
    let edenScore = 100;
    if (sizeMB > 5) {
      edenScore = Math.max(20, 100 - ((sizeMB - 5) * 10));
    } else if (sizeMB > 3) {
      edenScore = 85 - ((sizeMB - 3) * 7.5);
    } else if (sizeMB > 1) {
      edenScore = 95 - ((sizeMB - 1) * 5);
    }
    
    edenScore = Math.round(Math.max(0, Math.min(100, edenScore)));
    
    // 9. AETHER - Modern Standards (6% weight)
    let aetherScore = 0;
    if (hasManifest) aetherScore += 50;
    if (hasModules) aetherScore += 50;
    
    aetherScore = Math.round(aetherScore);
    
    // 10. QUANTUM - Meta-Optimization (5% weight)
    // Holistic score based on overall balance
    const avgComponentScore = (karpovScore + tycheScore + vortexScore + nexusScore + 
                                helixScore + pulseScore + novaScore + edenScore + aetherScore) / 9;
    
    let quantumScore = avgComponentScore;
    
    // Bonus for well-rounded sites
    const componentScores = [karpovScore, tycheScore, vortexScore, nexusScore, helixScore, 
                             pulseScore, novaScore, edenScore, aetherScore];
    const minScore = Math.min(...componentScores);
    const maxScore = Math.max(...componentScores);
    
    if (maxScore - minScore < 30) {
      quantumScore += 10; // Well-balanced bonus
    }
    
    quantumScore = Math.round(Math.max(0, Math.min(100, quantumScore)));
    
    // 11. ECHO - Console Errors (1% weight)
    let echoScore = consoleErrors === 0 ? 100 : Math.max(0, 100 - (consoleErrors * 10));
    echoScore = Math.round(echoScore);
    
    // ============================================================================
    // STEP 7: CALCULATE WEIGHTED P-SCORE
    // ============================================================================
    
    const weights = {
      karpov: 0.25,
      tyche: 0.20,
      vortex: 0.10,
      nexus: 0.08,
      helix: 0.07,
      pulse: 0.06,
      nova: 0.06,
      eden: 0.06,
      aether: 0.06,
      quantum: 0.05,
      echo: 0.01
    };
    
    const pscore = Math.round(
      karpovScore * weights.karpov +
      tycheScore * weights.tyche +
      vortexScore * weights.vortex +
      nexusScore * weights.nexus +
      helixScore * weights.helix +
      pulseScore * weights.pulse +
      novaScore * weights.nova +
      edenScore * weights.eden +
      aetherScore * weights.aether +
      quantumScore * weights.quantum +
      echoScore * weights.echo
    );
    
    // ============================================================================
    // STEP 8: RETURN RESULTS
    // ============================================================================
    
    const responseData = {
      url: finalUrl,
      pscore,
      karpov: karpovScore,
      tyche: tycheScore,
      vortex: vortexScore,
      nexus: nexusScore,
      helix: helixScore,
      pulse: pulseScore,
      nova: novaScore,
      eden: edenScore,
      aether: aetherScore,
      quantum: quantumScore,
      echo: echoScore,
      data: {
        karpov: {
          loadTime: Math.round(loadTime),
          adjustedLoadTime: Math.round(adjustedLoadTime),
          physicsBaseline: PHYSICS_BASELINE,
          ttfb: Math.round(ttfb),
          resourceCount
        },
        tyche: {
          inlineScripts,
          externalScripts,
          thirdPartyScripts
        },
        vortex: {
          images,
          imagesWithAlt,
          altRatio: images > 0 ? Math.round((imagesWithAlt / images) * 100) : 0
        },
        nexus: {
          hasViewport,
          viewportProperlyConfigured
        },
        helix: {
          trackerCount,
          securityHeaders: {
            hsts: hasHSTS,
            csp: hasCSP,
            xframe: hasXFrame
          }
        },
        pulse: {
          hasTitle,
          titleLength,
          hasDescription,
          ogTags
        },
        nova: {
          isCDN,
          hasCache,
          compression
        },
        eden: {
          sizeMB: Math.round(sizeMB * 100) / 100
        },
        aether: {
          hasManifest,
          hasModules
        },
        quantum: {
          balance: maxScore - minScore,
          avgComponentScore: Math.round(avgComponentScore)
        },
        echo: {
          consoleErrors
        }
      },
      scanMethod: usedBrowser ? 'browser' : 'http',
      timestamp: result.timestamp
    };
    
    console.log(`✅ Scan complete for ${hostname}: P-Score = ${pscore}`);
    
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: corsHeaders
    });
    
  } catch (error) {
    console.error('Scan error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Scan failed' 
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
