const STORAGE_KEY = 'infinite-trpg-combat-tracker-v1';

const initialState = {
  units: [],
  selectedUnitId: null,
  initiative: [],
  currentTurn: 0,
  round: 1,
  auditLog: [],
  logVersion: 2,
};

let state = loadState();
let undoStack = [];
let redoStack = [];
let activeLogFilter = 'all';
let contextUnitId = null;

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'unitList','addUnitBtn','addEnemyBtn','duplicateUnitBtn','exportBtn','importInput','resetAllBtn','currentUnitTitle','undoBtn','redoBtn','deleteUnitBtn',
  'emptyState','unitEditor','unitFaction','avatarPreview','avatarFallback','avatarInput','unitName','hpMax','tempHp','willCurrent','willMax','autoStateBadge',
  'healthTrack','healthSummary','openManualEditBtn','attrStrength','attrDexterity','attrStamina','attrIntelligence','attrPerception','attrResolve','attrPresence','attrManipulation','attrComposure','defBase','defDodge','defBlock','defArmor','defNatural','defShield','defOther','defAmbush','defTouch','defenseNormalTotal','defenseCurrentTotal','damageB','damageL','damageA','applyDamageBtn','healAmount','healType','applyHealBtn',
  'addStatusBtn','statusList','addPoolBtn','poolList','notes','roundNumber','addCurrentToInitiativeBtn',
  'clearInitiativeBtn','initiativeList','clearAuditBtn','auditLogList','unitContextMenu','enemyBoard','reincarnatorBoard','quickUnitName','quickStats','turnUnitName','activeTurnCard','toggleSidebarBtn','openSidebarBtn','appShell','prevTurnBtn','nextTurnBtn','manualEditDialog','manualEditForm','manualGood','manualB','manualL','manualA','manualEditError','saveManualEditBtn'
].map(id => [id, $(id)]));

function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
function clamp(n, min, max) { return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)); }
function num(input) { return Math.max(0, Math.floor(Number(input.value) || 0)); }
function nowText() { return new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }

const ATTRIBUTE_LABELS = {strength:'力量', dexterity:'敏捷', stamina:'耐力', intelligence:'智力', perception:'感知', resolve:'决心', presence:'风度', manipulation:'操控', composure:'沉着'};
const STATUS_PRESETS = {
  '耳鸣':['stamina','perception'], '目眩':['stamina','perception'], '恶心':['stamina','resolve'], '晶化':['stamina','resolve'],
  '精神束缚':['resolve','composure'], '纠缠':['strength','dexterity'], '麻痹':['stamina','resolve'], '晕眩':['stamina','resolve'],
  '剧痛':['stamina','resolve'], '疲乏':['stamina','strength'], '魅惑':['resolve','presence'], '沮丧':['resolve','composure'],
  '亢奋':['resolve','composure'], '恐惧':['resolve','composure'], '流血':['stamina','stamina']
};
const ATTRIBUTE_OPTIONS = Object.entries(ATTRIBUTE_LABELS).map(([value,label]) => `<option value="${value}">${label}</option>`).join('');

function defaultUnit(index = 1) {
  return {
    id: uid(), name: `单位 ${index}`, faction: 'reincarnator', avatar: '', hpMax: 10, good: 10, B: 0, L: 0, A: 0,
    tempHp: 0, willCurrent: 0, willMax: 0,
    attributes: {strength:2, dexterity:2, stamina:2, intelligence:2, perception:2, resolve:2, presence:2, manipulation:2, composure:2},
    defense: {base:0, dodge:0, block:0, armor:0, natural:0, shield:0, other:0, ambush:false, touch:false},
    statuses: [], pools: [], notes: ''
  };
}

function inferLogCategory(text = '') {
  if (/受到|伤害/.test(text)) return 'damage';
  if (/治疗|恢复生命/.test(text)) return 'heal';
  if (/不良点数|不良状态|昏迷|死亡/.test(text)) return 'status';
  return 'other';
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(initialState);
    const parsed = JSON.parse(raw);
    const merged = {...deepClone(initialState), ...parsed};
    merged.units = Array.isArray(merged.units) ? merged.units : [];
    merged.initiative = Array.isArray(merged.initiative) ? merged.initiative : [];
    merged.auditLog = Array.isArray(merged.auditLog) ? merged.auditLog : [];
    merged.units.forEach(unit => {
      delete unit.history;
      unit.statuses = Array.isArray(unit.statuses) ? unit.statuses : [];
      unit.pools = Array.isArray(unit.pools) ? unit.pools : [];
      unit.attributes = unit.attributes || {};
      unit.defense = unit.defense || {};
    });
    if (merged.logVersion !== 2) {
      merged.auditLog = merged.auditLog.slice().reverse().map(log => ({
        text: String(log?.text || ''),
        time: String(log?.time || ''),
        category: inferLogCategory(log?.text || ''),
        kind: 'event',
        round: Math.max(1, Number(log?.round) || merged.round || 1),
      }));
      merged.logVersion = 2;
    }
    return merged;
  } catch { return deepClone(initialState); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function checkpoint(label) {
  undoStack.push({state: deepClone(state), label});
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function ensureRoundMarker(round = state.round) {
  const lastMarker = [...state.auditLog].reverse().find(log => log.kind === 'round');
  if (lastMarker?.round === round) return;
  state.auditLog.push({
    kind: 'round', category: 'round', round,
    text: `Round ${round}`, time: nowText(),
  });
}
function addBattleLog(text, category = 'other', unit = null) {
  ensureRoundMarker(state.round);
  state.auditLog.push({
    kind: 'event', text, category, time: nowText(), round: state.round,
    unitId: unit?.id || null,
  });
  if (state.auditLog.length > 500) state.auditLog.splice(0, state.auditLog.length - 500);
}
function finishChange() { saveState(); render(); }
function commit(label, unit = selectedUnit(), options = {}) {
  const {battleCategory = null} = options;
  if (battleCategory) addBattleLog(label, battleCategory, unit);
  finishChange();
}
function selectedUnit() { return state.units.find(u => u.id === state.selectedUnitId) || null; }

function normalizeUnit(unit) {
  unit.faction = unit.faction === 'enemy' ? 'enemy' : 'reincarnator';
  unit.hpMax = Math.max(1, Math.floor(Number(unit.hpMax) || 1));
  unit.B = Math.max(0, Math.floor(Number(unit.B) || 0));
  unit.L = Math.max(0, Math.floor(Number(unit.L) || 0));
  unit.A = Math.max(0, Math.floor(Number(unit.A) || 0));
  normalizeDamage(unit);
  unit.good = Math.max(0, unit.hpMax - unit.B - unit.L - unit.A);
  unit.tempHp = Math.max(0, Math.floor(Number(unit.tempHp) || 0));
  unit.willMax = Math.max(0, Math.floor(Number(unit.willMax) || 0));
  unit.willCurrent = clamp(Math.floor(Number(unit.willCurrent) || 0), 0, unit.willMax);
  const defaultAttrs = {strength:2, dexterity:2, stamina:2, intelligence:2, perception:2, resolve:2, presence:2, manipulation:2, composure:2};
  unit.attributes = {...defaultAttrs, ...(unit.attributes || {})};
  Object.keys(defaultAttrs).forEach(k => unit.attributes[k] = Math.max(0, Math.floor(Number(unit.attributes[k]) || 0)));
  const defaultDefense = {base:0, dodge:0, block:0, armor:0, natural:0, shield:0, other:0, ambush:false, touch:false};
  unit.defense = {...defaultDefense, ...(unit.defense || {})};
  ['base','dodge','block','armor','natural','shield','other'].forEach(k => unit.defense[k] = Math.max(0, Math.floor(Number(unit.defense[k]) || 0)));
  unit.defense.ambush = !!unit.defense.ambush;
  unit.defense.touch = !!unit.defense.touch;
  unit.statuses = (unit.statuses || []).map(s => ({id:s.id || uid(), name:s.name || '自定义', value:Math.max(0,Math.floor(Number(s.value)||0)), note:s.note||'', attr1:s.attr1 || STATUS_PRESETS[s.name]?.[0] || 'stamina', attr2:s.attr2 || STATUS_PRESETS[s.name]?.[1] || 'resolve', catastrophic:!!s.catastrophic}));
}

function defenseTotals(unit) {
  const d = unit.defense;
  const normal = d.base+d.dodge+d.block+d.armor+d.natural+d.shield+d.other;
  const current = (d.ambush ? 0 : d.base+d.dodge+d.block) + (d.touch ? 0 : d.armor+d.natural+d.shield) + d.other;
  return {normal, current};
}
function statusSeverity(unit, status) {
  const a1 = unit.attributes[status.attr1] || 0;
  const a2 = unit.attributes[status.attr2] || 0;
  const heavy = a1;
  const catastrophic = a1 + a2;
  let level = '轻度', cls = 'mild';
  if (status.value >= catastrophic) { level='毁灭性'; cls='catastrophic'; status.catastrophic = true; }
  else if (status.value >= heavy) { level='重度'; cls='heavy'; }
  return {level, cls, heavy, catastrophic, consequence:status.catastrophic};
}

function normalizeDamage(unit, trace = null) {
  while (unit.B + unit.L + unit.A > unit.hpMax) {
    const overflow = unit.B + unit.L + unit.A - unit.hpMax;
    if (unit.B > 0) {
      const beforeB = unit.B, beforeL = unit.L;
      const bToConvert = Math.min(unit.B, overflow * 2);
      const converted = Math.ceil(bToConvert / 2);
      unit.B -= bToConvert;
      unit.L += converted;
      if (trace) trace.push(`${bToConvert}B → ${converted}L（B ${beforeB}→${unit.B}，L ${beforeL}→${unit.L}）`);
      continue;
    }
    if (unit.L > 0) {
      const beforeL = unit.L, beforeA = unit.A;
      const lToConvert = Math.min(unit.L, overflow * 2);
      const converted = Math.ceil(lToConvert / 2);
      unit.L -= lToConvert;
      unit.A += converted;
      if (trace) trace.push(`${lToConvert}L → ${converted}A（L ${beforeL}→${unit.L}，A ${beforeA}→${unit.A}）`);
      continue;
    }
    break;
  }
  if (unit.A > unit.hpMax) unit.A = unit.hpMax;
}

function injurySnapshot(unit) {
  return {good: unit.good, B: unit.B, L: unit.L, A: unit.A, tempHp: unit.tempHp};
}
function injuryText(v) { return `${v.good}/${v.B}/${v.L}/${v.A}`; }

function applyDamage(unit, incoming) {
  const before = injurySnapshot(unit);
  const damage = {B: incoming.B, L: incoming.L, A: incoming.A};
  let temp = unit.tempHp;
  for (const type of ['B','L','A']) {
    const blocked = Math.min(temp, damage[type]);
    damage[type] -= blocked;
    temp -= blocked;
  }
  const absorbed = unit.tempHp - temp;
  unit.tempHp = temp;
  unit.B += damage.B; unit.L += damage.L; unit.A += damage.A;
  const conversions = [];
  normalizeDamage(unit, conversions);
  unit.good = Math.max(0, unit.hpMax - unit.B - unit.L - unit.A);
  const after = injurySnapshot(unit);
  return {remaining: damage, absorbed, before, after, conversions};
}

function healUnit(unit, amount, type) {
  let remaining = amount;
  const healed = {B:0,L:0,A:0};
  const order = type === 'auto' ? ['B','L','A'] : [type];
  for (const key of order) {
    const value = Math.min(unit[key], remaining);
    unit[key] -= value;
    healed[key] += value;
    remaining -= value;
    if (remaining <= 0) break;
  }
  normalizeUnit(unit);
  return healed;
}

function unitState(unit) {
  if (unit.A >= unit.hpMax) return {text:'死亡', cls:'dead'};
  if (unit.good <= 0) return {text:'昏迷', cls:'unconscious'};
  return {text:'正常', cls:'normal'};
}

function render() {
  renderUnits();
  renderEditor();
  renderBattlefield();
  renderInitiative();
  renderAuditLog();
  els.undoBtn.disabled = undoStack.length === 0;
  els.redoBtn.disabled = redoStack.length === 0;
}

function openUnitContextMenu(event, unit) {
  if (!els.unitContextMenu || !unit) return;
  event.preventDefault();
  event.stopPropagation();
  contextUnitId = unit.id;
  state.selectedUnitId = unit.id;
  saveState();
  render();
  els.unitContextMenu.classList.remove('hidden');
  const rect = els.unitContextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  els.unitContextMenu.style.left = `${Math.max(8, left)}px`;
  els.unitContextMenu.style.top = `${Math.max(8, top)}px`;
}
function closeUnitContextMenu() {
  contextUnitId = null;
  els.unitContextMenu?.classList.add('hidden');
}
function bindUnitContextMenu(element, unit) {
  element.addEventListener('contextmenu', event => openUnitContextMenu(event, unit));
}

function renderUnits() {
  els.unitList.innerHTML = '';
  for (const [faction, title] of [['reincarnator','轮回者'],['enemy','敌人']]) {
    const units = state.units.filter(u => (u.faction || 'reincarnator') === faction);
    const heading = document.createElement('div'); heading.className='faction-list-title'; heading.textContent=`${title} · ${units.length}`; els.unitList.appendChild(heading);
    units.forEach((u) => {
      normalizeUnit(u);
      const item = document.createElement('div');
      item.className = `unit-item ${u.id === state.selectedUnitId ? 'active' : ''}`;
      item.draggable = true; item.dataset.id = u.id;
      const avatar = u.avatar ? `<img class="unit-thumb" src="${u.avatar}" alt="">` : `<div class="unit-thumb">${escapeHtml((u.name || '?')[0])}</div>`;
      item.innerHTML = `${avatar}<div class="unit-meta"><strong>${escapeHtml(u.name)}</strong><span>${unitState(u).text}</span></div><div class="unit-health-mini" title="完好 / B / L / A">${u.good}/${u.B}/${u.L}/${u.A}</div>`;
      item.addEventListener('click', () => { state.selectedUnitId = u.id; saveState(); render(); });
      bindUnitContextMenu(item, u);
      item.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', u.id));
      item.addEventListener('dragover', e => e.preventDefault());
      item.addEventListener('drop', e => { e.preventDefault(); const draggedId=e.dataTransfer.getData('text/plain'); if(draggedId===u.id)return; checkpoint('调整单位顺序'); const from=state.units.findIndex(x=>x.id===draggedId), to=state.units.findIndex(x=>x.id===u.id); const [m]=state.units.splice(from,1); state.units.splice(to,0,m); commit('调整了单位顺序',null); });
      els.unitList.appendChild(item);
    });
  }
}

function renderBattlefield() {
  els.enemyBoard.innerHTML=''; els.reincarnatorBoard.innerHTML='';
  const currentId = state.initiative[state.currentTurn]?.unitId;
  state.units.forEach(u => {
    normalizeUnit(u);
    const st=unitState(u), card=document.createElement('article');
    const ally=u.faction!=='enemy';
    card.className=`battle-unit ${ally?'ally':'enemy'} ${u.id===state.selectedUnitId?'selected':''} ${u.id===currentId?'current':''} ${st.cls==='dead'?'dead':''}`;
    const segmentPct = value => Math.max(0, Math.min(100, (value / u.hpMax) * 100));
    const tags=(u.statuses||[]).filter(x=>x.value>0).map(x=>{const sev=statusSeverity(u,x);return `${x.name}${x.value}·${sev.level}`}).join(' · ') || '无不良点数';
    const def=defenseTotals(u); const defFlags=[u.defense.ambush?'措手不及':'',u.defense.touch?'接触攻击':''].filter(Boolean).join(' · ');
    const tempBadge = u.tempHp > 0 ? `<span class="temp-hp-badge">临时 +${u.tempHp}</span>` : '';
    const avatar = u.avatar ? `<img class="battle-avatar" src="${u.avatar}" alt="">` : `<div class="battle-avatar fallback">${escapeHtml((u.name||'?')[0])}</div>`;
    card.innerHTML=`<div class="battle-unit-head">${avatar}<div class="battle-name"><strong>${escapeHtml(u.name)}</strong><small>${st.text}</small></div></div><div class="injury-bar" title="完好 ${u.good} / B ${u.B} / L ${u.L} / A ${u.A}"><span class="segment good" style="width:${segmentPct(u.good)}%"></span><span class="segment B" style="width:${segmentPct(u.B)}%"></span><span class="segment L" style="width:${segmentPct(u.L)}%"></span><span class="segment A" style="width:${segmentPct(u.A)}%"></span></div><div class="battle-unit-values"><span class="value-legend">完/B/L/A</span><strong>${u.good}/${u.B}/${u.L}/${u.A}</strong></div><div class="battle-unit-resources"><span>${u.tempHp>0?`临时 +${u.tempHp}`:'临时 —'}</span><span>意志 ${u.willCurrent}/${u.willMax}</span></div><div class="battle-unit-defense"><b>DEF ${def.current}</b>${def.current!==def.normal?`<span>正常 ${def.normal}</span>`:''}${defFlags?`<small>${escapeHtml(defFlags)}</small>`:''}</div><div class="battle-unit-tags">${escapeHtml(tags)}</div>`;
    card.addEventListener('click',()=>{state.selectedUnitId=u.id;saveState();render();});
    bindUnitContextMenu(card, u);
    (ally?els.reincarnatorBoard:els.enemyBoard).appendChild(card);
  });
  if(!els.enemyBoard.children.length) els.enemyBoard.innerHTML='<div class="drawer-empty">暂无敌人</div>';
  if(!els.reincarnatorBoard.children.length) els.reincarnatorBoard.innerHTML='<div class="drawer-empty">暂无轮回者</div>';
  const u=selectedUnit();
  els.quickUnitName.textContent=u?u.name:'未选择单位';
  els.quickStats.textContent=u?`完/B/L/A ${u.good}/${u.B}/${u.L}/${u.A} · 临时 ${u.tempHp} · 意志 ${u.willCurrent}/${u.willMax}`:'完/B/L/A — · 意志 —';
  const turn=state.units.find(x=>x.id===currentId);
  els.turnUnitName.textContent=turn?.name||'—';
  els.activeTurnCard.innerHTML=turn?`<b>▶ 行动中 · ${escapeHtml(turn.name)}</b><span>完/B/L/A ${turn.good}/${turn.B}/${turn.L}/${turn.A} · 意志 ${turn.willCurrent}/${turn.willMax}</span>`:'<b>等待设置行动顺序</b><span>完/B/L/A — · 意志 —</span>';
}

function renderEditor() {
  const u = selectedUnit();
  const has = !!u;
  els.emptyState.classList.toggle('hidden', has);
  els.unitEditor.classList.toggle('hidden', !has);
  els.deleteUnitBtn.disabled = !has;
  els.duplicateUnitBtn.disabled = !has;
  els.addCurrentToInitiativeBtn.disabled = !has;
  if (!u) { els.currentUnitTitle.textContent = '未选择单位'; return; }
  normalizeUnit(u);
  els.currentUnitTitle.textContent = u.name;
  setValue(els.unitName, u.name); setValue(els.unitFaction, u.faction); setValue(els.hpMax, u.hpMax); setValue(els.tempHp, u.tempHp);
  setValue(els.willCurrent, u.willCurrent); setValue(els.willMax, u.willMax); setValue(els.notes, u.notes || '');
  const attrMap={attrStrength:'strength',attrDexterity:'dexterity',attrStamina:'stamina',attrIntelligence:'intelligence',attrPerception:'perception',attrResolve:'resolve',attrPresence:'presence',attrManipulation:'manipulation',attrComposure:'composure'};
  Object.entries(attrMap).forEach(([id,key])=>setValue(els[id],u.attributes[key]));
  const defMap={defBase:'base',defDodge:'dodge',defBlock:'block',defArmor:'armor',defNatural:'natural',defShield:'shield',defOther:'other'};
  Object.entries(defMap).forEach(([id,key])=>setValue(els[id],u.defense[key]));
  els.defAmbush.checked=u.defense.ambush; els.defTouch.checked=u.defense.touch;
  const dt=defenseTotals(u); els.defenseNormalTotal.textContent=dt.normal; els.defenseCurrentTotal.textContent=dt.current;
  if (u.avatar) { els.avatarPreview.src = u.avatar; els.avatarPreview.classList.remove('hidden'); els.avatarFallback.classList.add('hidden'); }
  else { els.avatarPreview.classList.add('hidden'); els.avatarFallback.classList.remove('hidden'); els.avatarFallback.textContent = (u.name || '?')[0]; }
  const st = unitState(u); els.autoStateBadge.className = `state-badge ${st.cls}`; els.autoStateBadge.textContent = st.text;
  renderHealth(u); renderStatuses(u); renderPools(u);
}
function setValue(el, value) { if (document.activeElement !== el) el.value = value; }

function renderHealth(u) {
  els.healthTrack.innerHTML = '';
  els.healthSummary.innerHTML = `
    <span class="health-summary-item good"><small>完好</small><b>${u.good}</b></span>
    <span class="health-summary-item B"><small>B</small><b>${u.B}</b></span>
    <span class="health-summary-item L"><small>L</small><b>${u.L}</b></span>
    <span class="health-summary-item A"><small>A</small><b>${u.A}</b></span>
    <span class="health-summary-item temp"><small>临时生命</small><b>${u.tempHp}</b></span>`;
}

function renderStatuses(u) {
  els.statusList.innerHTML = '';
  if (!u.statuses.length) els.statusList.innerHTML = '<p class="hint">暂无不良点数。</p>';
  u.statuses.forEach(s => {
    const presetNames = ['自定义', ...Object.keys(STATUS_PRESETS)];
    const options = presetNames.map(name => `<option value="${name}" ${s.name===name?'selected':''}>${name}</option>`).join('');
    const sev = statusSeverity(u, s);
    const row = document.createElement('div'); row.className = `status-card ${sev.cls}`;
    row.innerHTML = `<div class="status-card-top"><label>类型<select data-k="name">${options}</select></label><label>点数<input data-k="value" type="number" min="0" value="${s.value}"></label><span class="severity-badge ${sev.cls}">${sev.level}</span><button class="danger status-delete">删除</button></div><div class="status-resistance"><label>关键属性 1<select data-k="attr1">${ATTRIBUTE_OPTIONS}</select></label><span>＋</span><label>关键属性 2<select data-k="attr2">${ATTRIBUTE_OPTIONS}</select></label><span class="threshold-text">重度 ≥ ${sev.heavy}　毁灭性 ≥ ${sev.catastrophic}</span></div><label class="status-note">备注<input data-k="note" value="${escapeAttr(s.note || '')}"></label>${sev.consequence?`<div class="catastrophic-lock">毁灭性后果已触发 <button type="button" class="clear-catastrophic">解除后果</button></div>`:''}`;
    row.querySelector('[data-k="attr1"]').value=s.attr1;
    row.querySelector('[data-k="attr2"]').value=s.attr2;
    row.querySelectorAll('input,select').forEach(inp => inp.addEventListener('change', () => {
      const key = inp.dataset.k, oldValue = s.value, oldName=s.name;
      checkpoint('修改不良点数');
      if(key==='value') s.value=Math.max(0,Math.floor(Number(inp.value)||0));
      else s[key]=inp.value;
      if(key==='name' && STATUS_PRESETS[s.name]) [s.attr1,s.attr2]=STATUS_PRESETS[s.name];
      if(key==='value' && s.value!==oldValue) addBattleLog(`${u.name} ${s.name} ${s.value-oldValue>0?'+':''}${s.value-oldValue} 不良点数`,'status',u);
      finishChange();
    }));
    row.querySelector('.status-delete').addEventListener('click', () => { checkpoint('删除不良点数'); u.statuses=u.statuses.filter(x=>x.id!==s.id); if(s.value>0)addBattleLog(`${u.name} ${s.name} -${s.value} 不良点数`,'status',u); finishChange(); });
    row.querySelector('.clear-catastrophic')?.addEventListener('click',()=>{checkpoint('解除毁灭性后果');s.catastrophic=false;finishChange();});
    els.statusList.appendChild(row);
  });
}

function renderPools(u) {
  els.poolList.innerHTML = '';
  if (!u.pools.length) els.poolList.innerHTML = '<p class="hint">暂无能量池。</p>';
  u.pools.forEach(p => {
    const row = document.createElement('div'); row.className = 'stack-row';
    row.innerHTML = `<label>名称<input data-k="name" value="${escapeAttr(p.name)}"></label><label>当前<input data-k="current" type="number" min="0" value="${p.current}"></label><label>上限<input data-k="max" type="number" min="0" value="${p.max}"></label><button class="danger">删除</button>`;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
      checkpoint('修改能量池');
      if (inp.dataset.k === 'name') p.name = inp.value;
      else { p[inp.dataset.k] = Math.max(0, Math.floor(Number(inp.value)||0)); p.current = clamp(p.current,0,p.max); }
      commit(`修改能量池：${p.name}`, u);
    }));
    row.querySelector('button').addEventListener('click', () => { checkpoint('删除能量池'); u.pools = u.pools.filter(x=>x.id!==p.id); commit(`删除能量池：${p.name}`, u); });
    els.poolList.appendChild(row);
  });
}

function renderInitiative() {
  els.roundNumber.textContent = state.round;
  els.initiativeList.innerHTML = '';
  if (!state.initiative.length) els.initiativeList.innerHTML = '<p class="hint">行动顺序为空。</p>';
  state.initiative.forEach((entry, index) => {
    const u = state.units.find(x=>x.id===entry.unitId); if (!u) return;
    const item = document.createElement('div'); item.className=`initiative-item ${index===state.currentTurn?'current':''} ${entry.skipped?'skipped':''}`; item.draggable=true;
    item.innerHTML=`<div class="initiative-index">${index+1}</div><strong>${escapeHtml(u.name)}</strong><button class="icon-btn" title="跳过">${entry.skipped?'↺':'⏭'}</button><button class="icon-btn danger" title="移除">×</button>`;
    item.addEventListener('click', e => { if (e.target.tagName==='BUTTON') return; state.selectedUnitId=u.id; saveState(); render(); });
    const [skipBtn, removeBtn]=item.querySelectorAll('button');
    skipBtn.addEventListener('click',()=>{checkpoint('切换跳过状态');entry.skipped=!entry.skipped;commit(`${u.name}${entry.skipped?'被标记为跳过':'恢复行动'}`,null);});
    removeBtn.addEventListener('click',()=>{checkpoint('移出行动顺序');state.initiative.splice(index,1);state.currentTurn=Math.min(state.currentTurn,Math.max(0,state.initiative.length-1));commit(`${u.name}被移出行动顺序`,null);});
    item.addEventListener('dragstart', e=>e.dataTransfer.setData('text/plain',String(index)));
    item.addEventListener('dragover',e=>e.preventDefault());
    item.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(from===index)return;checkpoint('调整行动顺序');const [m]=state.initiative.splice(from,1);state.initiative.splice(index,0,m);state.currentTurn=0;commit('调整了行动顺序',null);});
    els.initiativeList.appendChild(item);
  });
}

function renderAuditLog() {
  if (!els.auditLogList) return;
  document.querySelectorAll('[data-log-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.logFilter === activeLogFilter);
  });
  els.auditLogList.innerHTML = '';
  const logs = Array.isArray(state.auditLog) ? state.auditLog : [];
  if (!logs.length) {
    els.auditLogList.innerHTML = '<p class="hint">暂无战斗记录。</p>';
    return;
  }

  let visibleLogs = logs;
  if (activeLogFilter !== 'all') {
    visibleLogs = [];
    let pendingRound = null;
    let insertedRound = null;
    for (const log of logs) {
      if (log.kind === 'round') {
        pendingRound = log;
        continue;
      }
      if (log.category !== activeLogFilter) continue;
      if (pendingRound && insertedRound !== pendingRound.round) {
        visibleLogs.push(pendingRound);
        insertedRound = pendingRound.round;
      }
      visibleLogs.push(log);
    }
  }

  if (!visibleLogs.length) {
    els.auditLogList.innerHTML = '<p class="hint">此分类暂无记录。</p>';
    return;
  }

  visibleLogs.slice(-160).forEach(log => {
    if (log.kind === 'round') {
      const divider = document.createElement('div');
      divider.className = 'audit-round-divider';
      divider.innerHTML = `<span>Round ${Math.max(1, Number(log.round) || 1)}</span>`;
      els.auditLogList.appendChild(divider);
      return;
    }
    const item = document.createElement('div');
    item.className = `audit-entry ${log.category || 'other'}`;
    item.innerHTML = `<div class="audit-entry-head"><strong>${escapeHtml(log.text)}</strong><time>${escapeHtml(log.time)}</time></div>`;
    els.auditLogList.appendChild(item);
  });
  requestAnimationFrame(() => { els.auditLogList.scrollTop = els.auditLogList.scrollHeight; });
}

function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(s='') { return escapeHtml(s); }

function formatDamageEvent(incoming) {
  return ['B','L','A'].filter(type => incoming[type] > 0).map(type => `${incoming[type]}${type}`).join(' / ');
}
function stateTransitionEvent(unit, beforeText, afterText) {
  if (beforeText === afterText) return null;
  if (afterText === '死亡') return `${unit.name} 死亡`;
  if (afterText === '昏迷') return `${unit.name} 昏迷`;
  if (beforeText === '昏迷' && afterText === '正常') return `${unit.name} 恢复意识`;
  if (beforeText === '死亡' && afterText !== '死亡') return `${unit.name} 脱离死亡状态`;
  return `${unit.name} 状态变为${afterText}`;
}
function addStateTransitionLogs(unit, beforeText) {
  const afterText = unitState(unit).text;
  const text = stateTransitionEvent(unit, beforeText, afterText);
  if (!text) return;
  addBattleLog(text, 'status', unit);
}
function duplicateUnitById(unitId) {
  const u = state.units.find(unit => unit.id === unitId);
  if (!u) return;
  checkpoint('复制单位');
  const copy = deepClone(u);
  copy.id = uid();
  copy.name = `${u.name} 副本`;
  state.units.push(copy);
  state.selectedUnitId = copy.id;
  addBattleLog(`添加单位：${copy.name}`, 'other', copy);
  finishChange();
}
function deleteUnitById(unitId) {
  const u = state.units.find(unit => unit.id === unitId);
  if (!u || !confirm(`确定删除“${u.name}”吗？`)) return;
  checkpoint('删除单位');
  state.units = state.units.filter(unit => unit.id !== u.id);
  state.initiative = state.initiative.filter(entry => entry.unitId !== u.id);
  state.currentTurn = Math.min(state.currentTurn, Math.max(0, state.initiative.length - 1));
  state.selectedUnitId = state.units[0]?.id || null;
  addBattleLog(`删除单位：${u.name}`, 'other');
  finishChange();
}

els.addUnitBtn.addEventListener('click', () => {
  checkpoint('添加轮回者');
  const u = defaultUnit(state.units.length + 1);
  u.name = `轮回者 ${state.units.filter(x => (x.faction || 'reincarnator') === 'reincarnator').length + 1}`;
  u.faction = 'reincarnator';
  state.units.push(u);
  state.selectedUnitId = u.id;
  addBattleLog(`添加单位：${u.name}`, 'other', u);
  finishChange();
});
els.addEnemyBtn.addEventListener('click', () => {
  checkpoint('添加敌人');
  const u = defaultUnit(state.units.length + 1);
  u.name = `敌人 ${state.units.filter(x => x.faction === 'enemy').length + 1}`;
  u.faction = 'enemy';
  state.units.push(u);
  state.selectedUnitId = u.id;
  addBattleLog(`添加单位：${u.name}`, 'other', u);
  finishChange();
});
els.duplicateUnitBtn.addEventListener('click', () => duplicateUnitById(state.selectedUnitId));
els.deleteUnitBtn.addEventListener('click', () => deleteUnitById(state.selectedUnitId));

[['unitName','name'],['tempHp','tempHp'],['willCurrent','willCurrent'],['willMax','willMax'],['notes','notes']].forEach(([id,key]) => {
  els[id].addEventListener('change', () => {
    const u = selectedUnit();
    if (!u) return;
    checkpoint(`修改${key}`);
    u[key] = ['tempHp','willCurrent','willMax'].includes(key) ? num(els[id]) : els[id].value;
    normalizeUnit(u);
    commit(`修改${u.name}的${key}`, u);
  });
});
const attributeFieldMap={attrStrength:'strength',attrDexterity:'dexterity',attrStamina:'stamina',attrIntelligence:'intelligence',attrPerception:'perception',attrResolve:'resolve',attrPresence:'presence',attrManipulation:'manipulation',attrComposure:'composure'};
Object.entries(attributeFieldMap).forEach(([id,key])=>els[id].addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('修改属性值');u.attributes[key]=num(els[id]);finishChange();}));
const defenseFieldMap={defBase:'base',defDodge:'dodge',defBlock:'block',defArmor:'armor',defNatural:'natural',defShield:'shield',defOther:'other'};
Object.entries(defenseFieldMap).forEach(([id,key])=>els[id].addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('修改防御');u.defense[key]=num(els[id]);finishChange();}));
els.defAmbush.addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('切换措手不及');u.defense.ambush=els.defAmbush.checked;finishChange();});
els.defTouch.addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('切换接触攻击');u.defense.touch=els.defTouch.checked;finishChange();});

els.unitFaction.addEventListener('change', () => {
  const u = selectedUnit();
  if (!u) return;
  checkpoint('修改阵营');
  u.faction = els.unitFaction.value;
  commit(`将${u.name}设为${u.faction === 'enemy' ? '敌人' : '轮回者'}`, u);
});
els.hpMax.addEventListener('change', () => {
  const u = selectedUnit();
  if (!u) return;
  checkpoint('修改生命值上限');
  const beforeState = unitState(u).text;
  u.hpMax = Math.max(1, num(els.hpMax));
  normalizeUnit(u);
  addStateTransitionLogs(u, beforeState);
  finishChange();
});

els.applyDamageBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u) return;
  const incoming = {B:num(els.damageB), L:num(els.damageL), A:num(els.damageA)};
  if (!incoming.B && !incoming.L && !incoming.A) return;
  checkpoint('应用伤害');
  const beforeState = unitState(u).text;
  applyDamage(u, incoming);
  els.damageB.value = els.damageL.value = els.damageA.value = 0;
  const text = `${u.name} 受到 ${formatDamageEvent(incoming)}`;
  addBattleLog(text, 'damage', u);
  addStateTransitionLogs(u, beforeState);
  finishChange();
});
els.applyHealBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u) return;
  const amount = num(els.healAmount);
  if (!amount) return;
  const type = els.healType.value;
  const available = type === 'auto' ? u.B + u.L + u.A : u[type];
  if (available <= 0) return;
  checkpoint('应用治疗');
  const beforeState = unitState(u).text;
  const healed = healUnit(u, amount, type);
  const actual = healed.B + healed.L + healed.A;
  els.healAmount.value = 0;
  const text = `${u.name} 治疗 ${actual}`;
  addBattleLog(text, 'heal', u);
  addStateTransitionLogs(u, beforeState);
  finishChange();
});

els.addStatusBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u) return;
  checkpoint('添加不良状态');
  u.statuses.push({id:uid(), name:'恶心', value:0, note:'', attr1:'stamina', attr2:'resolve', catastrophic:false});
  commit('添加不良状态', u);
});
els.addPoolBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u) return;
  checkpoint('添加能量池');
  u.pools.push({id:uid(), name:'能量', current:0, max:0});
  commit('添加能量池', u);
});
els.openManualEditBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u) return;
  els.manualGood.value = u.good;
  els.manualB.value = u.B;
  els.manualL.value = u.L;
  els.manualA.value = u.A;
  els.manualEditError.textContent = '';
  els.manualEditDialog.showModal();
});
els.manualEditForm.addEventListener('submit', e => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const u = selectedUnit();
  if (!u) return;
  const v = {good:num(els.manualGood), B:num(els.manualB), L:num(els.manualL), A:num(els.manualA)};
  if (v.good + v.B + v.L + v.A !== u.hpMax) {
    els.manualEditError.textContent = `总和必须等于生命值上限 ${u.hpMax}。`;
    return;
  }
  checkpoint('直接编辑生命状态');
  const beforeState = unitState(u).text;
  Object.assign(u, v);
  addBattleLog(`${u.name} 的生命状态被手动调整`, 'other', u);
  addStateTransitionLogs(u, beforeState);
  finishChange();
  els.manualEditDialog.close();
});

els.avatarInput.addEventListener('change', async () => {
  const u = selectedUnit();
  const file = els.avatarInput.files[0];
  if (!u || !file) return;
  checkpoint('更换头像');
  u.avatar = await compressImage(file, 256);
  commit(`更换${u.name}的头像`, u);
  els.avatarInput.value = '';
});
function compressImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(c.toDataURL('image/webp', .82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

els.addCurrentToInitiativeBtn.addEventListener('click', () => {
  const u = selectedUnit();
  if (!u || state.initiative.some(x => x.unitId === u.id)) return;
  checkpoint('加入行动顺序');
  state.initiative.push({unitId:u.id, skipped:false});
  addBattleLog(`${u.name} 加入行动顺序`, 'other', u);
  finishChange();
});
els.clearAuditBtn?.addEventListener('click', () => {
  checkpoint('清空战斗日志');
  state.auditLog = [];
  finishChange();
});
els.clearInitiativeBtn.addEventListener('click', () => {
  checkpoint('清空行动顺序');
  state.initiative = [];
  state.currentTurn = 0;
  state.round = 1;
  addBattleLog('行动顺序已清空', 'other');
  finishChange();
});
function moveTurn(dir) {
  if (!state.initiative.length) return;
  checkpoint('切换行动');
  let idx = state.currentTurn;
  let loops = 0;
  let enteredNewRound = false;
  do {
    idx += dir;
    if (idx >= state.initiative.length) {
      idx = 0;
      if (dir > 0) {
        state.round++;
        enteredNewRound = true;
      }
    }
    if (idx < 0) {
      idx = state.initiative.length - 1;
      if (state.round > 1) state.round--;
    }
    loops++;
  } while (state.initiative[idx]?.skipped && loops < state.initiative.length);
  state.currentTurn = idx;
  const u = state.units.find(x => x.id === state.initiative[idx]?.unitId);
  if (u) state.selectedUnitId = u.id;
  if (enteredNewRound) ensureRoundMarker(state.round);
  finishChange();
}
els.nextTurnBtn.addEventListener('click', () => moveTurn(1));
els.prevTurnBtn.addEventListener('click', () => moveTurn(-1));

els.undoBtn.addEventListener('click', () => {
  if (!undoStack.length) return;
  redoStack.push({state:deepClone(state)});
  state = undoStack.pop().state;
  saveState();
  render();
});
els.redoBtn.addEventListener('click', () => {
  if (!redoStack.length) return;
  undoStack.push({state:deepClone(state)});
  state = redoStack.pop().state;
  saveState();
  render();
});

els.exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `无限流TRPG战斗-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
els.importInput.addEventListener('change', async () => {
  const file = els.importInput.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    checkpoint('导入战斗');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    state = loadState();
    saveState();
    render();
  } catch {
    alert('无法读取该 JSON 文件。');
  }
  els.importInput.value = '';
});
els.resetAllBtn.addEventListener('click', () => {
  if (!confirm('确定清空全部单位与战斗数据吗？')) return;
  checkpoint('重置全部');
  state = deepClone(initialState);
  saveState();
  render();
});

els.toggleSidebarBtn.addEventListener('click', () => {
  els.appShell.classList.add('drawer-collapsed');
  els.openSidebarBtn.classList.remove('hidden');
});
els.openSidebarBtn.addEventListener('click', () => {
  els.appShell.classList.remove('drawer-collapsed');
  els.openSidebarBtn.classList.add('hidden');
});

document.querySelectorAll('.drawer-section > .section-title').forEach(title => {
  title.addEventListener('click', () => title.parentElement.classList.toggle('collapsed'));
});
document.querySelectorAll('[data-log-filter]').forEach(button => {
  button.addEventListener('click', () => {
    activeLogFilter = button.dataset.logFilter;
    renderAuditLog();
  });
});
els.unitContextMenu?.addEventListener('click', event => {
  event.stopPropagation();
  const button = event.target.closest('[data-context-action]');
  if (!button) return;
  const unitId = contextUnitId;
  const action = button.dataset.contextAction;
  closeUnitContextMenu();
  if (!unitId) return;
  state.selectedUnitId = unitId;
  saveState();
  if (action === 'damage') {
    render();
    els.damageB.focus();
    els.damageB.select();
  } else if (action === 'heal') {
    render();
    els.healAmount.focus();
    els.healAmount.select();
  } else if (action === 'status') {
    els.appShell.classList.remove('drawer-collapsed');
    els.openSidebarBtn.classList.add('hidden');
    $('detailSection')?.classList.remove('collapsed');
    render();
    setTimeout(() => els.statusList.scrollIntoView({behavior:'smooth', block:'center'}), 0);
  } else if (action === 'duplicate') {
    duplicateUnitById(unitId);
  } else if (action === 'delete') {
    deleteUnitById(unitId);
  }
});
document.addEventListener('click', closeUnitContextMenu);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeUnitContextMenu(); });
window.addEventListener('resize', closeUnitContextMenu);
window.addEventListener('scroll', closeUnitContextMenu, true);

render();
