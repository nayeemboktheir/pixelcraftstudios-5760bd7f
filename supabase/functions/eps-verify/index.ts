// EPS Direct API - Verify transaction (GET), mark order paid, send delivery email
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EPS_BASE = 'https://pgapi.eps.com.bd/v1';

async function makeXHash(hashKey: string, field: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(hashKey),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(field));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function getToken(username: string, password: string, hashKey: string): Promise<string> {
  const xHash = await makeXHash(hashKey, username);
  const resp = await fetch(`${EPS_BASE}/Auth/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hash': xHash },
    body: JSON.stringify({ userName: username, password }),
  });
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`GetToken bad (${resp.status}): ${text.slice(0,300)}`); }
  const token = json?.token || json?.Token;
  if (!token) throw new Error(`GetToken missing token: ${JSON.stringify(json).slice(0,300)}`);
  return token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const username = Deno.env.get('EPS_USERNAME')!;
    const password = Deno.env.get('EPS_PASSWORD')!;
    const hashKey = Deno.env.get('EPS_HASH_KEY')!;

    const body = await req.json();
    const {
      merchant_transaction_id,
      eps_transaction_id,
      customer_email: bodyEmail,
      customer_name,
      product_name,
      total: bodyTotal,
    } = body || {};

    if (!merchant_transaction_id && !eps_transaction_id) {
      return new Response(JSON.stringify({ error: 'merchant_transaction_id or eps_transaction_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Resolve true merchantTransactionId from order notes if order_number != mtid
    let mtid = merchant_transaction_id as string | undefined;
    let resolvedOrderNumber = merchant_transaction_id as string | undefined;
    if (mtid) {
      const { data: ord } = await sb.from('orders')
        .select('order_number, notes')
        .eq('order_number', mtid)
        .maybeSingle();
      if (ord?.notes) {
        const m = String(ord.notes).match(/mtid:([^\s;,]+)/i);
        if (m) mtid = m[1];
      }
    }

    // 1) Get token
    const token = await getToken(username, password, hashKey);

    // 2) Verify (GET with query string). Hash on whichever id we use.
    const idForHash = mtid || (eps_transaction_id as string);
    const xHash = await makeXHash(hashKey, idForHash);
    const qs = new URLSearchParams();
    if (mtid) qs.set('merchantTransactionId', mtid);
    if (eps_transaction_id) qs.set('EPSTransactionId', eps_transaction_id);

    const verifyResp = await fetch(`${EPS_BASE}/EPSEngine/CheckMerchantTransactionStatus?${qs.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-hash': xHash,
      },
    });

    const verifyText = await verifyResp.text();
    let verifyJson: any;
    try { verifyJson = JSON.parse(verifyText); } catch {
      console.error('Verify non-JSON:', verifyText.slice(0, 500));
      return new Response(JSON.stringify({ error: 'EPS verify invalid response', status: verifyResp.status, raw: verifyText.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const status = String(verifyJson?.Status || verifyJson?.status || '').toLowerCase();
    const isPaid = ['success', 'successful', 'paid', 'completed', 'valid'].some(s => status.includes(s));

    if (!isPaid) {
      console.warn('EPS verify status not success:', verifyJson);
      return new Response(JSON.stringify({ success: false, paid: false, status, raw: verifyJson }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3) Mark order paid + confirmed (use original order_number)
    if (resolvedOrderNumber) {
      const { error: updateError } = await sb
        .from('orders')
        .update({ payment_status: 'paid', status: 'confirmed' })
        .eq('order_number', resolvedOrderNumber);
      if (updateError) console.error('Order update failed:', updateError);
    }

    // 4) Look up email if not supplied
    let customer_email = bodyEmail || verifyJson?.CustomerEmail;
    if (!customer_email && resolvedOrderNumber) {
      const { data: ord } = await sb.from('orders')
        .select('notes')
        .eq('order_number', resolvedOrderNumber)
        .maybeSingle();
      if (ord?.notes) {
        const m = String(ord.notes).match(/email:([^\s;,]+)/i);
        if (m) customer_email = m[1];
      }
    }

    // 5) Send delivery email
    if (customer_email) {
      const pdfDownloadUrl = 'https://pixelcraftstudio.shop/download?file=ai-prompt-mastery';
      try {
        const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-digital-delivery-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_number: resolvedOrderNumber || mtid,
            customer_name: customer_name || verifyJson?.CustomerName || '',
            customer_email,
            download_link: pdfDownloadUrl,
            product_name: product_name || 'AI Prompt Mastery (PDF)',
            total: bodyTotal || Number(verifyJson?.TotalAmount || 0),
          }),
        });
        const emailResult = await emailResp.json();
        console.log('Delivery email response:', JSON.stringify(emailResult));
      } catch (e) {
        console.error('Delivery email failed:', e);
      }
    } else {
      console.warn('No customer_email available; skipping delivery email');
    }

    return new Response(JSON.stringify({
      success: true,
      paid: true,
      download_url: 'https://pixelcraftstudio.shop/download?file=ai-prompt-mastery',
      email_sent_to: customer_email || null,
      eps: verifyJson,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('eps-verify error:', err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
