const API='https://clube-do-homem-api.gustavofideliza.workers.dev';
const $=id=>document.getElementById(id);let key=sessionStorage.getItem('adminKey')||'';
const money=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
async function api(path,options={}){const response=await fetch(API+path,{...options,headers:{authorization:`Bearer ${key}`,'content-type':'application/json',...(options.headers||{})}});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||(response.status===401?'Chave inválida':'Falha na API'))}return response.json()}
async function load(){
  const data=await api('/api/admin/dashboard');$('login').hidden=true;$('panel').hidden=false;const s=data.summary;
  const cards=[['Clientes',s.customers],['Ativos',s.active],['Receita',money(s.revenueCents)],['Entradas no funil',s.starts],['Conversão',`${s.conversion}%`],['Vitalícios',s.lifetime]];
  $('cards').innerHTML=cards.map(([label,value])=>`<div class="card"><small>${label}</small><b>${value}</b></div>`).join('');
  $('payments').innerHTML=data.recentPayments.map(item=>`<tr><td>${item.customers?.name||'—'}</td><td>${money(item.amount_cents)}</td><td>${item.status}</td><td>${date(item.paid_at||item.created_at)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum pagamento</td></tr>';
  $('expiring').innerHTML=data.expiring.map(item=>`<tr><td>${item.customers?.name||'—'}</td><td>${item.customers?.telegram_username||item.customers?.telegram_user_id||'—'}</td><td>${date(item.expires_at)}</td></tr>`).join('')||'<tr><td colspan="3">Nenhum vencimento</td></tr>';
  $('affiliates').innerHTML=data.affiliates.map(item=>{const link=`https://t.me/clube_do_homem_acesso_bot?start=ref_${item.code}`;return `<tr><td>${item.name}<br><small>${item.commission_percent}%</small></td><td><button data-link="${link}" class="copy-link">Copiar link</button></td><td>${item.sales}</td><td>${money(item.revenueCents)}</td><td>${money(item.commissionCents)}</td></tr>`}).join('')||'<tr><td colspan="5">Nenhum afiliado</td></tr>';
  document.querySelectorAll('.copy-link').forEach(button=>button.onclick=()=>navigator.clipboard.writeText(button.dataset.link));
  $('updated').textContent='Atualizado '+new Date().toLocaleTimeString('pt-BR');
}
$('enter').onclick=async()=>{key=$('key').value.trim();sessionStorage.setItem('adminKey',key);try{await load()}catch(error){$('loginError').textContent=error.message}};
$('refresh').onclick=load;
$('renewals').onclick=async()=>{const result=await api('/api/admin/renewals',{method:'POST'});alert(`${result.reminded} lembretes e ${result.removed} remoções`);await load()};
$('affiliateForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const result=await api('/api/admin/affiliates',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});await navigator.clipboard.writeText(result.link);alert('Afiliado criado e link copiado');event.currentTarget.reset();await load()}catch(error){alert(error.message)}};
$('logout').onclick=()=>{sessionStorage.removeItem('adminKey');location.reload()};if(key)load().catch(()=>sessionStorage.removeItem('adminKey'));
