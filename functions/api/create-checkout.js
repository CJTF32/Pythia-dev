// ============================================================================
// STRIPE CHECKOUT SESSION CREATOR - Cloudflare Worker
// ============================================================================
// Deploy this to: /api/create-checkout
// Set STRIPE_SECRET_KEY in your Cloudflare Worker environment variables

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { email, url, notes } = await request.json();
    
    if (!email || !url) {
      return new Response(JSON.stringify({ 
        error: 'Email and URL are required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid email format' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get Stripe secret key from environment
    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.error('STRIPE_SECRET_KEY not configured');
      return new Response(JSON.stringify({ 
        error: 'Payment system not configured' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Create Stripe checkout session
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'Pythia Manual Scan',
        'line_items[0][price_data][product_data][description]': `Professional audit for ${url}`,
        'line_items[0][price_data][unit_amount]': '27500', // $275.00 in cents
        'line_items[0][quantity]': '1',
        'mode': 'payment',
        'success_url': 'https://p-score.me/payment-success?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url': 'https://p-score.me/',
        'customer_email': email,
        'metadata[url]': url,
        'metadata[notes]': notes || '',
        'metadata[service]': 'manual_scan'
      })
    });
    
    if (!stripeResponse.ok) {
      const errorText = await stripeResponse.text();
      console.error('Stripe API error:', errorText);
      return new Response(JSON.stringify({ 
        error: 'Failed to create payment session' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const session = await stripeResponse.json();
    
    return new Response(JSON.stringify({ 
      sessionId: session.id 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
