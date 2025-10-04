// server.js — Express + API-Football + Web Push + Stripe (sem login); DEMO fallback no front
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || ('http://localhost:' + PORT);
const AFFILIATE_URL = process.env.AFFILIATE_URL || 'https://seu-partner.com/?utm_source=scorehub';
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = 'https://v3.football.api-sports.io';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

import Stripe from 'stripe';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_PRICE_ID_MONTHLY = process.env.STRIPE_PRICE_ID_MONTHLY || '';
const STRIPE_PRICE_ID_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET, { apiVersion: '2023-10-16' }) : null;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('Web Push: habilitado');
} else {
  console.log('Web Push: DESABILITADO (sem VAPID keys)');
}


app.use(express.json());

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Env to client
app.get('/env.js', (req,res)=>{
  res.type('application/javascript').send(`window.__ENV = ${JSON.stringify({ AFFILIATE_URL, STRIPE_PRICE_ID_MONTHLY: STRIPE_PRICE_ID_MONTHLY || 'price_monthly_xxx', STRIPE_PRICE_ID_YEARLY: STRIPE_PRICE_ID_YEARLY || 'price_yearly_xxx' })};`);
});

// API-Football proxy + micro-cache
const cache = new Map(); const ttl = 60 * 1000;
function getCache(key){ const hit = cache.get(key); if(!hit) return null; if(Date.now() - hit.time > ttl){ cache.delete(key); return null; } return hit.data; }
function setCache(key,data){ cache.set(key,{time:Date.now(),data}); }
async function apiFootball(pathAndQuery){
  const url = `${API_HOST}${pathAndQuery}`;
  const key = `AF:${url}`;
  const cached = getCache(key);
  if(cached) return cached;
  const r = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if(!r.ok) throw new Error(`API-Football error ${r.status}`);
  const j = await r.json(); setCache(key, j); return j;
}

app.get('/api/fixtures', async (req,res)=>{
  try{
    const league = req.query.league || 'ALL';
    const date = new Date().toISOString().slice(0,10);
    const query = league==='ALL' ? `/fixtures?date=${date}` : `/fixtures?date=${date}&league=${league}`;
    const j = await apiFootball(query);
    const items = (j.response||[]).map(f=> ({
      id: String(f.fixture.id),
      league: f.league?.name,
      minute: f.fixture?.status?.elapsed ? `${f.fixture.status.elapsed}'` : f.fixture?.status?.short,
      status: f.fixture?.status?.long,
      round: f.league?.round,
      date: f.fixture?.date,
      home: { name: f.teams?.home?.name, short: (f.teams?.home?.name||'').slice(0,3).toUpperCase() },
      away: { name: f.teams?.away?.name, short: (f.teams?.away?.name||'').slice(0,3).toUpperCase() },
      score: { home: f.goals?.home ?? 0, away: f.goals?.away ?? 0 },
    }));
    res.json({ items });
  }catch(e){ console.error(e); res.status(200).json({ items: [] }); }
});

app.get('/api/odds', async (req,res)=>{
  try{
    const fixture = req.query.fixture;
    if(!fixture) return res.status(400).json({error:'fixture required'});
    const j = await apiFootball(`/odds?fixture=${fixture}&bookmaker=8`);
    const market = j.response?.[0]?.bookmakers?.[0]?.bets?.find(b=>b.name==='Match Winner');
    const out = { home:'-', draw:'-', away:'-' };
    if(market){
      for(const v of market.values){
        if(v.value==='Home') out.home = v.odd;
        if(v.value==='Draw') out.draw = v.odd;
        if(v.value==='Away') out.away = v.odd;
      }
    }
    res.json(out);
  }catch(e){ console.error(e); res.json({ home:'-', draw:'-', away:'-' }); }
});

// Stripe checkout (sem login)
app.post('/api/billing/checkout', async (req, res) => {
  try{
    if(!stripe) return res.status(400).json({ error: 'Stripe not configured' });
    const priceId = req.body.priceId || STRIPE_PRICE_ID_MONTHLY;
    if(!priceId) return res.status(400).json({ error: 'Missing priceId' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card', 'boleto', 'pix'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: APP_URL + '/?ok=1',
      cancel_url: APP_URL + '/?cancel=1',
      allow_promotion_codes: true
    });
    res.json({ url: session.url });
  }catch(e){ console.error(e); res.status(500).json({ error: 'checkout error' }); }
});

// Stripe webhook (opcional, sem marcar usuário porque não tem login)
app.post('/api/billing/stripe-webhook', express.raw({type: 'application/json'}), (req, res) => {
  if(!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(200).end();
  try{
    const sig = req.headers['stripe-signature'];
    stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  }catch(err){ return res.status(400).send(`Webhook Error: ${err.message}`); }
  res.json({received:true});
});

// Web Push
app.get('/api/push/public-key', (req,res)=> res.json({ publicKey: VAPID_PUBLIC_KEY }));
app.post('/api/push/subscribe', (req,res)=> res.json({ ok:true }));

// Serve index
app.get('/index.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=> console.log('ScoreHub running on ' + APP_URL));
