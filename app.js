'use strict';
/* Stock tracker — everything stays on this phone, encrypted with the mobile number + passcode. */
(() => {
  const VERSION = '1.0.0';
  const VAULT_KEY = 'stocktracker.vault.v1';
  const LOCK_KEY = 'stocktracker.lockout.v1';
  const ITER = 600000;
  const COLORS = ['#F28B82', '#5F6B7A', '#81C995', '#FCAD70', '#8AB4F8', '#6FD3C8', '#C3A6F5', '#F7A8C8', '#F9D46B', '#C8A27A'];
  const SEED = [
    { name: 'Coke', size: '375mL', price: 200, color: '#F28B82' },
    { name: 'Coke Zero', size: '375mL', price: 200, color: '#5F6B7A' },
    { name: 'Sprite', size: '375mL', price: 200, color: '#81C995' },
    { name: 'Fanta', size: '375mL', price: 200, color: '#FCAD70' },
    { name: 'Red Bull', size: '250mL', price: 300, color: '#8AB4F8' },
    { name: 'Monster Mango Loco', size: '500mL', price: 450, color: '#6FD3C8' },
  ];
  const TITLES = { sell: 'Sell', tabs: 'Tabs', money: 'Money', drinks: 'Drinks' };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && !k.includes('-')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.5 }], ['path', { d: 'M8 10.5V8a4 4 0 0 1 8 0v2.5' }]],
    gear: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 17, r: 2 }]],
    can: [['rect', { x: 7, y: 3, width: 10, height: 18, rx: 2.5 }], ['path', { d: 'M7 7.5h10M7 16.5h10' }]],
    people: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20a6.5 6.5 0 0 1 13 0' }], ['circle', { cx: 17.5, cy: 9, r: 2.5 }], ['path', { d: 'M16.5 14.2A5 5 0 0 1 21.5 19.5' }]],
    wallet: [['rect', { x: 3, y: 6, width: 18, height: 14, rx: 2.5 }], ['path', { d: 'M3 10h18M7 3.5h10' }], ['circle', { cx: 16.5, cy: 15, r: 1.2 }]],
    box: [['path', { d: 'M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z' }], ['path', { d: 'M3.5 7.5 12 11.5l8.5-4M12 11.5v9' }]],
    trash: [['path', { d: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13' }]],
  };
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of ICONS[name]) {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      s.append(e);
    }
    return s;
  }
  const money = (c) => {
    const neg = c < 0; c = Math.abs(Math.round(c));
    const s = c % 100 === 0 ? '$' + (c / 100) : '$' + (c / 100).toFixed(2);
    return (neg ? '−' : '') + s;
  };
  const parseMoney = (s) => {
    const n = Number(String(s).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) : null;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const normNumber = (s) => {
    let d = String(s).replace(/\D/g, '');
    if (d.startsWith('61') && d.length === 11) d = '0' + d.slice(2);
    return d;
  };
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function when(t) {
    const d = new Date(t);
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    if (t >= startOfToday()) return 'Today ' + time;
    if (t >= startOfToday() - 86400000) return 'Yesterday ' + time;
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
  }

  /* ---------- crypto ---------- */
  const te = new TextEncoder(), td = new TextDecoder();
  function b64(buf) {
    const a = new Uint8Array(buf); let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  async function deriveKey(number, pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', te.encode('stock-tracker|' + number + '|' + pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(sess, json) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sess.key, te.encode(json));
    return { app: 'stock-tracker', v: 1, salt: b64(sess.salt), iter: sess.iter, iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(key, vault) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.ct));
    return JSON.parse(td.decode(pt));
  }
  function readVault() { try { const v = JSON.parse(localStorage.getItem(VAULT_KEY)); return isVault(v) ? v : null; } catch { return null; } }
  const isVault = (v) => !!(v && v.app === 'stock-tracker' && v.salt && v.iv && v.ct && v.iter);

  /* ---------- state ---------- */
  let session = null;     // { key, salt, iter }
  let S = null;           // decrypted data, only while unlocked
  let view = 'sell';
  let chargeTo = null;
  let histLimit = 40;
  let saveChain = Promise.resolve();

  function freshState() {
    return { v: 1, created: Date.now(), drinks: SEED.map((d) => ({ id: uid(), ...d, archived: false })), tabs: [], log: [], settings: { autoLock: 15, lastBackup: 0 } };
  }
  function migrate(d) {
    d.drinks ||= []; d.tabs ||= []; d.log ||= []; d.settings ||= {};
    if (typeof d.settings.autoLock !== 'number') d.settings.autoLock = 15;
    d.settings.lastBackup ||= 0;
    return d;
  }
  function save() {
    if (!S || !session) return;
    const json = JSON.stringify(S), sess = session;
    saveChain = saveChain.then(async () => {
      const vault = await seal(sess, json);
      localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
    }).catch((e) => toast('Could not save: ' + (e && e.message || e)));
  }

  const drinkById = (id) => S.drinks.find((d) => d.id === id);
  const tabById = (id) => S.tabs.find((t) => t.id === id);
  const activeTabs = () => S.tabs.filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name));
  const activeDrinks = () => S.drinks.filter((d) => !d.archived);

  function stats() {
    const st = { sold: {}, soldAmt: {}, stock: {}, stocked: {}, tabBal: {}, fund: 0, takings: 0, spent: 0, owed: 0, credit: 0, todayQty: 0, todayAmt: 0 };
    const today = startOfToday();
    const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
    for (const e of S.log) {
      switch (e.type) {
        case 'sale':
          add(st.sold, e.drinkId, e.qty); add(st.soldAmt, e.drinkId, e.amount); add(st.stock, e.drinkId, -e.qty);
          st.takings += e.amount;
          if (e.tabId) add(st.tabBal, e.tabId, -e.amount); else st.fund += e.amount;
          if (e.t >= today) { st.todayQty += e.qty; st.todayAmt += e.amount; }
          break;
        case 'pay': add(st.tabBal, e.tabId, e.amount); st.fund += e.amount; break;
        case 'cashout': st.fund -= e.amount; st.spent += e.amount; break;
        case 'cashin': st.fund += e.amount; break;
        case 'restock': case 'adjust': add(st.stock, e.drinkId, e.qty); st.stocked[e.drinkId] = true; break;
      }
    }
    for (const v of Object.values(st.tabBal)) { if (v < 0) st.owed -= v; else st.credit += v; }
    return st;
  }
  function addEntry(e) { e.id = uid(); e.t = Date.now(); S.log.push(e); save(); return e; }
  function removeEntry(id) { S.log = S.log.filter((x) => x.id !== id); save(); render(); }

  /* ---------- UI primitives ---------- */
  let toastTimer = 0;
  function toast(msg, undo) {
    const root = $('#toast-root'); clearTimeout(toastTimer);
    const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'grow' }, msg),
      undo ? h('button', { onclick: () => { root.replaceChildren(); undo(); } }, 'Undo') : null);
    root.replaceChildren(el);
    toastTimer = setTimeout(() => el.remove(), undo ? 6000 : 3000);
  }
  function openSheet(title, body) {
    const back = h('div', { class: 'sheet-back' });
    const close = () => { back.classList.remove('open'); setTimeout(() => back.remove(), 220); };
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'grab' }),
      h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, '✕')),
      typeof body === 'function' ? body(close) : body));
    document.body.append(back);
    requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('open')));
    return close;
  }
  function closeAllSheets() { document.querySelectorAll('.sheet-back').forEach((b) => b.remove()); }
  function ask(title, msg, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v, close) => { if (done) return; done = true; close(); resolve(v); };
      openSheet(title, (close) => h('div', { class: 'stack' },
        msg ? h('p', { class: 'small' }, msg) : null,
        h('button', { class: 'btn wide ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true, close) }, okLabel),
        h('button', { class: 'btn wide ghost', onclick: () => finish(false, close) }, 'Cancel')));
    });
  }
  const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
  const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  /* ---------- render ---------- */
  function render(resetScroll) {
    const app = $('#app'); const y = window.scrollY;
    clearInterval(lockTimer);
    if (!S) { app.replaceChildren(readVault() ? unlockScreen() : setupScreen()); window.scrollTo(0, 0); return; }
    const st = stats();
    app.replaceChildren(
      h('header', { class: 'top' }, h('div', { class: 'top-in' }, h('h1', null, TITLES[view]),
        h('div', { class: 'top-actions' },
          h('button', { class: 'icon-btn', onclick: lockNow, 'aria-label': 'Lock' }, icon('lock')),
          h('button', { class: 'icon-btn', onclick: openSettings, 'aria-label': 'Settings' }, icon('gear'))))),
      h('main', { class: 'main' }, VIEWS[view](st)),
      h('nav', { class: 'tabbar' }, [['sell', 'Sell', 'can'], ['tabs', 'Tabs', 'people'], ['money', 'Money', 'wallet'], ['drinks', 'Drinks', 'box']].map(([v, label, ic]) =>
        h('button', { class: view === v ? 'on' : '', onclick: () => { view = v; histLimit = 40; render(true); } }, icon(ic), label))));
    window.scrollTo(0, resetScroll ? 0 : y);
  }

  /* ---------- Sell ---------- */
  function sellView(st) {
    const drinks = activeDrinks(); const tabs = activeTabs();
    if (chargeTo && !tabs.some((t) => t.id === chargeTo)) chargeTo = null;
    const chip = (label, id, bal) => h('button', { class: 'chip' + (chargeTo === id ? ' on' : ''), onclick: () => { chargeTo = id; render(); } }, label,
      bal ? h('small', { class: bal < 0 ? 'owe' : 'cred' }, bal < 0 ? 'owes ' + money(-bal) : money(bal) + ' credit') : null);
    const target = chargeTo && tabById(chargeTo);
    return [
      h('section', { class: 'today' },
        h('div', null, h('span', { class: 'k' }, 'Sold today'), h('b', null, String(st.todayQty))),
        h('div', null, h('span', { class: 'k' }, 'Sales today'), h('b', null, money(st.todayAmt))),
        h('div', null, h('span', { class: 'k' }, 'Kitty'), h('b', null, money(st.fund)))),
      h('div', { class: 'label' }, 'Who’s paying?'),
      h('div', { class: 'chips' }, chip('Paid now', null), tabs.map((t) => chip(t.name, t.id, st.tabBal[t.id] || 0)),
        h('button', { class: 'chip add', onclick: () => newTab((id) => { chargeTo = id; render(); }) }, '+ Tab')),
      target ? h('div', { class: 'charge-note' }, 'Next drink goes on ' + target.name + '’s tab') : null,
      drinks.length ? h('div', { class: 'grid' }, drinks.map((d) => drinkCard(d, st)))
        : h('p', { class: 'empty' }, 'No drinks yet — add some on the Drinks page.'),
      h('p', { class: 'hint' }, 'Tap a drink once for each one sold.'),
    ];
  }
  function drinkCard(d, st) {
    const sold = st.sold[d.id] || 0;
    const left = st.stocked[d.id] ? (st.stock[d.id] || 0) : null;
    return h('button', { class: 'drink' + (left !== null && left <= 0 ? ' out' : ''), style: { '--c': d.color }, 'data-id': d.id, onclick: () => sell(d) },
      h('span', { class: 'dname' }, d.name), h('span', { class: 'dsize' }, d.size || ''),
      h('span', { class: 'dprice' }, money(d.price)),
      h('span', { class: 'dmeta' }, sold + ' sold' + (left === null ? '' : left > 0 ? ' · ' + left + ' left' : ' · out of stock')));
  }
  function sell(d) {
    const tab = chargeTo && tabById(chargeTo);
    const e = addEntry({ type: 'sale', drinkId: d.id, name: d.name, qty: 1, amount: d.price, tabId: tab ? tab.id : null, tabName: tab ? tab.name : null });
    chargeTo = null;
    render();
    const card = document.querySelector('.drink[data-id="' + d.id + '"]');
    if (card) { card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); }
    toast(d.name + ' · ' + money(d.price) + (tab ? ' → ' + tab.name + '’s tab' : ' · paid'), () => removeEntry(e.id));
  }

  /* ---------- Tabs ---------- */
  function balPill(bal) {
    if (bal < 0) return h('span', { class: 'pill owe' }, 'Owes ' + money(-bal));
    if (bal > 0) return h('span', { class: 'pill cred' }, money(bal) + ' credit');
    return h('span', { class: 'pill even' }, 'All square');
  }
  function tabsView(st) {
    const tabs = activeTabs();
    return [
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Owed to you'), h('b', { class: st.owed ? 'owe' : '' }, money(st.owed))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Paid ahead (credit)'), h('b', { class: st.credit ? 'cred' : '' }, money(st.credit)))),
      h('button', { class: 'btn primary wide', onclick: () => newTab() }, '+ New tab'),
      h('div', { class: 'label' }, 'People'),
      tabs.length ? h('div', { class: 'list' }, tabs.map((t) => {
        const bal = st.tabBal[t.id] || 0;
        return h('button', { class: 'li', onclick: () => openTab(t) }, h('span', { class: 'grow' }, h('span', { class: 't' }, t.name)), balPill(bal));
      })) : h('p', { class: 'empty' }, 'No tabs yet. Add a name for anyone who pays later, or pays ahead for a drink tomorrow.'),
      h('p', { class: 'hint' }, 'To put a drink on someone’s tab, pick their name on the Sell page before tapping the drink.'),
    ];
  }
  function newTab(cb) {
    const input = h('input', { class: 'input', placeholder: 'Name', autocomplete: 'off', autocapitalize: 'words', maxLength: 40 });
    const err = h('p', { class: 'err' });
    openSheet('New tab', (close) => {
      const go = () => {
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (!name) { err.textContent = 'Type a name.'; return; }
        let t = S.tabs.find((x) => !x.archived && x.name.toLowerCase() === name.toLowerCase());
        if (!t) { t = { id: uid(), name, archived: false, created: Date.now() }; S.tabs.push(t); save(); }
        close(); if (cb) cb(t.id); else render();
        toast('Tab ready for ' + t.name);
      };
      input.addEventListener('keydown', onEnter(go));
      setTimeout(() => input.focus(), 250);
      return h('div', { class: 'stack' }, field('Who is it?', input), err, h('button', { class: 'btn primary wide', onclick: go }, 'Add tab'));
    });
  }
  function openTab(t) {
    const bal = stats().tabBal[t.id] || 0;
    const custom = h('input', { class: 'input', inputMode: 'decimal', placeholder: 'Other $', autocomplete: 'off' });
    const err = h('p', { class: 'err' });
    const entries = S.log.filter((e) => e.tabId === t.id).slice(-25).reverse();
    openSheet(t.name, (close) => {
      const pay = (cents) => {
        if (!cents) { err.textContent = 'Enter an amount.'; return; }
        const e = addEntry({ type: 'pay', tabId: t.id, tabName: t.name, amount: cents });
        close(); render();
        toast(t.name + ' paid ' + money(cents), () => removeEntry(e.id));
      };
      custom.addEventListener('keydown', onEnter(() => pay(parseMoney(custom.value))));
      return h('div', null,
        h('div', { class: 'balance-big' }, h('span', { class: 'k' }, bal < 0 ? 'Owes you' : bal > 0 ? 'Credit (paid ahead)' : 'Balance'),
          h('b', { class: bal < 0 ? 'owe' : bal > 0 ? 'cred' : '' }, money(Math.abs(bal))),
          h('span', { class: 'small' }, bal > 0 ? 'Their next drinks come off this credit.' : bal < 0 ? 'Record a payment when they pay you.' : 'Nothing owing.')),
        h('div', { class: 'label' }, 'Record a payment'),
        h('div', { class: 'stack' },
          bal < 0 ? h('button', { class: 'btn primary wide', onclick: () => pay(-bal) }, 'Paid it all off · ' + money(-bal)) : null,
          h('div', { class: 'row4' }, [200, 500, 1000, 2000].map((c) => h('button', { class: 'btn', onclick: () => pay(c) }, money(c)))),
          h('div', { class: 'row2' }, custom, h('button', { class: 'btn primary', onclick: () => pay(parseMoney(custom.value)) }, 'Add payment')),
          err),
        h('div', { class: 'label' }, 'Recent'),
        entries.length ? h('div', { class: 'list' }, entries.map((e) => historyRow(e, () => { close(); }))) : h('p', { class: 'empty' }, 'Nothing yet.'),
        h('div', { class: 'sep' }),
        h('div', { class: 'row2' },
          h('button', { class: 'btn', onclick: () => { close(); renameTab(t); } }, 'Rename'),
          h('button', { class: 'btn danger', onclick: async () => {
            if (bal !== 0) { err.textContent = 'Settle the balance to zero before removing this tab.'; return; }
            close();
            if (await ask('Remove ' + t.name + '?', 'Their history stays in the Money page.', 'Remove tab', true)) { t.archived = true; save(); render(); }
          } }, 'Remove tab')));
    });
  }
  function renameTab(t) {
    const input = h('input', { class: 'input', value: t.name, autocomplete: 'off', autocapitalize: 'words', maxLength: 40 });
    openSheet('Rename tab', (close) => {
      const go = () => { const n = input.value.trim(); if (!n) return; t.name = n; save(); close(); render(); };
      input.addEventListener('keydown', onEnter(go));
      return h('div', { class: 'stack' }, field('Name', input), h('button', { class: 'btn primary wide', onclick: go }, 'Save'));
    });
  }

  /* ---------- Money ---------- */
  function describe(e) {
    const d = drinkById(e.drinkId); const dn = d ? d.name : (e.name || 'Drink');
    const t = tabById(e.tabId); const tn = t ? t.name : (e.tabName || 'Tab');
    switch (e.type) {
      case 'sale': return { title: dn + (e.qty > 1 ? ' ×' + e.qty : ''), sub: e.tabId ? 'On ' + tn + '’s tab' : 'Sold · paid', amt: e.tabId ? money(e.amount) : '+' + money(e.amount), cls: e.tabId ? 'dim' : 'pos' };
      case 'pay': return { title: tn + ' paid', sub: 'Tab payment', amt: '+' + money(e.amount), cls: 'pos' };
      case 'cashout': return { title: 'Cash out', sub: e.note || 'Spent from the kitty', amt: '−' + money(e.amount), cls: 'neg' };
      case 'cashin': return { title: 'Money added', sub: e.note || 'Added to the kitty', amt: '+' + money(e.amount), cls: 'pos' };
      case 'restock': return { title: 'Restocked ' + dn, sub: '+' + e.qty + ' added', amt: '', cls: 'dim' };
      case 'adjust': return { title: 'Stock count · ' + dn, sub: 'Set to ' + e.to + ' (' + (e.qty >= 0 ? '+' : '') + e.qty + ')', amt: '', cls: 'dim' };
      default: return { title: e.type, sub: '', amt: '', cls: 'dim' };
    }
  }
  function historyRow(e, before) {
    const x = describe(e);
    return h('div', { class: 'li' },
      h('span', { class: 'grow' }, h('span', { class: 't' }, x.title), h('span', { class: 's' }, x.sub + ' · ' + when(e.t))),
      x.amt ? h('span', { class: 'amt ' + x.cls }, x.amt) : null,
      h('button', { class: 'del', 'aria-label': 'Delete entry', onclick: async () => {
        if (before) before();
        if (await ask('Delete this entry?', x.title + ' — ' + when(e.t) + '. Totals will update.', 'Delete', true)) { removeEntry(e.id); toast('Entry deleted'); }
      } }, icon('trash')));
  }
  function moneyView(st) {
    const sold = S.drinks.filter((d) => st.sold[d.id]);
    const hist = S.log.slice().reverse();
    const stale = S.log.length > 10 && Date.now() - (S.settings.lastBackup || 0) > 14 * 86400000;
    return [
      h('section', { class: 'kitty' }, h('span', null, 'In the kitty'), h('strong', null, money(st.fund)),
        h('small', null, 'Cash + PayID received, minus money spent')),
      stale ? h('div', { class: 'nudge' }, h('span', { class: 'grow' }, 'It’s been a while since your last backup.'),
        h('button', { class: 'mini', onclick: exportBackup }, 'Back up')) : null,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Total sales'), h('b', null, money(st.takings))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Spent'), h('b', null, money(st.spent))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Owed to you'), h('b', { class: st.owed ? 'owe' : '' }, money(st.owed))),
        h('div', { class: 'stat' }, h('span', { class: 'k' }, 'Credit held'), h('b', { class: st.credit ? 'cred' : '' }, money(st.credit)))),
      h('div', { class: 'row2' },
        h('button', { class: 'btn primary', onclick: () => cashSheet('cashout') }, 'Cash out'),
        h('button', { class: 'btn', onclick: () => cashSheet('cashin') }, 'Add money')),
      h('h3', { class: 'section' }, 'Sold by drink'),
      sold.length ? h('div', { class: 'list' }, sold.map((d) => h('div', { class: 'li' }, h('span', { class: 'dot', style: { '--c': d.color } }),
        h('span', { class: 'grow' }, h('span', { class: 't' }, d.name + (d.archived ? ' (hidden)' : '')), h('span', { class: 's' }, st.sold[d.id] + ' sold')),
        h('span', { class: 'amt' }, money(st.soldAmt[d.id] || 0))))) : h('p', { class: 'empty' }, 'No sales yet.'),
      h('h3', { class: 'section' }, 'History'),
      hist.length ? h('div', { class: 'list' }, hist.slice(0, histLimit).map((e) => historyRow(e))) : h('p', { class: 'empty' }, 'Nothing recorded yet.'),
      hist.length > histLimit ? h('button', { class: 'btn ghost wide', onclick: () => { histLimit += 60; render(); } }, 'Show more') : null,
    ];
  }
  function cashSheet(type) {
    const out = type === 'cashout';
    const amt = h('input', { class: 'input', inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
    const note = h('input', { class: 'input', placeholder: out ? 'e.g. Costco restock, BBQ snags' : 'e.g. donation, starting float', autocomplete: 'off', maxLength: 80 });
    const err = h('p', { class: 'err' });
    openSheet(out ? 'Cash out' : 'Add money', (close) => {
      const go = () => {
        const c = parseMoney(amt.value);
        if (!c) { err.textContent = 'Enter an amount.'; return; }
        const e = addEntry({ type, amount: c, note: note.value.trim() || null });
        close(); render();
        toast((out ? 'Cashed out ' : 'Added ') + money(c), () => removeEntry(e.id));
      };
      amt.addEventListener('keydown', onEnter(go)); note.addEventListener('keydown', onEnter(go));
      setTimeout(() => amt.focus(), 250);
      return h('div', { class: 'stack' },
        h('p', { class: 'small' }, out ? 'Money you took out of the kitty to spend (restocks, BBQs, events). The kitty total goes down.' : 'Extra money put into the kitty that isn’t a drink sale or tab payment.'),
        field('Amount ($)', amt), field('What for? (optional)', note), err,
        h('button', { class: 'btn primary wide', onclick: go }, out ? 'Cash out' : 'Add money'));
    });
  }

  /* ---------- Drinks ---------- */
  function drinksView(st) {
    const active = activeDrinks(); const hidden = S.drinks.filter((d) => d.archived);
    return [
      h('button', { class: 'btn primary wide', onclick: () => editDrink(null) }, '+ Add a drink'),
      h('div', { class: 'label' }, 'On the sell page'),
      active.length ? h('div', { class: 'list' }, active.map((d) => {
        const left = st.stocked[d.id] ? (st.stock[d.id] || 0) : null;
        return h('div', { class: 'li' }, h('span', { class: 'dot', style: { '--c': d.color } }),
          h('button', { class: 'grow', onclick: () => editDrink(d) },
            h('span', { class: 't' }, d.name), h('span', { class: 's' }, [d.size, money(d.price), (st.sold[d.id] || 0) + ' sold', left === null ? 'stock not set' : left + ' left'].filter(Boolean).join(' · '))),
          h('button', { class: 'mini', onclick: () => restockSheet(d) }, 'Restock'));
      })) : h('p', { class: 'empty' }, 'No drinks on the sell page.'),
      hidden.length ? [h('div', { class: 'label' }, 'Hidden'), h('div', { class: 'list' }, hidden.map((d) => h('div', { class: 'li' }, h('span', { class: 'dot', style: { '--c': d.color } }),
        h('span', { class: 'grow' }, h('span', { class: 't' }, d.name), h('span', { class: 's' }, (st.sold[d.id] || 0) + ' sold')),
        h('button', { class: 'mini', onclick: () => { d.archived = false; save(); render(); } }, 'Show'))))] : null,
      h('p', { class: 'hint' }, 'Tap a drink to change its name, size, price or colour. Restock after a shopping run to keep the “left” count right.'),
    ];
  }
  function editDrink(d) {
    const isNew = !d;
    let color = d ? d.color : COLORS[S.drinks.length % COLORS.length];
    const name = h('input', { class: 'input', value: d ? d.name : '', placeholder: 'e.g. Pepsi Max', autocomplete: 'off', autocapitalize: 'words', maxLength: 40 });
    const size = h('input', { class: 'input', value: d ? d.size : '', placeholder: 'e.g. 375mL', autocomplete: 'off', maxLength: 16 });
    const price = h('input', { class: 'input', inputMode: 'decimal', value: d ? (d.price / 100).toFixed(2) : '', placeholder: '2.00', autocomplete: 'off' });
    const stock = h('input', { class: 'input', inputMode: 'numeric', placeholder: 'Leave blank to skip', autocomplete: 'off' });
    const err = h('p', { class: 'err' });
    const sw = h('div', { class: 'swatches' });
    const drawSw = () => sw.replaceChildren(...COLORS.map((c) => h('button', { class: 'sw' + (c === color ? ' on' : ''), style: { '--c': c }, 'aria-label': 'Colour', onclick: () => { color = c; drawSw(); } })));
    drawSw();
    openSheet(isNew ? 'New drink' : 'Edit drink', (close) => {
      const go = () => {
        const n = name.value.trim(); const p = parseMoney(price.value);
        if (!n) { err.textContent = 'Give it a name.'; return; }
        if (!p) { err.textContent = 'Enter a price, e.g. 2 or 4.50'; return; }
        if (isNew) {
          const nd = { id: uid(), name: n, size: size.value.trim(), price: p, color, archived: false };
          S.drinks.push(nd);
          const q = parseInt(stock.value, 10);
          if (q > 0) S.log.push({ id: uid(), t: Date.now(), type: 'restock', drinkId: nd.id, name: n, qty: q });
          toast(n + ' added to the sell page');
        } else { Object.assign(d, { name: n, size: size.value.trim(), price: p, color }); toast('Saved'); }
        save(); close(); render();
      };
      const move = (dir) => {
        const i = S.drinks.indexOf(d); const j = i + dir;
        if (j < 0 || j >= S.drinks.length) return;
        [S.drinks[i], S.drinks[j]] = [S.drinks[j], S.drinks[i]]; save(); render(); toast(dir < 0 ? 'Moved up' : 'Moved down');
      };
      return h('div', { class: 'stack' },
        field('Name', name), h('div', { class: 'row2' }, field('Size', size), field('Price ($)', price)),
        isNew ? field('How many do you have now? (optional)', stock) : null,
        h('div', { class: 'field' }, h('span', null, 'Colour'), sw), err,
        h('button', { class: 'btn primary wide', onclick: go }, isNew ? 'Add drink' : 'Save'),
        isNew ? null : [
          h('div', { class: 'row2' }, h('button', { class: 'btn', onclick: () => move(-1) }, '↑ Move up'), h('button', { class: 'btn', onclick: () => move(1) }, '↓ Move down')),
          h('button', { class: 'btn danger wide', onclick: () => { d.archived = true; save(); close(); render(); toast(d.name + ' hidden — bring it back from the Drinks page'); } }, 'Hide from sell page')],
        h('p', { class: 'small' }, 'Changing the price only affects new sales. Past sales keep the price they were sold at.'));
    });
  }
  function restockSheet(d) {
    const st = stats();
    const cur = st.stocked[d.id] ? (st.stock[d.id] || 0) : null;
    const qty = h('input', { class: 'input', inputMode: 'numeric', placeholder: 'How many cans?', autocomplete: 'off' });
    const spent = h('input', { class: 'input', inputMode: 'decimal', placeholder: 'Optional', autocomplete: 'off' });
    const count = h('input', { class: 'input', inputMode: 'numeric', placeholder: cur === null ? 'e.g. 12' : String(cur), autocomplete: 'off' });
    const err = h('p', { class: 'err' });
    openSheet('Restock ' + d.name, (close) => {
      const go = () => {
        const q = parseInt(qty.value, 10); const c = parseMoney(spent.value);
        if (!(q > 0)) { err.textContent = 'How many did you add?'; return; }
        S.log.push({ id: uid(), t: Date.now(), type: 'restock', drinkId: d.id, name: d.name, qty: q });
        if (c) S.log.push({ id: uid(), t: Date.now(), type: 'cashout', amount: c, note: 'Restock: ' + d.name + ' ×' + q });
        save(); close(); render(); toast('+' + q + ' ' + d.name + (c ? ' · ' + money(c) + ' cashed out' : ''));
      };
      const setCount = () => {
        const n = parseInt(count.value, 10);
        if (!(n >= 0)) { err.textContent = 'Type how many are in the fridge right now.'; return; }
        const delta = n - (cur || 0);
        S.log.push({ id: uid(), t: Date.now(), type: 'adjust', drinkId: d.id, name: d.name, qty: delta, to: n });
        save(); close(); render(); toast(d.name + ' count set to ' + n);
      };
      const qb = (n) => h('button', { class: 'btn', onclick: () => { qty.value = String((parseInt(qty.value, 10) || 0) + n); } }, '+' + n);
      return h('div', { class: 'stack' },
        h('p', { class: 'small' }, cur === null ? 'Stock not tracked yet for this drink.' : 'Currently ' + cur + ' left.'),
        h('div', { class: 'row4' }, qb(1), qb(6), qb(12), qb(24)),
        field('Cans added', qty), field('Spent on them ($) — takes it out of the kitty', spent), err,
        h('button', { class: 'btn primary wide', onclick: go }, 'Add stock'),
        h('div', { class: 'sep' }),
        field('Or correct the count (what’s in the fridge now)', count),
        h('button', { class: 'btn wide', onclick: setCount }, 'Set count'));
    });
  }
  const VIEWS = { sell: sellView, tabs: tabsView, money: moneyView, drinks: drinksView };

  /* ---------- Settings ---------- */
  function openSettings() {
    const sel = h('select', { class: 'input', onchange: () => { S.settings.autoLock = Number(sel.value); save(); toast('Auto-lock updated'); } },
      [[0, 'As soon as I leave the app'], [1, 'After 1 minute away'], [5, 'After 5 minutes away'], [15, 'After 15 minutes away'], [60, 'After 1 hour away']].map(([v, l]) =>
        h('option', { value: String(v), selected: S.settings.autoLock === v }, l)));
    const last = S.settings.lastBackup ? when(S.settings.lastBackup) : 'never';
    openSheet('Settings', (close) => h('div', { class: 'stack' },
      field('Lock the app', sel),
      h('button', { class: 'btn wide', onclick: () => { close(); changeCreds(); } }, 'Change number or passcode'),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn primary wide', onclick: exportBackup }, 'Back up now'),
      h('p', { class: 'small' }, 'Last backup: ' + last + '. Save it to Files or iCloud Drive. If you delete the app from your Home Screen, a backup is the only way to get your data back. The backup is encrypted with your number + passcode.'),
      h('button', { class: 'btn wide', onclick: () => { close(); pickBackup(false); } }, 'Restore from a backup'),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn wide', onclick: () => { close(); lockNow(); } }, 'Lock now'),
      h('button', { class: 'btn danger wide', onclick: () => { close(); eraseSheet(); } }, 'Erase everything'),
      h('p', { class: 'small' }, 'Stock tracker v' + VERSION + '. Your data is stored only on this phone, encrypted. Nothing is sent anywhere.')));
  }
  async function exportBackup() {
    await saveChain;
    const text = localStorage.getItem(VAULT_KEY);
    if (!text) return;
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const name = 'stock-tracker-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    const file = new File([text], name, { type: 'application/json' });
    const mark = () => { if (S) { S.settings.lastBackup = Date.now(); save(); render(); } };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Stock tracker backup' }); mark(); toast('Backup saved'); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    mark(); toast('Backup downloaded');
  }
  function pickBackup(atSetup) {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      let vault; try { vault = JSON.parse(await f.text()); } catch { vault = null; }
      if (!isVault(vault)) { toast('That file isn’t a Stock tracker backup.'); return; }
      credsSheet('Unlock backup', 'Enter the mobile number and passcode that were in use when this backup was made.', 'Unlock backup', async (num, pass) => {
        const key = await deriveKey(num, pass, unb64(vault.salt), vault.iter);
        let data; try { data = await unseal(key, vault); } catch { return 'That number + passcode doesn’t open this backup.'; }
        if (atSetup) {
          localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
          session = { key, salt: unb64(vault.salt), iter: vault.iter }; S = migrate(data); view = 'sell'; render(true);
          toast('Backup restored');
          return null;
        }
        if (!(await ask('Replace current data?', 'Everything in the app now will be replaced with this backup (' + data.log.length + ' entries). Your current number + passcode stay the same.', 'Replace', true))) return null;
        S = migrate(data); save(); render(true); toast('Backup restored');
        return null;
      });
    });
    inp.click();
  }
  function credsSheet(title, msg, okLabel, onSubmit) {
    const num = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputMode: 'tel', placeholder: 'Mobile number' });
    const pass = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Passcode' });
    const err = h('p', { class: 'err' });
    openSheet(title, (close) => {
      const btn = h('button', { class: 'btn primary wide' }, okLabel);
      const go = async () => {
        err.textContent = ''; btn.disabled = true; btn.textContent = 'Checking…';
        const res = await onSubmit(normNumber(num.value), pass.value);
        btn.disabled = false; btn.textContent = okLabel;
        if (res) err.textContent = res; else close();
      };
      btn.addEventListener('click', go); pass.addEventListener('keydown', onEnter(go));
      return h('div', { class: 'stack' }, h('p', { class: 'small' }, msg), field('Mobile number', num), field('Passcode', pass), err, btn);
    });
  }
  function changeCreds() {
    const cnum = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputMode: 'tel', placeholder: 'Current mobile number' });
    const cpass = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Current passcode' });
    const nnum = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputMode: 'tel', placeholder: 'New (or same) mobile number' });
    const npass = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'At least 6 digits' });
    const npass2 = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Type it again' });
    const err = h('p', { class: 'err' });
    openSheet('Change number or passcode', (close) => {
      const btn = h('button', { class: 'btn primary wide' }, 'Save');
      btn.addEventListener('click', async () => {
        err.textContent = '';
        const n2 = normNumber(nnum.value);
        if (n2.length < 8) { err.textContent = 'Enter the new mobile number.'; return; }
        if (npass.value.length < 6) { err.textContent = 'New passcode needs at least 6 digits.'; return; }
        if (npass.value !== npass2.value) { err.textContent = 'New passcodes don’t match.'; return; }
        btn.disabled = true; btn.textContent = 'Checking…';
        await saveChain;
        const vault = readVault();
        try { await unseal(await deriveKey(normNumber(cnum.value), cpass.value, unb64(vault.salt), vault.iter), vault); }
        catch { btn.disabled = false; btn.textContent = 'Save'; err.textContent = 'Current number or passcode is wrong.'; return; }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        session = { key: await deriveKey(n2, npass.value, salt, ITER), salt, iter: ITER };
        save(); await saveChain; close(); toast('Number + passcode updated. Make a fresh backup.');
      });
      return h('div', { class: 'stack' }, field('Current mobile number', cnum), field('Current passcode', cpass), h('div', { class: 'sep' }),
        field('New mobile number', nnum), field('New passcode', npass), field('Confirm new passcode', npass2), err, btn);
    });
  }
  function eraseSheet() {
    const inp = h('input', { class: 'input', placeholder: 'Type ERASE', autocomplete: 'off', autocapitalize: 'characters' });
    const err = h('p', { class: 'err' });
    openSheet('Erase everything?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'small' }, 'This deletes all drinks, tabs, sales and money records from this phone. It can’t be undone unless you have a backup file.'),
      inp, err,
      h('button', { class: 'btn danger wide', onclick: () => {
        if (inp.value.trim().toUpperCase() !== 'ERASE') { err.textContent = 'Type ERASE to confirm.'; return; }
        localStorage.removeItem(VAULT_KEY); localStorage.removeItem(LOCK_KEY);
        session = null; S = null; close(); render(true); toast('Erased');
      } }, 'Erase everything')));
  }

  /* ---------- Lock, unlock, setup ---------- */
  let lockTimer = 0;
  function getLockout() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } }
  function lockNow() {
    session = null; S = null; chargeTo = null; view = 'sell';
    closeAllSheets(); $('#toast-root').replaceChildren(); render(true);
  }
  function hero(sub) {
    return h('div', { class: 'lock-hero' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('h1', null, 'Stock tracker'), h('p', null, sub));
  }
  function unlockScreen() {
    const num = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputMode: 'tel', placeholder: 'Mobile number', 'aria-label': 'Mobile number' });
    const pass = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Passcode', 'aria-label': 'Passcode' });
    const err = h('p', { class: 'err' });
    const btn = h('button', { class: 'btn primary wide' }, 'Unlock');
    const tick = () => {
      const lk = getLockout(); const wait = Math.ceil((lk.until - Date.now()) / 1000);
      if (wait > 0) { btn.disabled = true; err.textContent = 'Too many wrong tries. Try again in ' + (wait >= 60 ? Math.ceil(wait / 60) + ' min' : wait + 's') + '.'; }
      else if (btn.textContent === 'Unlock') { btn.disabled = false; if (err.textContent.startsWith('Too many')) err.textContent = ''; }
    };
    const go = async () => {
      if (btn.disabled) return;
      const n = normNumber(num.value);
      if (n.length < 8 || !pass.value) { err.textContent = 'Enter your mobile number and passcode.'; return; }
      btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
      const vault = readVault(); const salt = unb64(vault.salt);
      try {
        const key = await deriveKey(n, pass.value, salt, vault.iter);
        const data = await unseal(key, vault);
        localStorage.removeItem(LOCK_KEY);
        session = { key, salt, iter: vault.iter }; S = migrate(data); view = 'sell';
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        render(true);
      } catch {
        const lk = getLockout(); lk.fails += 1;
        if (lk.fails >= 5) lk.until = Date.now() + Math.min(3600000, 30000 * 2 ** (lk.fails - 5));
        localStorage.setItem(LOCK_KEY, JSON.stringify(lk));
        btn.textContent = 'Unlock'; btn.disabled = false; pass.value = '';
        err.textContent = 'That mobile number + passcode didn’t match.'; tick();
      }
    };
    btn.addEventListener('click', go); pass.addEventListener('keydown', onEnter(go)); num.addEventListener('keydown', onEnter(() => pass.focus()));
    tick(); lockTimer = setInterval(tick, 1000);
    return h('div', { class: 'lock' }, hero('Locked'),
      h('div', { class: 'lock-body' },
        h('div', { class: 'lock-card' }, field('Mobile number', num), field('Passcode', pass), err, btn),
        h('div', { class: 'lock-links' },
          h('button', { class: 'btn ghost', onclick: () => ask('Forgot your passcode?', 'There’s no way to recover it — the data is encrypted with it. You can erase the app and restore from a backup file if you have one.', 'Erase and start again', true).then((ok) => { if (ok) eraseSheet(); }) }, 'Forgot passcode?'))));
  }
  function setupScreen() {
    const num = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputMode: 'tel', placeholder: 'e.g. 0412 345 678' });
    const pass = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'At least 6 digits' });
    const pass2 = h('input', { class: 'input', type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Type it again' });
    const err = h('p', { class: 'err' });
    const btn = h('button', { class: 'btn primary wide' }, 'Create my tracker');
    const go = async () => {
      const n = normNumber(num.value);
      if (n.length < 8) { err.textContent = 'Enter your mobile number.'; return; }
      if (pass.value.length < 6) { err.textContent = 'Passcode needs at least 6 digits.'; return; }
      if (pass.value !== pass2.value) { err.textContent = 'Passcodes don’t match.'; return; }
      btn.disabled = true; btn.textContent = 'Setting up…';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      session = { key: await deriveKey(n, pass.value, salt, ITER), salt, iter: ITER };
      S = freshState(); save(); await saveChain;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      view = 'sell'; render(true);
      toast('All set! Tap a drink each time one sells.');
    };
    btn.addEventListener('click', go); pass2.addEventListener('keydown', onEnter(go));
    return h('div', { class: 'lock' }, hero('Track drinks sold, tabs and the kitty.'),
      h('div', { class: 'lock-body' },
        h('div', { class: 'lock-card' },
          h('p', { class: 'small' }, 'Set up your lock. You’ll need both your mobile number and passcode to open the app. Everything stays on this phone, encrypted.'),
          field('Mobile number', num), field('Create a passcode', pass), field('Confirm passcode', pass2), err, btn),
        h('div', { class: 'lock-links' }, h('button', { class: 'btn ghost', onclick: () => pickBackup(true) }, 'Restore from a backup file'))));
  }

  /* ---------- auto-lock + updates ---------- */
  let hiddenAt = 0, pendingReload = false, reg = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (S && S.settings.autoLock === 0) lockNow();
      if (pendingReload) { saveChain.then(() => location.reload()); }
    } else {
      if (S && hiddenAt && Date.now() - hiddenAt >= S.settings.autoLock * 60000) lockNow();
      if (reg) reg.update().catch(() => {});
    }
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((r) => { reg = r; }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      const typing = [...document.querySelectorAll('input')].some((i) => i.value);
      if (S || typing || document.querySelector('.sheet-back')) pendingReload = true; else location.reload();
    });
  }

  render(true);
})();
