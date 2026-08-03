(() => {
  'use strict';

  const KEY = 'stock-sim.v1';
  const RATE_MIN = -100;
  const RATE_MAX = 1000;

  const state = {
    holdings: [],
    rate: 0,        // 全銘柄一律の変動率（%）
    expandedId: null,
    panelPrice: 0,  // 展開中カードの目標株価
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const nf = new Intl.NumberFormat('ja-JP');
  const pf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

  // --- 数値ユーティリティ --------------------------------------------------

  function parseNum(input) {
    const s = String(input == null ? '' : input)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[．]/g, '.')
      .replace(/[＋]/g, '+')
      .replace(/[－ー―−]/g, '-')
      .replace(/[,\s¥￥%％円株]/g, '');
    if (s === '' || s === '-' || s === '+' || s === '.') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  const yen = (n) => '¥' + nf.format(Math.round(n));
  const priceStr = (n) => pf.format(Number(n.toFixed(2)));

  function signedYen(n) {
    const r = Math.round(n);
    return (r > 0 ? '+' : r < 0 ? '-' : '±') + '¥' + nf.format(Math.abs(r));
  }

  function pctStr(n) {
    if (!Number.isFinite(n)) return '—';
    return (n > 0 ? '+' : n < 0 ? '-' : '±') + Math.abs(n).toFixed(2) + '%';
  }

  const signClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
  const trimNum = (n) => String(Number(n.toFixed(2)));
  const clampRate = (r) => Math.min(RATE_MAX, Math.max(RATE_MIN, r));

  function setSigned(el, value, text) {
    el.textContent = text;
    el.classList.remove('up', 'down');
    const c = signClass(value);
    if (c) el.classList.add(c);
  }

  // --- 保存 ---------------------------------------------------------------

  function normalize(h) {
    const shares = Number(h.shares);
    const avgCost = Number(h.avgCost);
    const price = Number(h.price);
    if (![shares, avgCost, price].every(Number.isFinite)) return null;
    if (shares < 0 || avgCost < 0 || price < 0) return null;
    return {
      id: String(h.id || newId()),
      name: String(h.name || '').slice(0, 40) || '(名称未設定)',
      code: String(h.code || '').slice(0, 12),
      shares,
      avgCost,
      price,
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      return; // プライベートブラウズ等で読めない場合はメモリ上のみで動かす
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data.holdings)) {
        state.holdings = data.holdings.map(normalize).filter(Boolean);
      }
      if (Number.isFinite(data.rate)) state.rate = clampRate(data.rate);
    } catch (e) {
      console.warn('保存データを読めませんでした', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, holdings: state.holdings, rate: state.rate }));
    } catch (e) {
      console.warn('保存できませんでした', e);
    }
  }

  // --- 計算 ---------------------------------------------------------------

  function totals(ratePct) {
    const m = 1 + ratePct / 100;
    let cost = 0;
    let value = 0;
    for (const h of state.holdings) {
      cost += h.shares * h.avgCost;
      value += h.shares * h.price * m;
    }
    return { cost, value, pnl: value - cost };
  }

  const holdingPnl = (h, price) => h.shares * (price - h.avgCost);

  // --- DOM 参照 -----------------------------------------------------------

  const el = {
    sValue: $('#s-value'),
    sCost: $('#s-cost'),
    sPnl: $('#s-pnl'),
    sPnlPct: $('#s-pnlpct'),
    simResult: $('#sim-result'),
    sRateChip: $('#s-rate-chip'),
    sValue2: $('#s-value2'),
    sPnl2: $('#s-pnl2'),
    sPnlPct2: $('#s-pnlpct2'),
    sDelta: $('#s-delta'),
    inRate: $('#in-rate'),
    rngRate: $('#rng-rate'),
    presets: $('#presets'),
    inTargetPnl: $('#in-target-pnl'),
    inTargetValue: $('#in-target-value'),
    simWarn: $('#sim-warn'),
    list: $('#list'),
    empty: $('#empty'),
    dlgEdit: $('#dlg-edit'),
    formEdit: $('#form-edit'),
    editTitle: $('#edit-title'),
    editError: $('#edit-error'),
    dlgData: $('#dlg-data'),
    dataJson: $('#data-json'),
    dataMsg: $('#data-msg'),
  };

  const cards = new Map(); // id -> refs

  // --- 一覧の組み立て -----------------------------------------------------

  function renderList() {
    cards.clear();
    el.list.textContent = '';
    el.empty.hidden = state.holdings.length > 0;

    for (const h of state.holdings) {
      const art = document.createElement('article');
      art.className = 'holding';

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'h-head';
      head.setAttribute('aria-expanded', String(state.expandedId === h.id));
      head.innerHTML =
        '<span>' +
        '<span class="h-name"></span>' +
        '<span class="h-sub"></span>' +
        '</span>' +
        '<span class="h-right">' +
        '<span class="r-before"></span>' +
        '<b class="num r-price"></b>' +
        '<span class="chip r-chip"></span>' +
        '</span>';

      const nameEl = $('.h-name', head);
      nameEl.textContent = h.name;
      if (h.code) {
        const code = document.createElement('span');
        code.className = 'code';
        code.textContent = h.code;
        nameEl.appendChild(code);
      }
      $('.h-sub', head).textContent =
        pf.format(h.shares) + '株 / 取得 ' + priceStr(h.avgCost);

      const grid = document.createElement('div');
      grid.className = 'h-grid';
      grid.innerHTML =
        '<div><span class="lbl">評価額</span><b class="num r-value"></b></div>' +
        '<div><span class="lbl">評価損益</span><b class="num r-pnl"></b> ' +
        '<span class="pct r-pnlpct"></span></div>';

      art.append(head, grid);
      el.list.appendChild(art);

      cards.set(h.id, {
        art,
        head,
        before: $('.r-before', head),
        price: $('.r-price', head),
        chip: $('.r-chip', head),
        value: $('.r-value', grid),
        pnl: $('.r-pnl', grid),
        pnlPct: $('.r-pnlpct', grid),
        panel: null,
      });

      head.addEventListener('click', () => toggleExpand(h.id));
      if (state.expandedId === h.id) buildPanel(h);
    }
  }

  function toggleExpand(id) {
    state.expandedId = state.expandedId === id ? null : id;
    const h = state.holdings.find((x) => x.id === state.expandedId);
    for (const [cid, refs] of cards) {
      refs.head.setAttribute('aria-expanded', String(cid === state.expandedId));
      if (refs.panel && cid !== state.expandedId) {
        refs.panel.remove();
        refs.panel = null;
      }
    }
    if (h) buildPanel(h);
    refresh();
  }

  function buildPanel(h) {
    const refs = cards.get(h.id);
    if (!refs || refs.panel) return;

    const panel = document.createElement('div');
    panel.className = 'h-panel';
    panel.innerHTML =
      '<p class="panel-title">この銘柄だけで逆算する</p>' +
      '<label class="field-row"><span>目標の株価</span>' +
      '<span class="suffixed"><input type="text" inputmode="decimal" class="p-price"><i>円</i></span></label>' +
      '<label class="field-row"><span>株価の変動率</span>' +
      '<span class="suffixed"><input type="text" inputmode="decimal" class="p-chg"><i>%</i></span></label>' +
      '<label class="field-row"><span>目標の評価損益</span>' +
      '<span class="prefixed"><i>¥</i><input type="text" inputmode="decimal" class="p-pnl"></span></label>' +
      '<p class="panel-note"></p>' +
      '<div class="panel-actions">' +
      '<button type="button" class="ghost-btn p-edit">編集</button>' +
      '<button type="button" class="ghost-btn p-del">削除</button>' +
      '</div>';

    refs.art.appendChild(panel);
    refs.panel = panel;
    refs.pPrice = $('.p-price', panel);
    refs.pChg = $('.p-chg', panel);
    refs.pPnl = $('.p-pnl', panel);
    refs.pNote = $('.panel-note', panel);

    state.panelPrice = h.price * (1 + state.rate / 100);

    refs.pPrice.addEventListener('input', () => {
      const v = parseNum(refs.pPrice.value);
      if (Number.isFinite(v) && v >= 0) {
        state.panelPrice = v;
        refreshPanel(h);
      }
    });
    refs.pChg.addEventListener('input', () => {
      const v = parseNum(refs.pChg.value);
      if (Number.isFinite(v)) {
        state.panelPrice = Math.max(0, h.price * (1 + v / 100));
        refreshPanel(h);
      }
    });
    refs.pPnl.addEventListener('input', () => {
      const v = parseNum(refs.pPnl.value);
      if (Number.isFinite(v) && h.shares > 0) {
        state.panelPrice = Math.max(0, h.avgCost + v / h.shares);
        refreshPanel(h);
      }
    });
    // 入力を終えたら桁区切りなどの整形をかけ直す
    for (const input of [refs.pPrice, refs.pChg, refs.pPnl]) {
      input.addEventListener('blur', () => refreshPanel(h));
    }

    $('.p-edit', panel).addEventListener('click', () => openEdit(h.id));
    $('.p-del', panel).addEventListener('click', () => {
      if (!confirm(h.name + ' を削除しますか？')) return;
      state.holdings = state.holdings.filter((x) => x.id !== h.id);
      state.expandedId = null;
      save();
      renderList();
      refresh();
    });
  }

  function refreshPanel(h) {
    const refs = cards.get(h.id);
    if (!refs || !refs.panel) return;

    const p = state.panelPrice;
    const chg = h.price > 0 ? (p / h.price - 1) * 100 : NaN;
    const pnl = holdingPnl(h, p);
    const cost = h.shares * h.avgCost;

    const write = (input, text) => {
      if (document.activeElement !== input) input.value = text;
    };
    write(refs.pPrice, priceStr(p));
    write(refs.pChg, Number.isFinite(chg) ? trimNum(chg) : '');
    write(refs.pPnl, nf.format(Math.round(pnl)));

    const parts = [];
    if (h.shares > 0) {
      parts.push(
        '株価 <b>' + priceStr(p) + '円</b>（現在から <b>' + pctStr(chg) + '</b>）のとき、' +
        '評価額 <b>' + yen(h.shares * p) + '</b>、評価損益 <b>' + signedYen(pnl) + '</b>' +
        (cost > 0 ? '（<b>' + pctStr((pnl / cost) * 100) + '</b>）' : '') + '。'
      );
      const be = h.price > 0 ? (h.avgCost / h.price - 1) * 100 : NaN;
      parts.push('損益ゼロになる株価は <b>' + priceStr(h.avgCost) + '円</b>（現在から <b>' + pctStr(be) + '</b>）。');
    } else {
      parts.push('保有株数が0のため逆算できません。');
    }
    refs.pNote.innerHTML = parts.join('<br>');
  }

  // --- 表示更新 -----------------------------------------------------------

  function refresh() {
    const now = totals(0);
    const sim = totals(state.rate);

    el.sValue.textContent = yen(now.value);
    el.sCost.textContent = yen(now.cost);
    setSigned(el.sPnl, now.pnl, signedYen(now.pnl));
    setSigned(el.sPnlPct, now.pnl, now.cost > 0 ? pctStr((now.pnl / now.cost) * 100) : '—');

    const showSim = Math.abs(state.rate) > 1e-9 && state.holdings.length > 0;
    el.simResult.hidden = !showSim;
    if (showSim) {
      el.sRateChip.textContent = pctStr(state.rate);
      el.sRateChip.classList.remove('up', 'down');
      const c = signClass(state.rate);
      if (c) el.sRateChip.classList.add(c);
      el.sValue2.textContent = yen(sim.value);
      setSigned(el.sPnl2, sim.pnl, signedYen(sim.pnl));
      setSigned(el.sPnlPct2, sim.pnl, sim.cost > 0 ? pctStr((sim.pnl / sim.cost) * 100) : '—');
      setSigned(el.sDelta, sim.value - now.value, signedYen(sim.value - now.value));
    }

    // シミュレーション入力欄（フォーカス中の欄は書き換えない）
    if (document.activeElement !== el.inRate) el.inRate.value = trimNum(state.rate);
    el.rngRate.value = String(Math.min(50, Math.max(-50, state.rate)));

    const canReverse = now.value > 0;
    el.simWarn.hidden = canReverse || state.holdings.length === 0;
    el.inTargetPnl.disabled = !canReverse;
    el.inTargetValue.disabled = !canReverse;
    if (document.activeElement !== el.inTargetPnl) {
      el.inTargetPnl.value = canReverse ? nf.format(Math.round(sim.pnl)) : '';
    }
    if (document.activeElement !== el.inTargetValue) {
      el.inTargetValue.value = canReverse ? nf.format(Math.round(sim.value)) : '';
    }

    for (const btn of el.presets.children) {
      btn.setAttribute('aria-pressed', String(Math.abs(Number(btn.dataset.r) - state.rate) < 1e-9));
    }

    // 各カード
    const m = 1 + state.rate / 100;
    for (const h of state.holdings) {
      const refs = cards.get(h.id);
      if (!refs) continue;
      const p = h.price * m;
      const value = h.shares * p;
      const cost = h.shares * h.avgCost;
      const pnl = value - cost;

      // 変動させているときだけ「現在値 → 変動後」が分かるように元の株価も出す
      refs.before.hidden = !showSim;
      refs.before.textContent = showSim ? '現在 ' + priceStr(h.price) + '円' : '';
      refs.price.textContent = priceStr(p) + '円';
      refs.chip.textContent = pctStr(state.rate);
      refs.chip.classList.remove('up', 'down');
      const cc = signClass(state.rate);
      if (cc) refs.chip.classList.add(cc);
      refs.value.textContent = yen(value);
      setSigned(refs.pnl, pnl, signedYen(pnl));
      setSigned(refs.pnlPct, pnl, cost > 0 ? pctStr((pnl / cost) * 100) : '—');

      if (refs.panel) refreshPanel(h);
    }
  }

  function setRate(r) {
    if (!Number.isFinite(r)) return;
    state.rate = clampRate(r);
    save();
    refresh();
  }

  // --- 編集ダイアログ -----------------------------------------------------

  let editingId = null;

  function openEdit(id) {
    editingId = id || null;
    const h = id ? state.holdings.find((x) => x.id === id) : null;
    el.editTitle.textContent = h ? '銘柄を編集' : '銘柄を追加';
    el.editError.hidden = true;
    const f = el.formEdit;
    f.name.value = h ? h.name : '';
    f.code.value = h ? h.code : '';
    f.shares.value = h ? String(h.shares) : '';
    f.avgCost.value = h ? String(h.avgCost) : '';
    f.price.value = h ? String(h.price) : '';
    el.dlgEdit.showModal();
  }

  el.formEdit.addEventListener('submit', (e) => {
    const f = el.formEdit;
    const name = f.name.value.trim();
    const shares = parseNum(f.shares.value);
    const avgCost = parseNum(f.avgCost.value);
    const price = parseNum(f.price.value);

    const bad = [];
    if (!name) bad.push('銘柄名');
    if (!Number.isFinite(shares) || shares < 0) bad.push('保有株数');
    if (!Number.isFinite(avgCost) || avgCost < 0) bad.push('取得単価');
    if (!Number.isFinite(price) || price < 0) bad.push('現在の株価');
    if (bad.length) {
      e.preventDefault(); // ダイアログを閉じずにエラーを出す
      el.editError.hidden = false;
      el.editError.textContent = bad.join('・') + ' を正しく入力してください（0以上の数値）。';
      return;
    }

    const rec = { id: editingId || newId(), name, code: f.code.value.trim(), shares, avgCost, price };
    const i = state.holdings.findIndex((x) => x.id === rec.id);
    if (i >= 0) state.holdings[i] = rec;
    else state.holdings.push(rec);

    save();
    renderList();
    refresh();
  });

  $('#edit-cancel').addEventListener('click', () => el.dlgEdit.close());

  // --- データ管理ダイアログ -----------------------------------------------

  function openData() {
    el.dataJson.value = JSON.stringify({ v: 1, holdings: state.holdings }, null, 2);
    el.dataMsg.hidden = true;
    el.dlgData.showModal();
  }

  function dataMsg(text, isError) {
    el.dataMsg.hidden = false;
    el.dataMsg.textContent = text;
    el.dataMsg.style.color = isError ? '' : 'var(--muted)';
  }

  $('#data-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.dataJson.value);
      dataMsg('コピーしました。', false);
    } catch (e) {
      el.dataJson.select();
      dataMsg('コピーできませんでした。選択状態にしたので手動でコピーしてください。', true);
    }
  });

  $('#data-download').addEventListener('click', () => {
    const blob = new Blob([el.dataJson.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock-sim-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#data-import').addEventListener('click', () => {
    let data;
    try {
      data = JSON.parse(el.dataJson.value);
    } catch (e) {
      dataMsg('JSONの形式が正しくありません。', true);
      return;
    }
    const list = Array.isArray(data) ? data : data && data.holdings;
    if (!Array.isArray(list)) {
      dataMsg('holdings の配列が見つかりません。', true);
      return;
    }
    const parsed = list.map(normalize).filter(Boolean);
    if (!parsed.length) {
      dataMsg('読み込める銘柄がありませんでした。', true);
      return;
    }
    if (!confirm('現在の ' + state.holdings.length + ' 銘柄を、読み込んだ ' + parsed.length + ' 銘柄で置き換えます。よろしいですか？')) return;
    state.holdings = parsed;
    state.expandedId = null;
    save();
    renderList();
    refresh();
    dataMsg(parsed.length + ' 銘柄を読み込みました。', false);
  });

  $('#data-clear').addEventListener('click', () => {
    if (!confirm('保存されている全データを削除します。元に戻せません。よろしいですか？')) return;
    state.holdings = [];
    state.rate = 0;
    state.expandedId = null;
    save();
    renderList();
    refresh();
    el.dataJson.value = JSON.stringify({ v: 1, holdings: [] }, null, 2);
    dataMsg('削除しました。', false);
  });

  $('#data-close').addEventListener('click', () => el.dlgData.close());
  $('#btn-data').addEventListener('click', openData);

  // --- イベント -----------------------------------------------------------

  el.inRate.addEventListener('input', () => setRate(parseNum(el.inRate.value)));
  el.inRate.addEventListener('blur', () => refresh());
  el.rngRate.addEventListener('input', () => setRate(Number(el.rngRate.value)));

  el.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-r]');
    if (btn) setRate(Number(btn.dataset.r));
  });

  el.inTargetPnl.addEventListener('input', () => {
    const v = parseNum(el.inTargetPnl.value);
    const now = totals(0);
    if (Number.isFinite(v) && now.value > 0) setRate(((v + now.cost) / now.value - 1) * 100);
  });
  el.inTargetPnl.addEventListener('blur', () => refresh());

  el.inTargetValue.addEventListener('input', () => {
    const v = parseNum(el.inTargetValue.value);
    const now = totals(0);
    if (Number.isFinite(v) && now.value > 0) setRate((v / now.value - 1) * 100);
  });
  el.inTargetValue.addEventListener('blur', () => refresh());

  $('#btn-add').addEventListener('click', () => openEdit(null));
  $('#btn-add2').addEventListener('click', () => openEdit(null));

  $('#btn-sample').addEventListener('click', () => {
    const sample = [
      { name: 'トヨタ自動車', code: '7203', shares: 100, avgCost: 2500, price: 2850 },
      { name: 'ソニーグループ', code: '6758', shares: 50, avgCost: 3100, price: 3480 },
      { name: '三菱UFJフィナンシャル・グループ', code: '8306', shares: 300, avgCost: 1200, price: 1615 },
    ];
    state.holdings = sample.map((h) => normalize(Object.assign({ id: newId() }, h)));
    save();
    renderList();
    refresh();
  });

  // --- 起動 ---------------------------------------------------------------

  load();
  renderList();
  refresh();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW登録失敗', e));
    });
  }
})();
