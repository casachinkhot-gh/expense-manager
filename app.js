'use strict';

// ═══════════════════════════════════════════════════════════════
// FIREBASE INIT
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyCZBz0zFCDrn1k1TKWWkvTKpzYD1BatO84",
  authDomain: "expense-manager-e19eb.firebaseapp.com",
  projectId: "expense-manager-e19eb",
  storageBucket: "expense-manager-e19eb.firebasestorage.app",
  messagingSenderId: "156515248598",
  appId: "1:156515248598:web:5656b8ac725d015fcd5c77"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// Enable offline persistence (app works without internet too)
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() :
    ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0
});
const fmtCurrency = n => INR.format(n);

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(iso) {
  return parseISO(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec'];
const fullMonth  = m => MONTH_FULL[m-1];
const shortMonth = m => MONTH_SHORT[m-1];

function currentYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function lastNMonths(n) {
  const result = [], d = new Date();
  for (let i = 0; i < n; i++) {
    result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    d.setMonth(d.getMonth() - 1);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════

const SEED_EXPENSE_TYPES = [
  { name: 'Food & Dining',  emoji: '🍽️' },
  { name: 'Transport',      emoji: '🚗' },
  { name: 'Utilities',      emoji: '💡' },
  { name: 'Shopping',       emoji: '🛍️' },
  { name: 'Health',         emoji: '💊' },
  { name: 'Entertainment',  emoji: '🎬' },
  { name: 'Rent / EMI',     emoji: '🏠' },
  { name: 'Education',      emoji: '📚' },
  { name: 'Other',          emoji: '📌' },
].map(e => ({ ...e, id: uuid() }));

let data = { expenseTypes: [], accounts: [], transactions: [], assets: [] };
let firestoreUnsub = null;

function userDocRef(uid) {
  return db.collection('users').doc(uid).collection('data').doc('appdata');
}

function setupSync(uid) {
  if (firestoreUnsub) firestoreUnsub();
  firestoreUnsub = userDocRef(uid).onSnapshot(snap => {
    if (snap.exists) {
      const d = snap.data();
      data.expenseTypes  = d.expenseTypes  || SEED_EXPENSE_TYPES;
      data.accounts      = d.accounts      || [];
      data.transactions  = d.transactions  || [];
      data.assets        = d.assets        || [];
    } else {
      // First sign-in — seed defaults
      data = {
        expenseTypes: SEED_EXPENSE_TYPES,
        accounts: [], transactions: [], assets: []
      };
      saveData();
    }
    render();
  }, err => {
    console.error('Firestore error:', err);
  });
}

function saveData() {
  const user = auth.currentUser;
  if (!user) return;
  userDocRef(user.uid).set(data).catch(console.error);
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

function signIn() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  auth.signInWithEmailAndPassword(email, password)
    .catch(err => {
      errEl.style.display = 'block';
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errEl.textContent = 'Incorrect password. Check your email for the reset link.';
      } else if (err.code === 'auth/user-not-found') {
        errEl.textContent = 'No account found for this email.';
      } else if (err.code === 'auth/too-many-requests') {
        errEl.textContent = 'Too many attempts. Please try again later.';
      } else {
        errEl.textContent = err.message;
      }
    });
}

function confirmSignOut() {
  if (confirm('Sign out? Your data is safely saved in the cloud.')) {
    if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
    auth.signOut();
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPUTATIONS
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_TYPES    = ['Bank', 'Cash', 'Credit Card', 'Wallet'];
const ASSET_CATEGORIES = ['Real Estate', 'Vehicle', 'Gold / Jewelry', 'Investments', 'Other'];
const isLiability      = acc => acc.type === 'Credit Card';

function balance(accountId) {
  const acc = data.accounts.find(a => a.id === accountId);
  if (!acc) return 0;
  let bal = acc.openingBalance;
  for (const t of data.transactions) {
    if (t.accountId === accountId) {
      if (t.type === 'income')   bal += t.amount;
      if (t.type === 'expense')  bal -= t.amount;
      if (t.type === 'transfer') bal -= t.amount;
    } else if (t.toAccountId === accountId) {
      bal += t.amount;
    }
  }
  return bal;
}

const totalLiquid      = () => data.accounts.filter(a => !isLiability(a)).reduce((s, a) => s + balance(a.id), 0);
const totalLiabilities = () => data.accounts.filter(a =>  isLiability(a)).reduce((s, a) => s + balance(a.id), 0);
const totalAssets      = () => data.assets.reduce((s, a) => s + a.value, 0);
const netWorth         = () => totalLiquid() + totalAssets() + totalLiabilities();

function monthlyTxns(year, month) {
  return data.transactions.filter(t => {
    const p = t.date.split('-');
    return +p[0] === year && +p[1] === month;
  });
}
const monthlyIncome   = (y, m) => monthlyTxns(y, m).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
const monthlyExpenses = (y, m) => monthlyTxns(y, m).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
const accountName     = id => (data.accounts.find(a => a.id === id) || {}).name || '—';
const expenseTypeName = id => { const e = data.expenseTypes.find(e => e.id === id); return e ? `${e.emoji} ${e.name}` : ''; };

// ═══════════════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════════════

let currentTab = 'dashboard';
let txnYear    = new Date().getFullYear();
let txnMonth   = new Date().getMonth() + 1;
let modalSaveFn = null;

// ═══════════════════════════════════════════════════════════════
// HTML HELPERS
// ═══════════════════════════════════════════════════════════════

const card     = html => `<div class="card">${html}</div>`;
const section  = (title, html) =>
  `<div class="section"><div class="section-title">${title}</div>${card(html)}</div>`;
const row      = (label, value, cls = '') =>
  `<div class="row"><span class="row-label">${label}</span><span class="row-value ${cls}">${value}</span></div>`;
const divRow   = () => `<div class="divider-row"></div>`;
const colorCls = n => n >= 0 ? 'green' : 'red';
const bold     = s => `<strong>${s}</strong>`;
const esc      = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════

function showModal(title, bodyHTML, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalSaveFn = onSave;
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalSaveFn = null;
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
  const ym  = currentYM();
  const inc = monthlyIncome(ym.year, ym.month);
  const exp = monthlyExpenses(ym.year, ym.month);
  const net = inc - exp;
  const liq = totalLiquid(), liab = totalLiabilities(), ass = totalAssets(), nw = netWorth();

  let accHTML = '';
  if (!data.accounts.length) {
    accHTML = '<p class="empty-msg">No accounts yet — add one in Settings.</p>';
  } else {
    data.accounts.forEach(acc => {
      const bal = balance(acc.id);
      accHTML += `<div class="row account-row">
        <div>
          <div class="row-label">${esc(acc.name)}</div>
          <span class="tag ${isLiability(acc) ? 'tag-red' : 'tag-blue'}" style="margin-top:4px">${acc.type}</span>
        </div>
        <span class="row-value ${bal < 0 ? 'red' : ''}">${fmtCurrency(bal)}</span>
      </div>`;
    });
    accHTML += divRow();
    accHTML += row(bold('Total (excl. credit cards)'), bold(fmtCurrency(liq)), liq < 0 ? 'red' : 'blue');
  }

  return `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="page-content">
      ${section('Running Balances', accHTML)}
      ${section(`This Month — ${fullMonth(ym.month)} ${ym.year}`, `
        ${row('Income',   fmtCurrency(inc), 'green')}
        ${row('Expenses', fmtCurrency(exp), 'red')}
        ${divRow()}
        ${row(bold('Net Savings'), bold(fmtCurrency(net)), colorCls(net))}
      `)}
      ${section('Net Worth Snapshot', `
        ${row('Bank / Cash / Wallet', fmtCurrency(liq))}
        ${row('Physical Assets',      fmtCurrency(ass))}
        ${liab !== 0 ? row('Credit Card Outstanding', fmtCurrency(liab), 'red') : ''}
        ${divRow()}
        ${row(bold('Net Worth'), bold(fmtCurrency(nw)), colorCls(nw))}
      `)}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════

function renderTransactions() {
  const txns = monthlyTxns(txnYear, txnMonth).sort((a, b) => b.date.localeCompare(a.date));
  const inc  = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp  = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net  = inc - exp;
  const ym   = currentYM();
  const isCurrent  = txnYear === ym.year && txnMonth === ym.month;
  const noAccounts = !data.accounts.length;

  let listHTML = !txns.length
    ? '<p class="empty-msg">No transactions for this month.</p>'
    : txns.map(t => {
        const cls      = { income: 'green', expense: 'red', transfer: 'orange' }[t.type] || '';
        const catLine  = t.type === 'expense' && t.expenseTypeId
          ? `<span class="txn-category">${esc(expenseTypeName(t.expenseTypeId))}</span>` : '';
        const xferLine = t.type === 'transfer'
          ? `<span class="txn-category">→ ${esc(accountName(t.toAccountId))}</span>` : '';
        const noteLine = t.note ? `<div class="txn-note">${esc(t.note)}</div>` : '';
        return `<div class="txn-row">
          <div class="txn-left">
            <div class="txn-top"><span class="tag tag-${cls}">${t.type}</span>${catLine}${xferLine}</div>
            <div class="txn-account">${esc(accountName(t.accountId))}</div>
            ${noteLine}
          </div>
          <div class="txn-right">
            <span class="txn-amount ${cls}">${fmtCurrency(t.amount)}</span>
            <span class="txn-date">${fmtDate(t.date)}</span>
            <div style="display:flex;gap:4px">
              <button class="edit-btn"   data-edit-txn="${t.id}">✎</button>
              <button class="delete-btn" data-del-txn="${t.id}">✕</button>
            </div>
          </div>
        </div>`;
      }).join('');

  return `
    <div class="page-header">
      <h1>Transactions</h1>
      <button class="header-btn" onclick="openAddTxn()" ${noAccounts ? 'disabled' : ''}>+ Add</button>
    </div>
    <div class="month-nav">
      <button onclick="shiftMonth(-1)">‹</button>
      <span>${fullMonth(txnMonth)} ${txnYear}</span>
      <button onclick="shiftMonth(1)" ${isCurrent ? 'disabled' : ''}>›</button>
    </div>
    <div class="summary-bar">
      <span class="green">▼ ${fmtCurrency(inc)}</span>
      <span class="red">▲ ${fmtCurrency(exp)}</span>
      <span class="${colorCls(net)}">Net: ${fmtCurrency(net)}</span>
    </div>
    <div class="page-content">${card(listHTML)}</div>`;
}

function shiftMonth(delta) {
  const d = new Date(txnYear, txnMonth - 1, 1);
  d.setMonth(d.getMonth() + delta);
  txnYear = d.getFullYear(); txnMonth = d.getMonth() + 1;
  render();
}

function openAddTxn() {
  const accOpts = data.accounts.map(a =>
    `<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join('');
  const catOpts = data.expenseTypes.map(e =>
    `<option value="${e.id}">${esc(e.emoji + ' ' + e.name)}</option>`).join('');

  showModal('Add Transaction', `
    <div class="form-group">
      <label>Type</label>
      <div class="seg-control" id="txn-seg">
        <button class="seg-btn active" data-val="expense"  onclick="setSeg(this,'txn-seg');toggleTxnFields()">Expense</button>
        <button class="seg-btn"        data-val="income"   onclick="setSeg(this,'txn-seg');toggleTxnFields()">Income</button>
        <button class="seg-btn"        data-val="transfer" onclick="setSeg(this,'txn-seg');toggleTxnFields()">Transfer</button>
      </div>
    </div>
    <div class="form-group">
      <label>Amount (₹)</label>
      <input id="f-amount" type="number" min="0.01" step="0.01" placeholder="0" inputmode="decimal">
    </div>
    <div class="form-group">
      <label>Date</label>
      <input id="f-date" type="date" value="${todayISO()}">
    </div>
    <div class="form-group">
      <label>Account</label>
      <select id="f-acc"><option value="">— Select —</option>${accOpts}</select>
    </div>
    <div class="form-group" id="f-to-grp" style="display:none">
      <label>To Account</label>
      <select id="f-to-acc"><option value="">— Select —</option>${accOpts}</select>
    </div>
    <div class="form-group" id="f-cat-grp">
      <label>Category</label>
      <select id="f-cat"><option value="">— None —</option>${catOpts}</select>
    </div>
    <div class="form-group">
      <label>Note (optional)</label>
      <input id="f-note" type="text" placeholder="Description">
    </div>
  `, saveTxn);
}

function toggleTxnFields() {
  const type = getActiveSeg('txn-seg');
  document.getElementById('f-to-grp').style.display  = type === 'transfer' ? '' : 'none';
  document.getElementById('f-cat-grp').style.display = type === 'expense'  ? '' : 'none';
}

function saveTxn() {
  const type      = getActiveSeg('txn-seg');
  const amount    = parseFloat(document.getElementById('f-amount').value);
  const date      = document.getElementById('f-date').value;
  const accountId = document.getElementById('f-acc').value;
  const toAccId   = document.getElementById('f-to-acc')?.value || '';
  const catId     = document.getElementById('f-cat')?.value   || '';
  const note      = document.getElementById('f-note').value.trim();

  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return false; }
  if (!date)      { alert('Select a date.');     return false; }
  if (!accountId) { alert('Select an account.'); return false; }
  if (type === 'transfer' && !toAccId)            { alert('Select a destination account.'); return false; }
  if (type === 'transfer' && toAccId === accountId) { alert('From and To accounts must differ.'); return false; }

  data.transactions.push({
    id: uuid(), date, amount, type, accountId,
    toAccountId:   type === 'transfer' ? toAccId  : null,
    expenseTypeId: type === 'expense'  ? (catId || null) : null,
    note
  });
  saveData();
  return true;
}

function openEditTxn(id) {
  const txn = data.transactions.find(t => t.id === id);
  if (!txn) return;
  const accOpts = data.accounts.map(a =>
    `<option value="${a.id}" ${a.id === txn.accountId ? 'selected':''}>${esc(a.name)} (${a.type})</option>`).join('');
  const toAccOpts = data.accounts.map(a =>
    `<option value="${a.id}" ${a.id === txn.toAccountId ? 'selected':''}>${esc(a.name)} (${a.type})</option>`).join('');
  const catOpts = data.expenseTypes.map(e =>
    `<option value="${e.id}" ${e.id === txn.expenseTypeId ? 'selected':''}>${esc(e.emoji+' '+e.name)}</option>`).join('');
  const t = txn.type;
  showModal('Edit Transaction', `
    <div class="form-group">
      <label>Type</label>
      <div class="seg-control" id="txn-seg">
        <button class="seg-btn ${t==='expense'?'active':''}"  data-val="expense"  onclick="setSeg(this,'txn-seg');toggleTxnFields()">Expense</button>
        <button class="seg-btn ${t==='income'?'active':''}"   data-val="income"   onclick="setSeg(this,'txn-seg');toggleTxnFields()">Income</button>
        <button class="seg-btn ${t==='transfer'?'active':''}" data-val="transfer" onclick="setSeg(this,'txn-seg');toggleTxnFields()">Transfer</button>
      </div>
    </div>
    <div class="form-group">
      <label>Amount (₹)</label>
      <input id="f-amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${txn.amount}">
    </div>
    <div class="form-group">
      <label>Date</label>
      <input id="f-date" type="date" value="${txn.date}">
    </div>
    <div class="form-group">
      <label>Account</label>
      <select id="f-acc"><option value="">— Select —</option>${accOpts}</select>
    </div>
    <div class="form-group" id="f-to-grp" style="display:${t==='transfer'?'':'none'}">
      <label>To Account</label>
      <select id="f-to-acc"><option value="">— Select —</option>${toAccOpts}</select>
    </div>
    <div class="form-group" id="f-cat-grp" style="display:${t==='expense'?'':'none'}">
      <label>Category</label>
      <select id="f-cat"><option value="">— None —</option>${catOpts}</select>
    </div>
    <div class="form-group">
      <label>Note (optional)</label>
      <input id="f-note" type="text" value="${esc(txn.note||'')}">
    </div>
  `, () => saveEditTxn(id));
}

function saveEditTxn(id) {
  const type      = getActiveSeg('txn-seg');
  const amount    = parseFloat(document.getElementById('f-amount').value);
  const date      = document.getElementById('f-date').value;
  const accountId = document.getElementById('f-acc').value;
  const toAccId   = document.getElementById('f-to-acc')?.value || '';
  const catId     = document.getElementById('f-cat')?.value   || '';
  const note      = document.getElementById('f-note').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return false; }
  if (!date)      { alert('Select a date.');     return false; }
  if (!accountId) { alert('Select an account.'); return false; }
  if (type === 'transfer' && !toAccId)              { alert('Select a destination account.'); return false; }
  if (type === 'transfer' && toAccId === accountId) { alert('From and To must differ.');       return false; }
  const i = data.transactions.findIndex(t => t.id === id);
  if (i >= 0) data.transactions[i] = {
    ...data.transactions[i], date, amount, type, accountId,
    toAccountId:   type === 'transfer' ? toAccId : null,
    expenseTypeId: type === 'expense'  ? (catId || null) : null,
    note
  };
  saveData();
  return true;
}

// ═══════════════════════════════════════════════════════════════
// ASSETS
// ═══════════════════════════════════════════════════════════════

function renderAssets() {
  let contentHTML = '';
  if (!data.assets.length) {
    contentHTML = `<div class="page-content">${card('<p class="empty-msg">No assets yet. Tap + to add.</p>')}</div>`;
  } else {
    ASSET_CATEGORIES.forEach(cat => {
      const items = data.assets.filter(a => a.category === cat);
      if (!items.length) return;
      contentHTML += section(cat, items.map(a => `
        <div class="row account-row">
          <div>
            <div class="row-label">${esc(a.name)}</div>
            <div class="txn-date" style="margin-top:2px">As of ${fmtDate(a.asOfDate)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="row-value">${fmtCurrency(a.value)}</span>
            <button class="edit-btn"   data-edit-asset="${a.id}">✎</button>
            <button class="delete-btn" data-del-asset="${a.id}">✕</button>
          </div>
        </div>`).join(''));
    });
    contentHTML += section('Summary',
      row(bold('Total Assets'), bold(fmtCurrency(totalAssets())), 'blue'));
    contentHTML = `<div class="page-content">${contentHTML}</div>`;
  }
  return `
    <div class="page-header">
      <h1>Assets</h1>
      <button class="header-btn" onclick="openAddAsset(null)">+ Add</button>
    </div>${contentHTML}`;
}

function openAddAsset(id) {
  const asset   = id ? data.assets.find(a => a.id === id) : null;
  const catOpts = ASSET_CATEGORIES.map(c =>
    `<option value="${c}" ${asset?.category === c ? 'selected':''}>${c}</option>`).join('');
  showModal(asset ? 'Edit Asset' : 'Add Asset', `
    <div class="form-group">
      <label>Name</label>
      <input id="a-name" type="text" placeholder="e.g. Flat in Mumbai" value="${esc(asset?.name||'')}">
    </div>
    <div class="form-group">
      <label>Category</label>
      <select id="a-cat">${catOpts}</select>
    </div>
    <div class="form-group">
      <label>Current Value (₹)</label>
      <input id="a-val" type="number" min="0" step="1" placeholder="0" inputmode="decimal" value="${asset?.value||''}">
    </div>
    <div class="form-group">
      <label>As of Date</label>
      <input id="a-date" type="date" value="${asset?.asOfDate || todayISO()}">
    </div>
  `, () => saveAsset(id));
}

function saveAsset(existingId) {
  const name    = document.getElementById('a-name').value.trim();
  const cat     = document.getElementById('a-cat').value;
  const value   = parseFloat(document.getElementById('a-val').value);
  const asOfDate = document.getElementById('a-date').value;
  if (!name)               { alert('Enter a name.');        return false; }
  if (isNaN(value)||value<0) { alert('Enter a valid value.'); return false; }
  if (!asOfDate)           { alert('Select a date.');       return false; }
  if (existingId) {
    const i = data.assets.findIndex(a => a.id === existingId);
    if (i >= 0) data.assets[i] = { ...data.assets[i], name, category: cat, value, asOfDate };
  } else {
    data.assets.push({ id: uuid(), name, category: cat, value, asOfDate });
  }
  saveData();
  return true;
}

// ═══════════════════════════════════════════════════════════════
// NET WORTH
// ═══════════════════════════════════════════════════════════════

function renderNetWorth() {
  const liq = totalLiquid(), liab = totalLiabilities(), ass = totalAssets(), nw = netWorth();

  let brkHTML = '';
  if (!data.accounts.length && !data.assets.length) {
    brkHTML = '<p class="empty-msg">Add accounts and assets to see your net worth.</p>';
  } else {
    data.accounts.filter(a => !isLiability(a)).forEach(a => {
      brkHTML += row(esc(a.name), fmtCurrency(balance(a.id)));
    });
    if (data.accounts.some(a => !isLiability(a))) {
      brkHTML += row(bold('Total Liquid'), bold(fmtCurrency(liq)), 'blue');
      brkHTML += divRow();
    }
    ASSET_CATEGORIES.forEach(cat => {
      const tot = data.assets.filter(a => a.category === cat).reduce((s, a) => s + a.value, 0);
      if (tot > 0) brkHTML += row(cat, fmtCurrency(tot));
    });
    if (data.assets.length) brkHTML += row(bold('Total Assets'), bold(fmtCurrency(ass)), 'blue');
    if (liab !== 0) {
      brkHTML += divRow();
      data.accounts.filter(a => isLiability(a)).forEach(a => {
        brkHTML += row(esc(a.name), fmtCurrency(balance(a.id)), 'red');
      });
      brkHTML += row(bold('Total Liabilities'), bold(fmtCurrency(liab)), 'red');
    }
    brkHTML += divRow();
    brkHTML += `<div class="row">
      <span class="row-label" style="font-size:1.05em;font-weight:700">NET WORTH</span>
      <span class="row-value ${colorCls(nw)}" style="font-size:1.1em;font-weight:700">${fmtCurrency(nw)}</span>
    </div>`;
  }

  const months = lastNMonths(12);
  let plHTML = `<div class="pl-header">
    <span>Month</span><span class="green">Income</span><span class="red">Expense</span><span>Net</span>
  </div>`;
  let hasRows = false;
  months.forEach(ym => {
    const inc = monthlyIncome(ym.year, ym.month), exp = monthlyExpenses(ym.year, ym.month);
    if (!inc && !exp) return;
    hasRows = true;
    const net = inc - exp;
    plHTML += `<div class="pl-row">
      <span>${shortMonth(ym.month)} ${ym.year}</span>
      <span class="green">${fmtCurrency(inc)}</span>
      <span class="red">${fmtCurrency(exp)}</span>
      <span class="${colorCls(net)}">${fmtCurrency(net)}</span>
    </div>`;
  });
  if (!hasRows) plHTML += '<p class="empty-msg">No transactions in the last 12 months.</p>';

  return `
    <div class="page-header">
      <h1>Net Worth</h1>
      <button class="header-btn" onclick="exportExcel()">⬇ Excel</button>
    </div>
    <div class="page-content">
      ${section('Current Net Worth', brkHTML)}
      ${section('Monthly P&L — Last 12 Months', plHTML)}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

function renderSettings() {
  const user = auth.currentUser;

  let accHTML = data.accounts.length
    ? data.accounts.map(acc => `
      <div class="row account-row">
        <div>
          <div class="row-label">${esc(acc.name)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">
            <span class="tag ${isLiability(acc)?'tag-red':'tag-blue'}">${acc.type}</span>
            <span class="txn-date">Opening: ${fmtCurrency(acc.openingBalance)}</span>
          </div>
          <div class="txn-date">Current: ${fmtCurrency(balance(acc.id))}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="edit-btn"   data-edit-acc="${acc.id}">✎</button>
          <button class="delete-btn" data-del-acc="${acc.id}">✕</button>
        </div>
      </div>`).join('')
    : '<p class="empty-msg">No accounts yet.</p>';
  accHTML += `<button class="add-row-btn" onclick="openAddAccount()">+ Add Account</button>`;

  let etHTML = data.expenseTypes.length
    ? data.expenseTypes.map(e => `
      <div class="row">
        <span>${esc(e.emoji)} ${esc(e.name)}</span>
        <button class="delete-btn" data-del-et="${e.id}">✕</button>
      </div>`).join('')
    : '<p class="empty-msg">No categories.</p>';
  etHTML += `<button class="add-row-btn" onclick="openAddExpenseType()">+ Add Category</button>`;

  return `
    <div class="page-header"><h1>Settings</h1></div>
    <div class="page-content">
      ${section('Accounts & Payment Methods', accHTML)}
      ${section('Expense Categories', etHTML)}
      ${section('My Account', `
        ${row('Signed in as', esc(user?.email || ''))}
        ${row('Sync', '<span class="green">● Live</span>')}
        <button class="add-row-btn" style="color:var(--red)" onclick="confirmSignOut()">Sign Out</button>
      `)}
    </div>`;
}

function openAddAccount() {
  const typeOpts = ACCOUNT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
  showModal('Add Account', `
    <div class="form-group">
      <label>Account Name</label>
      <input id="ac-name" type="text" placeholder="e.g. HDFC Savings">
    </div>
    <div class="form-group">
      <label>Type</label>
      <select id="ac-type">${typeOpts}</select>
    </div>
    <div class="form-group">
      <label>Opening Balance (₹)</label>
      <input id="ac-bal" type="number" step="0.01" placeholder="0" inputmode="decimal" value="0">
    </div>
    <div class="form-group">
      <label>As of Date</label>
      <input id="ac-date" type="date" value="${todayISO()}">
    </div>
  `, saveAccount);
}

function saveAccount() {
  const name = document.getElementById('ac-name').value.trim();
  const type = document.getElementById('ac-type').value;
  const bal  = parseFloat(document.getElementById('ac-bal').value) || 0;
  const date = document.getElementById('ac-date').value;
  if (!name) { alert('Enter an account name.'); return false; }
  if (!date) { alert('Select a date.');         return false; }
  data.accounts.push({ id: uuid(), name, type, openingBalance: bal, openingDate: date });
  saveData();
  return true;
}

function openEditAccount(id) {
  const acc = data.accounts.find(a => a.id === id);
  if (!acc) return;
  const typeOpts = ACCOUNT_TYPES.map(t =>
    `<option value="${t}" ${acc.type === t ? 'selected' : ''}>${t}</option>`).join('');
  showModal('Edit Account', `
    <div class="form-group">
      <label>Account Name</label>
      <input id="ac-name" type="text" value="${esc(acc.name)}">
    </div>
    <div class="form-group">
      <label>Type</label>
      <select id="ac-type">${typeOpts}</select>
    </div>
    <div class="form-group">
      <label>Opening Balance (₹)</label>
      <input id="ac-bal" type="number" step="0.01" inputmode="decimal" value="${acc.openingBalance}">
    </div>
    <div class="form-group">
      <label>As of Date</label>
      <input id="ac-date" type="date" value="${acc.openingDate}">
    </div>
  `, () => saveEditAccount(id));
}

function saveEditAccount(id) {
  const name = document.getElementById('ac-name').value.trim();
  const type = document.getElementById('ac-type').value;
  const bal  = parseFloat(document.getElementById('ac-bal').value) || 0;
  const date = document.getElementById('ac-date').value;
  if (!name) { alert('Enter an account name.'); return false; }
  if (!date) { alert('Select a date.');         return false; }
  const i = data.accounts.findIndex(a => a.id === id);
  if (i >= 0) data.accounts[i] = { ...data.accounts[i], name, type, openingBalance: bal, openingDate: date };
  saveData();
  return true;
}

const EMOJI_PALETTE = ['🍽️','🚗','💡','🛍️','💊','🎬','🏠','💼','✈️','📚','🎓','🏋️','👗','💇','🖥️','🏏','🐾','🎵','🎮','🏥','⛽','🔧','🌐','📌'];

function openAddExpenseType() {
  const picker = EMOJI_PALETTE.map(e =>
    `<button class="emoji-btn" onclick="pickEmoji('${e}',this)">${e}</button>`).join('');
  showModal('Add Category', `
    <div class="form-group">
      <label>Category Name</label>
      <input id="et-name" type="text" placeholder="e.g. Groceries">
    </div>
    <div class="form-group">
      <label>Emoji</label>
      <input id="et-emoji" type="text" maxlength="2" value="📌"
        style="width:56px;text-align:center;font-size:1.5em;padding:6px">
    </div>
    <div class="form-group">
      <label>Quick Pick</label>
      <div class="emoji-grid">${picker}</div>
    </div>
  `, saveExpenseType);
}
function pickEmoji(e, btn) {
  document.getElementById('et-emoji').value = e;
  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function saveExpenseType() {
  const name  = document.getElementById('et-name').value.trim();
  const emoji = document.getElementById('et-emoji').value.trim();
  if (!name)  { alert('Enter a name.');  return false; }
  if (!emoji) { alert('Pick an emoji.'); return false; }
  data.expenseTypes.push({ id: uuid(), name, emoji });
  saveData();
  return true;
}

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════

function exportExcel() {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Account Balances
  const accRows = [['Account', 'Type', 'Opening Balance', 'Current Balance']];
  data.accounts.forEach(a =>
    accRows.push([a.name, a.type, a.openingBalance, balance(a.id)]));
  accRows.push([], ['Total Liquid', '', '', totalLiquid()],
                   ['Total Liabilities', '', '', totalLiabilities()],
                   ['Net Worth', '', '', netWorth()]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accRows), 'Accounts');

  // Sheet 2 — All Transactions
  const txnRows = [['Date', 'Type', 'Category', 'Account', 'To Account', 'Amount (₹)', 'Note']];
  [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).forEach(t =>
    txnRows.push([
      fmtDate(t.date), t.type,
      t.expenseTypeId ? expenseTypeName(t.expenseTypeId) : '',
      accountName(t.accountId),
      t.toAccountId   ? accountName(t.toAccountId) : '',
      t.type === 'income' ? t.amount : -t.amount,
      t.note || ''
    ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txnRows), 'Transactions');

  // Sheet 3 — Assets
  const assetRows = [['Name', 'Category', 'Value (₹)', 'As of Date']];
  data.assets.forEach(a =>
    assetRows.push([a.name, a.category, a.value, fmtDate(a.asOfDate)]));
  assetRows.push([], ['Total Assets', '', totalAssets(), '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assetRows), 'Assets');

  // Sheet 4 — Monthly P&L
  const plRows = [['Month', 'Income (₹)', 'Expenses (₹)', 'Net Savings (₹)']];
  lastNMonths(12).forEach(ym => {
    const inc = monthlyIncome(ym.year, ym.month);
    const exp = monthlyExpenses(ym.year, ym.month);
    if (inc || exp) plRows.push([`${shortMonth(ym.month)} ${ym.year}`, inc, exp, inc - exp]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plRows), 'Monthly P&L');

  XLSX.writeFile(wb, `ExpenseReport_${todayISO()}.xlsx`);
}

// ═══════════════════════════════════════════════════════════════
// SEGMENTED CONTROL
// ═══════════════════════════════════════════════════════════════

function setSeg(btn, groupId) {
  document.querySelectorAll(`#${groupId} .seg-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function getActiveSeg(groupId) {
  return document.querySelector(`#${groupId} .seg-btn.active`)?.dataset.val || '';
}

// ═══════════════════════════════════════════════════════════════
// RENDER & NAVIGATION
// ═══════════════════════════════════════════════════════════════

function render() {
  const el = document.getElementById('content');
  if (!el) return;
  const renderers = {
    dashboard: renderDashboard, transactions: renderTransactions,
    assets: renderAssets, networth: renderNetWorth, settings: renderSettings
  };
  el.innerHTML = renderers[currentTab]();
  el.scrollTop = 0;
  attachListeners();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

function attachListeners() {
  document.querySelectorAll('[data-del-txn]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this transaction?')) return;
    data.transactions = data.transactions.filter(t => t.id !== btn.dataset.delTxn);
    saveData(); render();
  }));
  document.querySelectorAll('[data-del-acc]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete account and all its transactions?')) return;
    data.accounts     = data.accounts.filter(a => a.id !== btn.dataset.delAcc);
    data.transactions = data.transactions.filter(t => t.accountId !== btn.dataset.delAcc);
    saveData(); render();
  }));
  document.querySelectorAll('[data-del-asset]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this asset?')) return;
    data.assets = data.assets.filter(a => a.id !== btn.dataset.delAsset);
    saveData(); render();
  }));
  document.querySelectorAll('[data-edit-asset]').forEach(btn =>
    btn.addEventListener('click', () => openAddAsset(btn.dataset.editAsset)));
  document.querySelectorAll('[data-edit-txn]').forEach(btn =>
    btn.addEventListener('click', () => openEditTxn(btn.dataset.editTxn)));
  document.querySelectorAll('[data-edit-acc]').forEach(btn =>
    btn.addEventListener('click', () => openEditAccount(btn.dataset.editAcc)));
  document.querySelectorAll('[data-del-et]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this category?')) return;
    data.expenseTypes = data.expenseTypes.filter(e => e.id !== btn.dataset.delEt);
    saveData(); render();
  }));
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

function init() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Modal buttons
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', () => {
    if (modalSaveFn && modalSaveFn() !== false) { closeModal(); render(); }
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // Allow submitting login form with Enter key
  document.getElementById('login-password')
    .addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });

  // Auth state drives everything
  auth.onAuthStateChanged(user => {
    if (user) {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      setupSync(user.uid);
    } else {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
      if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
    }
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
