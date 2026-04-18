// EPS Direct API - VerifyTransaction, mark order paid, send delivery email
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EPS_BASE = 'https://pg.eps.com.bd/api';

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

    const body = await req.json();
    const {
      merchant_transaction_id,
      eps_transaction_id,
      customer_email: bodyEmail,
      customer_name,
      product_name,
      total: bodyTotal,
    } = body || {};

    if (!merchant_transaction_id) {
      return new Response(JSON.stringify({ error: 'merchant_transaction_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // 1) Get token & verify with EPS
    const token = await getToken(username, password);

    const verifyBody = {
      MerchantId: merchantId,
      StoreId: storeId,
      HashKey: hashKey,
      MerchantTransactionId: merchant_transaction_id,
      ...(eps_transaction_id ? { EPSTransactionId: eps_transaction_id } : {}),
    };

    const verifyResp = await fetch(`${EPS_BASE}/VerifyTransaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(verifyBody),
    });

    const verifyText = await verifyResp.text();
    let verifyJson: any;
    try { verifyJson = JSON.parse(verifyText); } catch {
      console.error('VerifyTransaction non-JSON:', verifyText.slice(0, 500));
      return new Response(JSON.stringify({ error: 'EPS verify invalid response', raw: verifyText.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const status = String(
      verifyJson?.Status || verifyJson?.status || verifyJson?.TransactionStatus || ''
    ).toLowerCase();

    const isPaid = ['success', 'successful', 'paid', 'completed', 'valid'].some(s => status.includes(s));

    if (!isPaid) {
      console.warn('EPS verify status not success:', verifyJson);
      return new Response(JSON.stringify({ success: false, paid: false, status, raw: verifyJson }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Mark order paid + confirmed
    const { error: updateError } = await sb
      .from('orders')
      .update({ payment_status: 'paid', status: 'confirmed' })
      .eq('order_number', merchant_transaction_id);
    if (updateError) console.error('Order update failed:', updateError);

    // 3) Look up email if not supplied
    let customer_email = bodyEmail;
    if (!customer_email) {
      const { data: ord } = await sb
        .from('orders')
        .select('notes, total, shipping_name')
        .eq('order_number', merchant_transaction_id)
        .maybeSingle();
      if (ord?.notes && typeof ord.notes === 'string') {
        const m = ord.notes.match(/email:([^\s,]+)/i);
        if (m) customer_email = m[1];
      }
    }

    // 4) Send delivery email
    if (customer_email) {
      const pdfDownloadUrl = 'https://pixelcraftstudio.shop/download?file=ai-prompt-mastery';
      try {
        const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-digital-delivery-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_number: merchant_transaction_id,
            customer_name: customer_name || '',
            customer_email,
            download_link: pdfDownloadUrl,
            product_name: product_name || 'AI Prompt Mastery (PDF)',
            total: bodyTotal || 0,
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
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('eps-verify error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
