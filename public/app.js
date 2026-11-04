const socket = io();
const $ = id => document.getElementById(id);
let me = {id:null,name:'',room:null,hostId:null,ready:false,score:0};
let players = [], selected = false, endsAt = 0, tick = null, currentCorrect = null;
const letters = ['A','B','C','D'];
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id));}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400);}
function emitAck(event,data){return new Promise(resolve=>socket.emit(event,data,resolve));}
function name(){return $('playerName').value.trim();}
function renderPlayers(){
  $('playerCount').textContent=`${players.length} / 5`;
  $('playerList').innerHTML='';
  players.forEach((p,i)=>{const row=document.createElement('div');row.className='player-row';const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=(p.name[0]||'?').toUpperCase();const nm=document.createElement('div');nm.className='player-name';nm.textContent=p.name;if(p.id===me.hostId){const tag=document.createElement('span');tag.className='host-tag';tag.textContent='KURUCU';nm.append(tag);}const status=document.createElement('div');status.className='status'+(p.ready?' ready':'');status.textContent=p.ready?'✓ HAZIR':'HAZIR DEĞİL';row.append(avatar,nm,status);$('playerList').append(row);});
  $('startBtn').disabled=!(me.id===me.hostId && players.length>0 && players.every(p=>p.ready));
  $('startBtn').textContent=me.id===me.hostId?'YARIŞMAYI BAŞLAT':'ODA SAHİBİ BAŞLATIR';
  $('readyBtn').textContent=me.ready?'✕ HAZIR DEĞİLİM':'✓ HAZIRIM';
  $('lobbyHint').textContent=players.every(p=>p.ready)?'Herkes hazır. Oda sahibi yarışmayı başlatabilir.':'Başlatmak için herkes hazır olmalı.';
}
function renderLive(){ $('livePlayers').innerHTML=''; players.forEach(p=>{const x=document.createElement('span');x.className='live-pill'+(p.answered?' done':'');x.textContent=`${p.name} · ${p.answered?'Cevapladı':'Bekliyor'}`;$('livePlayers').append(x);});$('answeredCount').textContent=`${players.filter(p=>p.answered).length} / ${players.length} cevapladı`; }
$('createBtn').onclick=async()=>{if(!name())return toast('Önce oyuncu adını yaz.');const r=await emitAck('room:create',{name:name()});if(!r?.ok)return toast(r?.error||'Oda oluşturulamadı.');me={...me,id:r.playerId,name:name(),room:r.code,hostId:r.playerId,ready:false,score:0};$('roomCodeView').textContent=r.code;show('lobby');};
$('joinBtn').onclick=async()=>{if(!name())return toast('Önce oyuncu adını yaz.');const code=$('roomCode').value.trim();if(!/^\d{6}$/.test(code))return toast('6 haneli oda kodunu gir.');const r=await emitAck('room:join',{name:name(),code});if(!r?.ok)return toast(r?.error||'Odaya katılınamadı.');me={...me,id:r.playerId,name:name(),room:r.code,ready:false,score:0};$('roomCodeView').textContent=r.code;show('lobby');};
$('readyBtn').onclick=async()=>{const next=!me.ready;const r=await emitAck('room:ready',next);if(r?.ok)me.ready=next;};
$('startBtn').onclick=async()=>{const r=await emitAck('game:start');if(!r?.ok)toast(r?.error||'Oyun başlatılamadı.');};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(me.room);toast('Oda kodu kopyalandı.');}catch{toast(`Oda kodu: ${me.room}`);}};
$('leaveBtn').onclick=()=>{socket.disconnect();location.reload();};
$('backHome').onclick=()=>location.reload();
$('rulesBtn').onclick=()=> $('rulesModal').classList.remove('hidden');$('closeRules').onclick=$('rulesOk').onclick=()=> $('rulesModal').classList.add('hidden');
$('roomCode').addEventListener('input',e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,6));
socket.on('lobby:update',data=>{me.hostId=data.hostId;players=data.players;const self=players.find(p=>p.id===me.id);if(self){me.ready=self.ready;me.score=self.score;}if($('lobby').classList.contains('active'))renderPlayers();});
socket.on('notice',toast);
socket.on('game:started',()=>{me.score=0;selected=false;show('game');toast('Yarışma başladı! Bol şans.');});
socket.on('game:question',q=>{
  selected=false;currentCorrect=null;endsAt=q.endsAt;$('questionCount').textContent=`SORU ${q.number} / ${q.total}`;$('progressBar').style.width=`${(q.number-1)/q.total*100}%`;$('questionText').textContent=q.question;$('answerStatus').textContent='Cevabını seç. Gönderdiğinde kilitlenir.';$('myScore').textContent=me.score;
  const grid=$('answerGrid');grid.innerHTML='';q.options.forEach((opt,i)=>{const b=document.createElement('button');b.className='answer-option';const l=document.createElement('span');l.className='letter';l.textContent=letters[i];const t=document.createElement('span');t.textContent=opt;b.append(l,t);b.onclick=()=>answer(i,b);grid.append(b);});
  clearInterval(tick);tick=setInterval(()=>{const left=Math.max(0,Math.ceil((endsAt-Date.now())/1000));$('timer').textContent=left;if(left<=5)$('timer').style.borderColor='#e65f65';else $('timer').style.borderColor='var(--blue)';if(left===0)clearInterval(tick);},100);
  renderLive();
});
async function answer(i,button){if(selected)return;selected=true;document.querySelectorAll('.answer-option').forEach(b=>b.disabled=true);button.classList.add('selected');$('answerStatus').textContent='Cevabın gönderiliyor...';const r=await emitAck('game:answer',i);if(!r?.ok){$('answerStatus').textContent=r?.error||'Cevap gönderilemedi.';return;}if(r.correct){me.score+=r.earned;$('answerStatus').textContent=`Doğru cevap! +${r.earned} puan`;}else $('answerStatus').textContent='Bu kez olmadı. Cevabın kilitlendi.';$('myScore').textContent=me.score;}
socket.on('game:progress',data=>{const p=players.find(x=>x.id===data.playerId);if(p){p.answered=true;p.score=data.score;}renderLive();});
socket.on('game:reveal',data=>{currentCorrect=data.correctIndex;const buttons=[...document.querySelectorAll('.answer-option')];buttons.forEach((b,i)=>{if(i===currentCorrect)b.classList.add('correct');else if(b.classList.contains('selected'))b.classList.add('wrong');});$('answerStatus').textContent=`Doğru cevap: ${letters[currentCorrect]}`;});
socket.on('game:finished',data=>{clearInterval(tick);$('progressBar').style.width='100%';show('results');const top=data.ranking[0];$('winner').innerHTML=`<div class="winner-crown">♛</div><div class="eyebrow">ARENA ŞAMPİYONU</div><div class="winner-name"></div><div class="winner-score"></div>`;$('winner').querySelector('.winner-name').textContent=top?.name||'Kazanan yok';$('winner').querySelector('.winner-score').textContent=`${top?.score||0} PUAN`;$('ranking').innerHTML='';data.ranking.forEach((p,i)=>{const row=document.createElement('div');row.className='rank-row';const n=document.createElement('div');n.className='rank-num';n.textContent=i+1;const name=document.createElement('div');name.className='rank-name';name.textContent=p.name;const score=document.createElement('div');score.className='rank-score';score.textContent=`${p.score} PUAN`;row.append(n,name,score);$('ranking').append(row);});});
socket.on('disconnect',()=>{if(me.room)toast('Sunucu bağlantısı kesildi. Sayfayı yenileyip tekrar bağlan.');});
