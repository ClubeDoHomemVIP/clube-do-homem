const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
let data;
const money = v => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
const ago = v => { const m=Math.floor((Date.now()-new Date(v))/60000); return m<1?'agora':m<60?`há ${m} min`:m<1440?`há ${Math.floor(m/60)}h`:`há ${Math.floor(m/1440)}d`; };
const labels={active:'Ativo',expiring:'A vencer',overdue:'Inadimplente',removed:'Removido',pending:'Pendente',paid:'Pago'};
async function api(path, options){const r=await fetch(path,{headers:{'content-type':'application/json'},...options});const j=await r.json();if(!r.ok)throw new Error(j.error);return j}
async function load(){data=await api('/api/dashboard');render()}
function render(){
  const m=data.metrics; $('#memberCount').textContent=data.members.length;
  $('#metrics').innerHTML=[['♙','Membros ativos',m.activeMembers,'+8,4% este mês'],['◇','Receita mensal',money(m.mrr),'+12,7% este mês'],['↗','Receita no mês',money(m.revenueMonth),'Pagamentos confirmados'],['!','Inadimplentes',m.overdue,'Ação necessária'],['◎','Conversão',`${m.conversion}%`,'Checkout → pagamento']].map((x,i)=>`<article class="metric"><div class="top"><span>${x[1]}</span><i class="icon">${x[0]}</i></div><strong>${x[2]}</strong><small class="${i<2?'up':''}">${x[3]}</small></article>`).join('');
  const max=Math.max(...data.chart.map(x=>x.revenue));$('#chart').innerHTML=data.chart.map(x=>`<div class="bar-wrap"><div class="bar" title="${money(x.revenue)}" style="height:${x.revenue/max*100}%"></div><small>${x.label}</small></div>`).join('');
  const active=data.members.filter(x=>x.status==='active').length,expiring=data.members.filter(x=>x.status==='expiring').length,overdue=data.members.filter(x=>['overdue','removed'].includes(x.status)).length,total=data.members.length;$('#donutNumber').textContent=total;$('#activeLegend').textContent=active;$('#expiringLegend').textContent=expiring;$('#overdueLegend').textContent=overdue;$('#donut').style.background=`conic-gradient(var(--green) 0 ${active/total*100}%,var(--orange) ${active/total*100}% ${(active+expiring)/total*100}%,var(--red) ${(active+expiring)/total*100}% 100%)`;
  const events=items=>items.map(e=>`<div class="event ${e.level}"><span class="event-icon">${e.level==='warning'?'!':'✓'}</span><p>${e.message}</p><small>${ago(e.createdAt)}</small></div>`).join('');$('#events').innerHTML=events(data.events.slice(0,4));$('#allEvents').innerHTML=events(data.events);
  renderMembers(data.members);$('#paymentsTable').innerHTML=data.payments.map(p=>`<tr><td><b>${p.customer}</b><small>${p.id.slice(0,14)}</small></td><td>${money(p.amount)}</td><td><span class="badge ${p.status}">${labels[p.status]}</span></td><td>${date(p.paidAt||p.createdAt)}</td><td>${p.provider}</td></tr>`).join('');
  $('#affiliateGrid').innerHTML=data.affiliates.map(a=>`<article class="card affiliate"><div class="affiliate-top"><div class="affiliate-avatar">${a.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><code>${a.code}</code></div><h3>${a.name}</h3><p>Comissão de 20% por venda</p><div class="affiliate-stats"><span><small>VENDAS</small><b>${a.sales}</b></span><span><small>RECEITA</small><b>${money(a.revenue)}</b></span><span><small>COMISSÃO</small><b>${money(a.commission)}</b></span></div></article>`).join('');
  $('#tgConnection').textContent=data.settings.telegramConnected?'Conectado':'Modo demonstração';
  $('#pixConnection').textContent=data.settings.pushinConnected?'Conectado':'Aguardando credenciais';
  $('#n8nConnection').textContent=data.settings.n8nConnected?'Conectado':'Não conectado';
}
function renderMembers(items){$('#membersTable').innerHTML=items.map(m=>`<tr><td><b>${m.name}</b><small>${m.email} · ${m.telegram}</small></td><td>${m.plan}<small>${money(m.amount)}</small></td><td><span class="badge ${m.status}">${labels[m.status]||m.status}</span></td><td>${date(m.expiresAt)}</td><td>${m.affiliate}</td></tr>`).join('')}
function go(id){$$('.view,.nav').forEach(x=>x.classList.remove('active'));$(`#${id}`).classList.add('active');$(`.nav[data-view="${id}"]`)?.classList.add('active');$('#pageTitle').textContent=$(`.nav[data-view="${id}"]`)?.textContent.trim().replace(/\d+$/,'')||'Visão geral'}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2600)}
$$('.nav').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$$('[data-action="new-member"]').forEach(b=>b.onclick=()=>$('#memberModal').classList.add('open'));$('.close').onclick=()=>$('#memberModal').classList.remove('open');
$('#memberForm').onsubmit=async e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(e.target));await api('/api/members',{method:'POST',body:JSON.stringify(payload)});e.target.reset();$('#memberModal').classList.remove('open');toast('Assinante cadastrado');await load()};
$('#simulateBtn').onclick=async()=>{const overdue=data.members.find(m=>m.status==='overdue')||data.members[0];$('#simulateBtn').disabled=true;try{await api('/api/demo/payment',{method:'POST',body:JSON.stringify({memberId:overdue.id})});toast(`PIX de ${overdue.name} confirmado e acesso liberado`);await load()}finally{$('#simulateBtn').disabled=false}};
$('#renewalsBtn').onclick=async()=>{const r=await api('/api/jobs/renewals',{method:'POST',body:'{}'});toast(`${r.reminded} lembrete(s), ${r.removed} remoção(ões)`);await load()};
$('#memberSearch').oninput=e=>{const q=e.target.value.toLowerCase();renderMembers(data.members.filter(m=>[m.name,m.email,m.telegram].some(v=>v.toLowerCase().includes(q))))};
load().catch(e=>toast(e.message));
