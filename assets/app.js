(() => {
'use strict';

/* CONFIG et PRODUCTS viennent de config.js */
/* ==== Utilitaires ==== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover:hover)').matches;
const eur = n => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const byId = id => PRODUCTS.find(p => p.id === id);
const visual = p => p.img ? `<img src="${p.img}" alt="${p.name}" loading="lazy">` : p.svg;

/* =====================================================
   Fond : bulles bleues lumineuses (canvas)
   ===================================================== */
const cv = $('#bg'), ctx = cv.getContext('2d');
let W = 0, H = 0;
function resize(){
  const d = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize); resize();
const mouse = { x: -999, y: -999, nx: .5, ny: .5 };
let scrollY = window.scrollY, scrollD = 0;
const orbs = [];
const orbCount = reduce ? 14 : (innerWidth < 700 ? 24 : 44);
function makeOrb(initial){
  const z = Math.random();
  return { x: Math.random() * W, y: initial ? Math.random() * H : H + 30 + Math.random() * H * .3, z, r: 3 + z * z * 24 + Math.random() * 4,
    vy: 14 + z * 52 + Math.random() * 16, ph: Math.random() * 6.28, sw: 10 + Math.random() * 28, sf: .35 + Math.random() * .7,
    hue: 214 + Math.random() * 30 - 14, t: Math.random() * 10, ox: 0, oy: 0, tw: Math.random() * 6 };
}
for (let i = 0; i < orbCount; i++) orbs.push(makeOrb(true));
orbs.sort((a, b) => a.z - b.z);

function drawOrb(o, dt){
  o.t += dt; o.y -= o.vy * dt * (reduce ? .4 : 1); o.y -= scrollD * (.12 + o.z * .35);
  let x = o.x + Math.sin(o.t * o.sf + o.ph) * o.sw + (mouse.nx - .5) * 50 * o.z;
  const dx = x + o.ox - mouse.x, dy = o.y + o.oy - mouse.y, d = Math.hypot(dx, dy) || 1, R = o.r + 100;
  if (d < R){ const f = 1 - d / R; o.ox += dx / d * f * 380 * dt; o.oy += dy / d * f * 380 * dt; }
  o.ox *= 1 - Math.min(1, dt * 2.2); o.oy *= 1 - Math.min(1, dt * 2.2);
  x += o.ox; const y = o.y + o.oy, r = o.r;
  const edge = Math.min(1, (H + r * 3 - o.y) / 140) * Math.min(1, Math.max(0, o.y + 40) / (H * .18));
  const a = Math.max(0, Math.min(1, (.3 + o.z * .55) * edge * .8));
  if (a < .01) return;
  const h = o.hue, tk = .85 + .15 * Math.sin(o.t * 2 + o.tw);
  ctx.globalCompositeOperation = 'lighter';
  let g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
  g.addColorStop(0, `hsla(${h},95%,60%,${.4 * a * tk})`); g.addColorStop(.4, `hsla(${h},95%,55%,${.15 * a})`); g.addColorStop(1, `hsla(${h},95%,50%,0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, 6.283); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  g = ctx.createRadialGradient(x - r * .38, y - r * .42, r * .05, x, y, r);
  g.addColorStop(0, `hsla(${h},100%,94%,${.95 * a})`); g.addColorStop(.28, `hsla(${h},95%,68%,${.9 * a})`);
  g.addColorStop(.7, `hsla(${h},90%,42%,${.85 * a})`); g.addColorStop(1, `hsla(${h},85%,22%,${.8 * a})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  ctx.strokeStyle = `hsla(${h},100%,84%,${.3 * a})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r - .5, 0, 6.283); ctx.stroke();
}

/* Logo 3D : couches empilées en profondeur */
const m3 = $('#mark3d'), N = 22;
for (let i = 0; i < N; i++){
  const front = i === N - 1;
  m3.insertAdjacentHTML('beforeend', `<svg class="${front ? 'front' : ''}" viewBox="360 366 540 504" style="transform:translateZ(${(i - N / 2) * 3}px)"><use href="#${front ? 'yFront' : 'yBack'}"/></svg>`);
}
const stage = $('#stage');
for (let i = 0; i < 7; i++){
  const s = document.createElement('i'); s.className = 'sp';
  s.style.cssText = `left:${8 + Math.random() * 84}%;top:${8 + Math.random() * 84}%;animation-delay:${(-Math.random() * 6).toFixed(2)}s;transform:translateZ(${Math.round(Math.random() * 80 - 20)}px)`;
  stage.append(s);
}

const cg = $('#cg'); let gx = innerWidth / 2, gy = innerHeight / 2, mx = 0, my = 0;
addEventListener('pointermove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.nx = e.clientX / innerWidth; mouse.ny = e.clientY / innerHeight;
}, { passive: true });
addEventListener('pointerleave', () => { mouse.x = mouse.y = -999; });
const prog = $('#prog'), nav = $('#nav');
addEventListener('scroll', () => {
  const y = window.scrollY; scrollD += y - scrollY; scrollY = y;
  const max = document.documentElement.scrollHeight - innerHeight;
  prog.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  nav.classList.toggle('scrolled', y > 10);
}, { passive: true });

let last = performance.now();
function frame(now){
  const dt = Math.min(.05, (now - last) / 1000); last = now; const t = now / 1000;
  ctx.clearRect(0, 0, W, H);
  for (const o of orbs){
    drawOrb(o, dt);
    if (o.y < -o.r * 4){ const n = makeOrb(false); o.x = n.x; o.y = n.y; }
  }
  scrollD *= .8;
  if (canHover){ gx += (mouse.x - gx) * Math.min(1, dt * 5); gy += (mouse.y - gy) * Math.min(1, dt * 5); cg.style.transform = `translate(${gx}px,${gy}px)`; }
  mx += ((mouse.nx - .5) * 2 - mx) * Math.min(1, dt * 4); my += ((mouse.ny - .5) * 2 - my) * Math.min(1, dt * 4);
  if (!reduce){
    const ry = Math.sin(t * .7) * 16 + mx * 26, rx = Math.cos(t * .55) * 5 - my * 16, fy = Math.sin(t * 1.2) * 8;
    m3.style.transform = `translateY(${fy}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* =====================================================
   Apparition au scroll + tilt 3D
   ===================================================== */
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const el = e.target; io.unobserve(el);
  const i = [...el.parentElement.children].indexOf(el);
  el.style.setProperty('--d', (i % 4) * 90 + 'ms'); el.classList.add('in');
}), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
const reveal = el => { el.classList.add('rv'); io.observe(el); };
$$('.rv').forEach(el => io.observe(el));

function tilt(el, max = 9){
  if (!canHover || reduce) return;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((px - .5) * 2 * max).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((.5 - py) * 2 * max).toFixed(2) + 'deg');
    el.style.setProperty('--gx', (px * 100) + '%'); el.style.setProperty('--gy', (py * 100) + '%');
    el.classList.add('hot');
  });
  el.addEventListener('pointerleave', () => { el.classList.remove('hot'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
}

/* =====================================================
   Boutique
   ===================================================== */
const grid = $('#grid'), chips = $('#chips');
const CATS = ['Tout', ...new Set(PRODUCTS.map(p => p.cat))];
let cat = 'Tout';

chips.innerHTML = CATS.map(c => `<button type="button" class="chip${c === cat ? ' on' : ''}" data-c="${c}" aria-pressed="${c === cat}">${c}</button>`).join('');
chips.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || b.dataset.c === cat) return;
  cat = b.dataset.c;
  $$('.chip', chips).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  grid.classList.add('swap');
  setTimeout(() => { renderGrid(); grid.classList.remove('swap'); }, reduce ? 0 : 230);
});

function renderGrid(){
  const list = PRODUCTS.filter(p => cat === 'Tout' || p.cat === cat);
  grid.innerHTML = '';
  list.forEach((p, i) => {
    const c = document.createElement('article'); c.className = 'card'; c.dataset.id = p.id;
    c.innerHTML = `<div class="card-in">
      ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}
      <div class="pimg"><div class="halo"></div>${visual(p)}</div>
      <div class="pinfo"><h3 style="margin:0"><button type="button" class="pname" data-open="${p.id}">${p.name}</button></h3>
        <p class="psub">${p.sub}</p>
        <div class="prow"><div class="price"><b>${eur(p.price)}</b>${p.old ? `<s>${eur(p.old)}</s>` : ''}</div>
          <button type="button" class="add" data-add="${p.id}" aria-label="Ajouter ${p.name} au panier">Ajouter</button></div></div>
      <div class="glare"></div></div>`;
    $('.pimg svg, .pimg img', c).style.setProperty('--fd', (-i * 0.9) + 's');
    grid.append(c); reveal(c); tilt(c);
  });
}
renderGrid();

const WHY = [
  ['Livraison rapide', 'Expédition sous 48 h ouvrées, et livraison offerte dès 60 € d\'achat.', '<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'],
  ['Retours sur 30 jours', 'Le produit ne te convient pas ? Renvoie-le simplement dans le mois.', '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4.5h4.5"/>'],
  ['Paiement sécurisé', 'Tes informations de paiement restent protégées à chaque étape.', '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'],
  ['Garantie 2 ans', 'Chaque produit Yonix est couvert contre les défauts de fabrication.', '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>']
];
$('#why').innerHTML = WHY.map(w => `<div class="wcard"><div class="ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${w[2]}</svg></div><h3>${w[0]}</h3><p>${w[1]}</p></div>`).join('');
$$('.wcard').forEach(c => { reveal(c); tilt(c, 8); });

/* =====================================================
   Panier
   ===================================================== */
let cart = {};
try { cart = JSON.parse(localStorage.getItem('yonix-cart') || '{}') || {}; } catch (_) { cart = {}; }
Object.keys(cart).forEach(id => { if (!byId(id)) delete cart[id]; });
const save = () => { try { localStorage.setItem('yonix-cart', JSON.stringify(cart)); } catch (_) {} };

const drawer = $('#drawer'), scrim = $('#scrim'), cartBtn = $('#cartBtn'), cartN = $('#cartN');
const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
const subtotal = () => Object.entries(cart).reduce((s, [id, q]) => s + byId(id).price * q, 0);
const shipping = sub => sub === 0 || sub >= CONFIG.freeShippingFrom ? 0 : CONFIG.shippingCost;

function renderCart(){
  const n = count(), sub = subtotal(), ship = shipping(sub);
  cartN.textContent = n; cartN.classList.toggle('on', n > 0);
  const items = $('#items'); items.innerHTML = '';
  $('#dFoot').hidden = n === 0;
  if (!n){
    items.innerHTML = `<div class="empty"><svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#4aa8ff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.4l2.2 10.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.5-1.2L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="16.5" cy="19.5" r="1.4"/></svg><p>Ton panier est vide.</p><button class="btn primary" type="button" id="goShop">Voir la boutique</button></div>`;
    $('#goShop').onclick = () => { closeDrawer(); location.hash = 'boutique'; };
  } else {
    Object.entries(cart).forEach(([id, q]) => {
      const p = byId(id), row = document.createElement('div'); row.className = 'line';
      row.innerHTML = `<div class="th">${visual(p)}</div><div><h4>${p.name}</h4><div class="lp">${eur(p.price)}</div>
        <div class="l-row"><div class="qty"><button type="button" data-dec="${id}" aria-label="Moins">−</button><span>${q}</span><button type="button" data-inc="${id}" aria-label="Plus">+</button></div>
        <button type="button" class="rm" data-rm="${id}">Retirer</button></div></div>`;
      items.append(row);
    });
  }
  const left = CONFIG.freeShippingFrom - sub;
  $('#shipTxt').textContent = n === 0 ? `Livraison offerte dès ${eur(CONFIG.freeShippingFrom)}` : (left > 0 ? `Plus que ${eur(left)} pour la livraison offerte` : 'Livraison offerte sur cette commande');
  $('#shipBar').style.width = Math.min(100, sub / CONFIG.freeShippingFrom * 100) + '%';
  $('#tSub').textContent = eur(sub); $('#tShip').textContent = ship ? eur(ship) : 'Offerte'; $('#tTot').textContent = eur(sub + ship);
}
$('#items').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.inc) cart[t.dataset.inc]++;
  if (t.dataset.dec){ cart[t.dataset.dec]--; if (cart[t.dataset.dec] <= 0) delete cart[t.dataset.dec]; }
  if (t.dataset.rm) delete cart[t.dataset.rm];
  save(); renderCart();
});

let lastFocus = null;
function openDrawer(){
  lastFocus = document.activeElement; drawer.inert = false; drawer.classList.add('on'); scrim.classList.add('on');
  document.body.style.overflow = 'hidden'; setTimeout(() => $('#dClose').focus(), 60);
}
function closeDrawer(){
  drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.inert = true; document.body.style.overflow = '';
  (lastFocus && lastFocus.focus) ? lastFocus.focus() : cartBtn.focus();
}
cartBtn.onclick = openDrawer; scrim.onclick = closeDrawer; $('#dClose').onclick = closeDrawer;
addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('on')) closeDrawer(); });

function toast(msg){
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 2900);
}
function bump(){ cartBtn.classList.remove('bump'); void cartBtn.offsetWidth; cartBtn.classList.add('bump'); }
function fly(from){
  if (reduce){ bump(); return; }
  const a = from.getBoundingClientRect(), b = cartBtn.getBoundingClientRect();
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2, ex = b.left + b.width / 2, ey = b.top + b.height / 2;
  const d = document.createElement('i'); d.className = 'fly'; document.body.append(d);
  const anim = d.animate([
    { transform: `translate(${sx}px,${sy}px) scale(1)`, offset: 0 },
    { transform: `translate(${(sx + ex) / 2}px,${Math.min(sy, ey) - 110}px) scale(1.4)`, offset: .5 },
    { transform: `translate(${ex}px,${ey}px) scale(.35)`, opacity: .3, offset: 1 }
  ], { duration: 780, easing: 'cubic-bezier(.5,0,.3,1)' });
  anim.onfinish = () => { d.remove(); bump(); };
}
function addToCart(id, qty = 1, from){
  cart[id] = (cart[id] || 0) + qty; save(); renderCart();
  from ? fly(from) : bump();
  toast(`${byId(id).name} ajouté au panier`);
}

grid.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add){ addToCart(add.dataset.add, 1, add); return; }
  const op = e.target.closest('[data-open]'); if (op) openProduct(op.dataset.open);
});

/* Fiche produit */
const pd = $('#pd'); let pdId = null, pdQ = 1;
function openProduct(id){
  const p = byId(id); pdId = id; pdQ = 1; $('#pdQty').textContent = 1;
  $('#pdImg').innerHTML = visual(p); $('#pdName').textContent = p.name; $('#pdSub').textContent = p.sub; $('#pdDesc').textContent = p.desc;
  $('#pdFeat').innerHTML = p.feat.map(f => `<li>${f}</li>`).join('');
  $('#pdPrice').innerHTML = `<b>${eur(p.price)}</b>${p.old ? `<s>${eur(p.old)}</s>` : ''}`;
  pd.showModal();
}
$('#pdMinus').onclick = () => { pdQ = Math.max(1, pdQ - 1); $('#pdQty').textContent = pdQ; };
$('#pdPlus').onclick = () => { pdQ = Math.min(20, pdQ + 1); $('#pdQty').textContent = pdQ; };
$('#pdAdd').onclick = e => { const b = e.currentTarget; addToCart(pdId, pdQ, b); pd.close(); };
$$('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
});

/* Commande */
const co = $('#co');
function showRecap(){
  const sub = subtotal(), ship = shipping(sub);
  const lines = Object.entries(cart).map(([id, q]) => `${q} × ${byId(id).name} : ${eur(byId(id).price * q)}`);
  $('#coRecap').innerHTML = Object.entries(cart).map(([id, q]) => `<div><span>${q} × ${byId(id).name}</span><span>${eur(byId(id).price * q)}</span></div>`).join('')
    + `<div><span>Livraison</span><span>${ship ? eur(ship) : 'Offerte'}</span></div><div style="font-weight:800;margin-top:6px"><span>Total</span><span>${eur(sub + ship)}</span></div>`;
  const mail = $('#coMail');
  if (CONFIG.contactEmail){
    const body = `Bonjour, je souhaite commander :\n\n${lines.join('\n')}\nLivraison : ${ship ? eur(ship) : 'Offerte'}\nTotal : ${eur(sub + ship)}`;
    mail.href = `mailto:${CONFIG.contactEmail}?subject=${encodeURIComponent('Commande Yonix')}&body=${encodeURIComponent(body)}`; mail.hidden = false;
  } else mail.hidden = true;
  closeDrawer(); co.showModal();
}
$('#checkout').onclick = async () => {
  if (CONFIG.checkoutUrl){ window.open(CONFIG.checkoutUrl, '_blank', 'noopener'); return; }
  if (CONFIG.checkoutApi){
    const btn = $('#checkout'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Redirection vers le paiement…';
    try {
      const r = await fetch(CONFIG.checkoutApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: Object.entries(cart).map(([id, qty]) => ({ id, qty })) }) });
      const data = await r.json();
      if (r.ok && data.url){ location.href = data.url; return; }
    } catch (_) { /* repli ci-dessous */ }
    finally { btn.disabled = false; btn.textContent = label; }
  }
  showRecap();
};
if (CONFIG.contactEmail){ const l = $('#mailLink'); l.href = 'mailto:' + CONFIG.contactEmail; l.hidden = false; }

renderCart();

/* Retour depuis la page de paiement */
const back = new URLSearchParams(location.search).get('commande');
if (back){
  history.replaceState(null, '', location.pathname + location.hash);
  if (back === 'ok'){ cart = {}; save(); renderCart(); setTimeout(() => toast('Merci ! Ta commande est confirmée.'), 500); }
  else setTimeout(() => toast('Paiement annulé, ton panier est conservé.'), 500);
}
})();
