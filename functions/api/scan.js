// ============================================================================
// DIAGNOSTIC VERSION - Tests CrUX and PSI APIs with detailed error reporting
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

    const testUrl = url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim();
    const diagnostics = {
      url: testUrl,
      tests: {}
    };

    // ========================================================================
    // TEST 1: CrUX API
    // ========================================================================
    diagnostics.tests.crux = { name: 'CrUX API Test' };
    try {
      const CRUX_API_KEY = 'AIzaSyCxhwaXKjHZ0cGhF5V_klxfvpCXAeYpj94';
      const CRUX_API_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
      
      const urlObj = new URL(testUrl);
      const origin = `${urlObj.protocol}//${urlObj.hostname}`;
      
      const cruxResponse = await fetch(`${CRUX_API_URL}?key=${CRUX_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: origin, formFactor: 'ALL' })
      });
      
      diagnostics.tests.crux.status = cruxResponse.status;
      diagnostics.tests.crux.ok = cruxResponse.ok;
      diagnostics.tests.crux.headers = Object.fromEntries([...cruxResponse.headers]);
      
      const cruxData = await cruxResponse.json();
      diagnostics.tests.crux.hasRecord = !!cruxData.record;
      diagnostics.tests.crux.hasError = !!cruxData.error;
      
      if (cruxData.error) {
        diagnostics.tests.crux.error = {
          code: cruxData.error.code,
          message: cruxData.error.message,
          status: cruxData.error.status
        };
      }
      
      if (cruxData.record) {
        diagnostics.tests.crux.success = true;
        diagnostics.tests.crux.formFactor = cruxData.record.key?.formFactor;
        diagnostics.tests.crux.metricsFound = Object.keys(cruxData.record.metrics || {});
      } else {
        diagnostics.tests.crux.success = false;
      }
      
    } catch (error) {
      diagnostics.tests.crux.exception = error.message;
      diagnostics.tests.crux.success = false;
    }

    // ========================================================================
    // TEST 2: PageSpeed Insights API
    // ========================================================================
    diagnostics.tests.psi = { name: 'PageSpeed Insights API Test' };
    try {
      const PSI_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
      const psiUrl = `${PSI_API_URL}?url=${encodeURIComponent(testUrl)}&strategy=desktop&category=PERFORMANCE`;
      
      const psiResponse = await fetch(psiUrl, {
        signal: AbortSignal.timeout(30000)
      });
      
      diagnostics.tests.psi.status = psiResponse.status;
      diagnostics.tests.psi.ok = psiResponse.ok;
      diagnostics.tests.psi.headers = Object.fromEntries([...psiResponse.headers]);
      
      if (!psiResponse.ok) {
        const errorText = await psiResponse.text();
        diagnostics.tests.psi.errorBody = errorText.substring(0, 500);
        diagnostics.tests.psi.success = false;
      } else {
        const psiData = await psiResponse.json();
        diagnostics.tests.psi.hasLighthouseResult = !!psiData.lighthouseResult;
        diagnostics.tests.psi.hasError = !!psiData.error;
        
        if (psiData.error) {
          diagnostics.tests.psi.error = psiData.error;
        }
        
        if (psiData.lighthouseResult) {
          diagnostics.tests.psi.success = true;
          diagnostics.tests.psi.lighthouseScore = psiData.lighthouseResult.categories?.performance?.score;
          diagnostics.tests.psi.metricsFound = Object.keys(psiData.lighthouseResult.audits || {}).slice(0, 10);
        } else {
          diagnostics.tests.psi.success = false;
        }
      }
      
    } catch (error) {
      diagnostics.tests.psi.exception = error.message;
      diagnostics.tests.psi.success = false;
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================
    diagnostics.summary = {
      cruxWorks: diagnostics.tests.crux.success || false,
      psiWorks: diagnostics.tests.psi.success || false,
      bothWork: (diagnostics.tests.crux.success && diagnostics.tests.psi.success) || false
    };

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
