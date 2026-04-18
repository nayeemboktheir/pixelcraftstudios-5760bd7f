// EPS Direct API - Initialize a transaction & return RedirectURL
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EPS_BASE = 'https://pg.eps.com.bd/api'; // EPS production API base

async function getToken(username: string, password: string): Promise<string> {
  const resp = await fetch(`${EPS_BASE}/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UserName: username, Password: password }),
  });
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`GetToken bad response: ${text.slice(0,300)}`); }
  const token = json?.Token || json?.token || json?.access_token || json?.AccessToken;
  if (!token) throw new Error(`GetToken missing token: ${text.slice(0,300)}`);
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

    // Persist customer_email on the order so verify can deliver later (best-effort)
    try {
      const sb = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await sb.from('orders').update({
        notes: `email:${customer_email}`,
      }).eq('order_number', order_number);
    } catch (e) {
      console.warn('Could not stash email on order notes:', e);
    }

    // 1) Get token
    const token = await getToken(username, password);

    // 2) Initialize transaction
    const initBody: Record<string, unknown> = {
      MerchantId: merchantId,
      StoreId: storeId,
      HashKey: hashKey,
      MerchantTransactionId: order_number,
      TransactionTypeId: 1,
      TotalAmount: Number(amount),
      SuccessUrl: success_url,
      FailUrl: fail_url || success_url,
      CancelUrl: cancel_url || fail_url || success_url,
      CustomerName: customer_name || 'Customer',
      CustomerEmail: customer_email,
      CustomerPhone: customer_phone || '01000000000',
      CustomerAddress: customer_address || 'N/A',
      CustomerCity: 'Dhaka',
      CustomerCountry: 'Bangladesh',
      ProductName: product_name || 'Digital Product',
      ProductCategory: 'Digital',
      ProductProfile: 'general',
      Currency: 'BDT',
    };

    const initResp = await fetch(`${EPS_BASE}/InitializeEPS`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(initBody),
    });

    const initText = await initResp.text();
    let initJson: any;
    try { initJson = JSON.parse(initText); } catch {
      console.error('InitializeEPS non-JSON:', initText.slice(0, 500));
      return new Response(JSON.stringify({ error: 'EPS init returned invalid response', raw: initText.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const redirectUrl =
      initJson?.RedirectURL || initJson?.redirectUrl || initJson?.RedirectUrl ||
      initJson?.PaymentUrl || initJson?.PaymentURL || initJson?.data?.RedirectURL;

    if (!redirectUrl) {
      console.error('InitializeEPS missing RedirectURL:', JSON.stringify(initJson).slice(0, 500));
      return new Response(JSON.stringify({ error: 'EPS did not return a redirect URL', details: initJson }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, redirectUrl, raw: initJson }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('eps-initiate error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
