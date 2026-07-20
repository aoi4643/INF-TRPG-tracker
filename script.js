const STORAGE_KEY = 'infinite-trpg-combat-tracker-v1';

const initialState = {
  units: [],
  selectedUnitId: null,
  initiative: [],
  currentTurn: 0,
  round: 1,
  auditLog: [],
};

let state = loadState();
let undoStack = [];
let redoStack = [];

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'unitList','addUnitBtn','addEnemyBtn','duplicateUnitBtn','exportBtn','importInput','resetAllBtn','currentUnitTitle','undoBtn','redoBtn','deleteUnitBtn',
  'emptyState','unitEditor','unitFaction','avatarPreview','avatarFallback','avatarInput','unitName','hpMax','tempHp','willCurrent','willMax','autoStateBadge',
  'healthTrack','healthSummary','openManualEditBtn','damageB','damageL','damageA','applyDamageBtn','healAmount','healType','applyHealBtn',
  'addStatusBtn','statusList','addPoolBtn','poolList','notes','historyList','clearHistoryBtn','roundNumber','addCurrentToInitiativeBtn',
  'clearInitiativeBtn','initiativeList','enemyBoard','reincarnatorBoard','quickUnitName','quickStats','turnUnitName','activeTurnCard','toggleSidebarBtn','openSidebarBtn','appShell','prevTurnBtn','nextTurnBtn','manualEditDialog','manualEditForm','manualGood','manualB','manualL','manualA','manualEditError','saveManualEditBtn'
].map(id => [id, $(id)]));

function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
function clamp(n, min, max) { return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)); }
function num(input) { return Math.max(0, Math.floor(Number(input.value) || 0)); }
function nowText() { return new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }

function defaultUnit(index = 1) {
  return {
    id: uid(), name: `单位 ${index}`, faction: 'reincarnator', avatar: '', hpMax: 10, good: 10, B: 0, L: 0, A: 0,
    tempHp: 0, willCurrent: 0, willMax: 0, statuses: [], pools: [], notes: '', history: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(initialState);
    const parsed = JSON.parse(raw);
    return {...deepClone(initialState), ...parsed};
  } catch { return deepClone(initialState); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function checkpoint(label) {
  undoStack.push({state: deepClone(state), label});
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function commit(label, unit = selectedUnit()) {
  if (unit) unit.history.unshift({text: label, time: nowText()});
  state.auditLog.unshift({text: label, time: nowText()});
  saveState(); render();
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
}

function normalizeDamage(unit) {
  while (unit.B + unit.L + unit.A > unit.hpMax) {
    const overflow = unit.B + unit.L + unit.A - unit.hpMax;
    if (unit.B > 0) {
      const bToConvert = Math.min(unit.B, overflow * 2);
      const converted = Math.ceil(bToConvert / 2);
      unit.B -= bToConvert;
      unit.L += converted;
      continue;
    }
    if (unit.L > 0) {
      const lToConvert = Math.min(unit.L, overflow * 2);
      const converted = Math.ceil(lToConvert / 2);
      unit.L -= lToConvert;
      unit.A += converted;
      continue;
    }
    break;
  }
  if (unit.A > unit.hpMax) unit.A = unit.hpMax;
}

function applyDamage(unit, incoming) {
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
  normalizeUnit(unit);
  return {remaining: damage, absorbed};
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
  els.undoBtn.disabled = undoStack.length === 0;
  els.redoBtn.disabled = redoStack.length === 0;
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
      item.innerHTML = `${avatar}<div class="unit-meta"><strong>${escapeHtml(u.name)}</strong><span>${unitState(u).text}</span></div><div class="unit-health-mini">${u.good}/${u.hpMax}<br>B${u.B} L${u.L} A${u.A}</div>`;
      item.addEventListener('click', () => { state.selectedUnitId = u.id; saveState(); render(); });
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
    const pct=Math.max(0,Math.min(100,Math.round((u.good/u.hpMax)*100)));
    const tags=(u.statuses||[]).filter(x=>x.value>0).map(x=>`${x.name}${x.value}`).join(' · ') || '无不良状态';
    card.innerHTML=`<div class="battle-unit-head"><strong>${escapeHtml(u.name)}</strong><small>${st.text}</small></div><div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div></div><div class="battle-unit-stats">HP ${u.good}/${u.hpMax} · B${u.B} L${u.L} A${u.A}</div><div class="battle-unit-tags">${escapeHtml(tags)}</div>`;
    card.addEventListener('click',()=>{state.selectedUnitId=u.id;saveState();render();});
    (ally?els.reincarnatorBoard:els.enemyBoard).appendChild(card);
  });
  if(!els.enemyBoard.children.length) els.enemyBoard.innerHTML='<div class="drawer-empty">暂无敌人</div>';
  if(!els.reincarnatorBoard.children.length) els.reincarnatorBoard.innerHTML='<div class="drawer-empty">暂无轮回者</div>';
  const u=selectedUnit();
  els.quickUnitName.textContent=u?u.name:'未选择单位';
  els.quickStats.textContent=u?`HP ${u.good}/${u.hpMax} · 临时 ${u.tempHp} · 意志 ${u.willCurrent}/${u.willMax}`:'HP — · 意志 —';
  const turn=state.units.find(x=>x.id===currentId);
  els.turnUnitName.textContent=turn?.name||'—';
  els.activeTurnCard.innerHTML=turn?`<b>行动中 · ${escapeHtml(turn.name)}</b><span>HP ${turn.good}/${turn.hpMax} · 意志 ${turn.willCurrent}/${turn.willMax} · B${turn.B} L${turn.L} A${turn.A}</span>`:'<b>等待设置行动顺序</b><span>HP — · 意志 —</span>';
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
  if (u.avatar) { els.avatarPreview.src = u.avatar; els.avatarPreview.classList.remove('hidden'); els.avatarFallback.classList.add('hidden'); }
  else { els.avatarPreview.classList.add('hidden'); els.avatarFallback.classList.remove('hidden'); els.avatarFallback.textContent = (u.name || '?')[0]; }
  const st = unitState(u); els.autoStateBadge.className = `state-badge ${st.cls}`; els.autoStateBadge.textContent = st.text;
  renderHealth(u); renderStatuses(u); renderPools(u); renderHistory(u);
}
function setValue(el, value) { if (document.activeElement !== el) el.value = value; }

function renderHealth(u) {
  els.healthTrack.innerHTML = '';
  const cells = [
    ...Array(u.good).fill('good'), ...Array(u.B).fill('B'), ...Array(u.L).fill('L'), ...Array(u.A).fill('A')
  ];
  cells.forEach(type => { const c = document.createElement('div'); c.className = `health-cell ${type}`; c.textContent = type === 'good' ? '□' : type; els.healthTrack.appendChild(c); });
  els.healthSummary.innerHTML = `<span>完好 <b>${u.good}</b></span><span>B <b>${u.B}</b></span><span>L <b>${u.L}</b></span><span>A <b>${u.A}</b></span><span>临时生命 <b>${u.tempHp}</b></span>`;
}

function renderStatuses(u) {
  els.statusList.innerHTML = '';
  if (!u.statuses.length) els.statusList.innerHTML = '<p class="hint">暂无不良状态。</p>';
  u.statuses.forEach(s => {
    const row = document.createElement('div'); row.className = 'stack-row status-row';
    row.innerHTML = `<label>名称<input data-k="name" value="${escapeAttr(s.name)}"></label><label>点数<input data-k="value" type="number" min="0" value="${s.value}"></label><label>备注<input data-k="note" value="${escapeAttr(s.note || '')}"></label><button class="danger">删除</button>`;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
      checkpoint('修改不良状态'); s[inp.dataset.k] = inp.dataset.k === 'value' ? Math.max(0, Math.floor(Number(inp.value)||0)) : inp.value; commit(`修改不良状态：${s.name}`, u);
    }));
    row.querySelector('button').addEventListener('click', () => { checkpoint('删除不良状态'); u.statuses = u.statuses.filter(x=>x.id!==s.id); commit(`删除不良状态：${s.name}`, u); });
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

function renderHistory(u) {
  els.historyList.innerHTML = '';
  if (!u.history.length) els.historyList.innerHTML = '<p class="hint">暂无操作记录。</p>';
  u.history.forEach(h => { const div = document.createElement('div'); div.className='history-entry'; div.innerHTML=`<span>${escapeHtml(h.text)}</span><span>${escapeHtml(h.time)}</span>`; els.historyList.appendChild(div); });
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

function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(s='') { return escapeHtml(s); }

els.addUnitBtn.addEventListener('click',()=>{checkpoint('添加轮回者');const u=defaultUnit(state.units.length+1);u.name=`轮回者 ${state.units.filter(x=>(x.faction||'reincarnator')==='reincarnator').length+1}`;u.faction='reincarnator';state.units.push(u);state.selectedUnitId=u.id;commit(`添加单位：${u.name}`,u);});
els.addEnemyBtn.addEventListener('click',()=>{checkpoint('添加敌人');const u=defaultUnit(state.units.length+1);u.name=`敌人 ${state.units.filter(x=>x.faction==='enemy').length+1}`;u.faction='enemy';state.units.push(u);state.selectedUnitId=u.id;commit(`添加单位：${u.name}`,u);});
els.duplicateUnitBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;checkpoint('复制单位');const copy=deepClone(u);copy.id=uid();copy.name=`${u.name} 副本`;copy.history=[];state.units.push(copy);state.selectedUnitId=copy.id;commit(`复制单位：${u.name}`,copy);});
els.deleteUnitBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u||!confirm(`确定删除“${u.name}”吗？`))return;checkpoint('删除单位');state.units=state.units.filter(x=>x.id!==u.id);state.initiative=state.initiative.filter(x=>x.unitId!==u.id);state.selectedUnitId=state.units[0]?.id||null;commit(`删除单位：${u.name}`,null);});

[['unitName','name'],['tempHp','tempHp'],['willCurrent','willCurrent'],['willMax','willMax'],['notes','notes']].forEach(([id,key])=>{
  els[id].addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint(`修改${key}`);u[key]=['tempHp','willCurrent','willMax'].includes(key)?num(els[id]):els[id].value;normalizeUnit(u);commit(`修改${u.name}的${key}`,u);});
});
els.unitFaction.addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('修改阵营');u.faction=els.unitFaction.value;commit(`将${u.name}设为${u.faction==='enemy'?'敌人':'轮回者'}`,u);});
els.hpMax.addEventListener('change',()=>{const u=selectedUnit();if(!u)return;checkpoint('修改生命值上限');u.hpMax=Math.max(1,num(els.hpMax));normalizeUnit(u);commit(`将${u.name}的生命值上限改为${u.hpMax}`,u);});

els.applyDamageBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;const incoming={B:num(els.damageB),L:num(els.damageL),A:num(els.damageA)};if(!incoming.B&&!incoming.L&&!incoming.A)return;checkpoint('应用伤害');const result=applyDamage(u,incoming);els.damageB.value=els.damageL.value=els.damageA.value=0;const text=`${u.name}受到 ${incoming.B}B / ${incoming.L}L / ${incoming.A}A${result.absorbed?`，临时生命吸收${result.absorbed}`:''}`;commit(text,u);});
els.applyHealBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;const amount=num(els.healAmount);if(!amount)return;checkpoint('应用治疗');const healed=healUnit(u,amount,els.healType.value);els.healAmount.value=0;commit(`${u.name}恢复生命：B${healed.B} / L${healed.L} / A${healed.A}`,u);});

els.addStatusBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;checkpoint('添加不良状态');u.statuses.push({id:uid(),name:'新状态',value:0,note:''});commit('添加不良状态',u);});
els.addPoolBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;checkpoint('添加能量池');u.pools.push({id:uid(),name:'能量',current:0,max:0});commit('添加能量池',u);});
els.clearHistoryBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;checkpoint('清空历史显示');u.history=[];commit('清空单位历史显示',null);});

els.openManualEditBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u)return;els.manualGood.value=u.good;els.manualB.value=u.B;els.manualL.value=u.L;els.manualA.value=u.A;els.manualEditError.textContent='';els.manualEditDialog.showModal();});
els.manualEditForm.addEventListener('submit',e=>{
  if (e.submitter?.value==='cancel') return;
  e.preventDefault(); const u=selectedUnit(); if(!u)return;
  const v={good:num(els.manualGood),B:num(els.manualB),L:num(els.manualL),A:num(els.manualA)};
  if(v.good+v.B+v.L+v.A!==u.hpMax){els.manualEditError.textContent=`总和必须等于生命值上限 ${u.hpMax}。`;return;}
  checkpoint('直接编辑生命状态');Object.assign(u,v);commit(`直接编辑${u.name}的生命状态`,u);els.manualEditDialog.close();
});

els.avatarInput.addEventListener('change',async()=>{const u=selectedUnit();const file=els.avatarInput.files[0];if(!u||!file)return;checkpoint('更换头像');u.avatar=await compressImage(file,256);commit(`更换${u.name}的头像`,u);els.avatarInput.value='';});
function compressImage(file,size){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');const scale=Math.max(size/img.width,size/img.height);const w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);resolve(c.toDataURL('image/webp',.82));};img.onerror=reject;img.src=URL.createObjectURL(file);});}

els.addCurrentToInitiativeBtn.addEventListener('click',()=>{const u=selectedUnit();if(!u||state.initiative.some(x=>x.unitId===u.id))return;checkpoint('加入行动顺序');state.initiative.push({unitId:u.id,skipped:false});commit(`${u.name}加入行动顺序`,null);});
els.clearInitiativeBtn.addEventListener('click',()=>{checkpoint('清空行动顺序');state.initiative=[];state.currentTurn=0;state.round=1;commit('清空行动顺序',null);});
function moveTurn(dir){if(!state.initiative.length)return;checkpoint('切换行动');let idx=state.currentTurn;let loops=0;do{idx+=dir;if(idx>=state.initiative.length){idx=0;if(dir>0)state.round++;}if(idx<0){idx=state.initiative.length-1;if(state.round>1)state.round--;}loops++;}while(state.initiative[idx]?.skipped&&loops<=state.initiative.length);state.currentTurn=idx;const u=state.units.find(x=>x.id===state.initiative[idx]?.unitId);if(u)state.selectedUnitId=u.id;commit(`切换至${u?.name||'下一单位'}行动`,null);}
els.nextTurnBtn.addEventListener('click',()=>moveTurn(1));els.prevTurnBtn.addEventListener('click',()=>moveTurn(-1));

els.undoBtn.addEventListener('click',()=>{if(!undoStack.length)return;redoStack.push({state:deepClone(state)});state=undoStack.pop().state;saveState();render();});
els.redoBtn.addEventListener('click',()=>{if(!redoStack.length)return;undoStack.push({state:deepClone(state)});state=redoStack.pop().state;saveState();render();});

els.exportBtn.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`无限流TRPG战斗-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);});
els.importInput.addEventListener('change',async()=>{const file=els.importInput.files[0];if(!file)return;try{const parsed=JSON.parse(await file.text());checkpoint('导入战斗');state={...deepClone(initialState),...parsed};saveState();render();}catch{alert('无法读取该 JSON 文件。');}els.importInput.value='';});
els.resetAllBtn.addEventListener('click',()=>{if(!confirm('确定清空全部单位与战斗数据吗？'))return;checkpoint('重置全部');state=deepClone(initialState);saveState();render();});

els.toggleSidebarBtn.addEventListener('click',()=>{els.appShell.classList.add('drawer-collapsed');els.openSidebarBtn.classList.remove('hidden');});
els.openSidebarBtn.addEventListener('click',()=>{els.appShell.classList.remove('drawer-collapsed');els.openSidebarBtn.classList.add('hidden');});

render();
