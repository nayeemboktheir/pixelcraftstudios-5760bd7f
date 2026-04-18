// EPS Direct API - Initialize a transaction & return RedirectURL
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EPS_BASE = 'https://pgapi.eps.com.bd/v1';

// HMAC-SHA512(key=hashKey-utf8, msg=field) -> base64
async function makeXHash(hashKey: string, field: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(hashKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(field));
  // base64 encode
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function getToken(username: string, password: string, hashKey: string): Promise<string> {
  const xHash = await makeXHash(hashKey, username);
  const resp = await fetch(`${EPS_BASE}/Auth/GetToken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hash': xHash,
    },
    body: JSON.stringify({ userName: username, password }),
  });
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch {
    throw new Error(`GetToken bad response (${resp.status}): ${text.slice(0, 400)}`);
  }
  const token = json?.token || json?.Token;
  if (!token) {
    throw new Error(`GetToken missing token (${resp.status}): ${JSON.stringify(json).slice(0, 400)}`);
  }
  return token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const merchantId = Deno.env.get('EPS_MERCHANT_ID')!;
    const storeId = Deno.env.get('EPS_STORE_ID')!;
    const username = Deno.env.get('EPS_USERNAME')!;
    const password = Deno.env.get('EPS_PASSWORD')!;
    const hashKey = Deno.env.get('EPS_HASH_KEY')!;

    if (!merchantId || !storeId || !username || !password || !hashKey) {
      return new Response(JSON.stringify({ error: 'EPS credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      order_number,
      amount,
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      product_name,
      success_url,
      fail_url,
      cancel_url,
    } = body || {};

    if (!order_number || !amount || !customer_email || !success_url) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EPS requires merchantTransactionId minimum 10 chars; pad if needed.
    let merchantTransactionId = String(order_number);
    if (merchantTransactionId.length < 10) {
      merchantTransactionId = (merchantTransactionId + Date.now().toString()).slice(0, 20);
    }

    // Persist email on order notes so verify can deliver later (best-effort)
    try {
      const sb = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await sb.from('orders')
        .update({ notes: `email:${customer_email};mtid:${merchantTransactionId}` })
        .eq('order_number', order_number);
    } catch (e) {
      console.warn('Could not stash email on order notes:', e);
    }

    // 1) Get bearer token (with x-hash on username)
    const token = await getToken(username, password, hashKey);

    // 2) Build init body (exact field names per EPS guide)
    const initPayload: Record<string, unknown> = {
      merchantId,
      storeId,
      CustomerOrderId: order_number,
      merchantTransactionId,
      transactionTypeId: 1,
      totalAmount: Number(amount),
      successUrl: success_url,
      failUrl: fail_url || success_url,
      cancelUrl: cancel_url || fail_url || success_url,
      customerName: customer_name || 'Customer',
      customerEmail: customer_email,
      CustomerAddress: customer_address || 'Digital Delivery',
      CustomerCity: 'Dhaka',
      CustomerState: 'Dhaka',
      CustomerPostcode: '1200',
      CustomerCountry: 'BD',
      CustomerPhone: customer_phone || '01000000000',
      ProductName: product_name || 'Digital Product',
      ProductProfile: 'general',
      ProductCategory: 'Digital',
      ShippingMethod: 'NO',
      NoOfItem: '1',
    };

    // 3) Build x-hash from merchantTransactionId
    const xHash = await makeXHash(hashKey, merchantTransactionId);

    const initResp = await fetch(`${EPS_BASE}/EPSEngine/InitializeEPS`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-hash': xHash,
      },
      body: JSON.stringify(initPayload),
    });

    const initText = await initResp.text();
    let initJson: any;
    try { initJson = JSON.parse(initText); } catch {
      console.error('InitializeEPS non-JSON:', initText.slice(0, 500));
      return new Response(JSON.stringify({ error: 'EPS init invalid response', status: initResp.status, raw: initText.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const redirectUrl = initJson?.RedirectURL || initJson?.redirectURL || initJson?.RedirectUrl;
    if (!redirectUrl) {
      console.error('InitializeEPS missing RedirectURL:', JSON.stringify(initJson).slice(0, 600));
      return new Response(JSON.stringify({ error: 'EPS did not return RedirectURL', details: initJson }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      redirectUrl,
      merchantTransactionId,
      epsTransactionId: initJson?.TransactionId || initJson?.transactionId || null,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('eps-initiate error:', err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
