/* --------------------------------------------------------------
   Конфиг и подключение
-------------------------------------------------------------- */
const WS_URL = 'wss://rsi-heatmap.onrender.com/ws'; // на Railway поменяешь на wss://...
let ws;
let data = {symbols:[], prices:{}, rsi:{}, volumes:{}};
const TF = ['1m','3m','5m','15m','30m','1h','4h','12h','1d'];
let sort = {column:'symbol', order:'asc'};

/* --------------------------------------------------------------
   UI‑элементы
-------------------------------------------------------------- */
const statusEl   = document.getElementById('connection-status');
const tbody      = document.getElementById('table-body');
const countEl    = document.getElementById('active-count');
const searchEl   = document.getElementById('search');
const modal      = document.getElementById('chart-modal');
const modalSpan  = modal.querySelector('.close');
const modalHead  = document.getElementById('modal-header');
const modalChart = document.getElementById('modal-chart');
const modalCtx   = modalChart.getContext('2d');
const tooltipEl  = document.getElementById('chart-tooltip');

/* --------------------------------------------------------------
   WebSocket
-------------------------------------------------------------- */
function connectWS(){
    ws = new WebSocket(WS_URL);
    ws.onopen = ()=>{
        statusEl.innerHTML = '<div class="pulsing-dot green"></div> Live';
        statusEl.className = 'status-pill live';
    };
    ws.onmessage = e=>{
        const d = JSON.parse(e.data);
        data = d;
        countEl.textContent = data.symbols.length || 0;
        renderTable();
    };
    ws.onclose = ()=>{
        statusEl.innerHTML = '<div class="pulsing-dot red"></div> Reconnecting…';
        statusEl.className = 'status-pill';
        setTimeout(connectWS, 2000);
    };
    ws.onerror = ()=> ws.close();
}
connectWS();

/* --------------------------------------------------------------
   Вспомогательные функции
-------------------------------------------------------------- */
function fmtPrice(p){
    if(p===undefined) return '—';
    if(p<0.0001) return p.toFixed(8);
    if(p<1)      return p.toFixed(4);
    if(p<10)     return p.toFixed(3);
    return p.toFixed(2);
}

function rsiClass(v){
    if(v===undefined||v===null||isNaN(v))
        return {cls:'neutral', zone:'', txt:'—'};
    const r   = parseFloat(v);
    const txt = r.toFixed(1);
    let cls, zone = '';
    if(r>=80){ cls='bg-overbought-extreme'; zone='zone-high'; }
    else if(r>=70){ cls='bg-overbought'; zone='zone-high'; }
    else if(r>=60){ cls='bg-neutral-high'; }
    else if(r<=20){ cls='bg-oversold-extreme'; zone='zone-low'; }
    else if(r<=30){ cls='bg-oversold'; zone='zone-low'; }
    else if(r<=40){ cls='bg-neutral-low'; }
    else{ cls='neutral'; }
    return {cls, zone, txt};
}

function showTooltip(x, y, html){
    tooltipEl.innerHTML = html;
    tooltipEl.style.left = (x + 10) + 'px';
    tooltipEl.style.top  = (y + 10) + 'px';
    tooltipEl.style.display = 'block';
}
function hideTooltip(){
    tooltipEl.style.display = 'none';
}

/* --------------------------------------------------------------
   Мини‑чарт (цена + объём + зоны RSI)
-------------------------------------------------------------- */
function drawMini(canvas, pricesArr, volumesArr){
    const w = canvas.width  || 80;
    const h = canvas.height || 18;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,w,h);

    const half = h/2;

    // фон RSI‑зон
    ctx.fillStyle = 'rgba(246,70,93,0.10)';
    ctx.fillRect(0, 0, w, half*0.3);        // 70–100
    ctx.fillStyle = 'rgba(11,184,117,0.10)';
    ctx.fillRect(0, half*0.7, w, half*0.3); // 0–30

    // линии 70 и 30
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    const y70 = half * (1 - 0.7);
    const y30 = half * (1 - 0.3);
    ctx.beginPath(); ctx.moveTo(0, y70); ctx.lineTo(w, y70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y30); ctx.lineTo(w, y30); ctx.stroke();

    if(!pricesArr || pricesArr.length < 2){
        ctx.strokeStyle = '#555';
        ctx.beginPath(); ctx.moveTo(0, half/2); ctx.lineTo(w, half/2); ctx.stroke();
        return;
    }

    // цена (верх)
    const priceMin = Math.min(...pricesArr);
    const priceMax = Math.max(...pricesArr);
    const priceRange = priceMax - priceMin || 1;
    const stepX = w / (pricesArr.length - 1);
    ctx.strokeStyle = '#0ecb81';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pricesArr.forEach((v,i)=>{
        const x = i * stepX;
        const y = half - (((v-priceMin)/priceRange)*(half-1)) - 1;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();

    // объём (низ)
    const volMax = Math.max(...volumesArr) || 1;
    ctx.fillStyle = 'rgba(14,203,129,0.4)';
    volumesArr.forEach((v,i)=>{
        const x = i * stepX;
        const barH = (v/volMax)*(half-2);
        ctx.fillRect(x-1, half+1, 2, barH);
    });
}

/* --------------------------------------------------------------
   Полноразмерный график в модалке
-------------------------------------------------------------- */
function drawFull(canvas, pricesArr, volumesArr, title){
    const w = canvas.width  || 800;
    const h = canvas.height || 200;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,w,h);
    if(!pricesArr || pricesArr.length < 2){
        ctx.strokeStyle = '#555';
        ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
        return;
    }
    const priceMin = Math.min(...pricesArr);
    const priceMax = Math.max(...pricesArr);
    const priceRange = priceMax - priceMin || 1;
    const stepX = w / (pricesArr.length - 1);
    ctx.strokeStyle = '#0ecb81';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pricesArr.forEach((v,i)=>{
        const x = i * stepX;
        const y = h - (((v-priceMin)/priceRange)*(h-40)) - 20;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
    const volMax = Math.max(...volumesArr) || 1;
    ctx.fillStyle = 'rgba(14,203,129,0.3)';
    volumesArr.forEach((v,i)=>{
        const x = i * stepX;
        const barH = (v/volMax)*(h/2-20);
        ctx.fillRect(x-1, h/2+10, 2, barH);
    });
    ctx.fillStyle = 'var(--text)';
    ctx.font = '16px sans-serif';
    ctx.fillText(title, 10, 20);
}

/* --------------------------------------------------------------
   Сортировка
-------------------------------------------------------------- */
document.querySelectorAll('th.sortable').forEach(th=>{
    th.addEventListener('click',()=>{
        const col = th.getAttribute('data-sort');
        if(sort.column===col){
            sort.order = sort.order==='asc' ? 'desc' : 'asc';
        }else{
            sort.column = col;
            sort.order = 'desc';
        }
        document.querySelectorAll('th.sortable').forEach(x=>{
            x.classList.remove('active-sort');
            x.querySelector('.sort-icon').className = 'fa-solid fa-sort sort-icon';
        });
        th.classList.add('active-sort');
        const ic = th.querySelector('.sort-icon');
        ic.className = sort.order==='desc'
            ? 'fa-solid fa-sort-down sort-icon'
            : 'fa-solid fa-sort-up sort-icon';
        renderTable();
    });
});

/* --------------------------------------------------------------
   Поиск + тема + модалка
-------------------------------------------------------------- */
searchEl.addEventListener('input', renderTable);

document.getElementById('theme-toggle').addEventListener('click',()=>{
    document.body.classList.toggle('light-theme');
    const i = document.querySelector('#theme-toggle i');
    i.className = document.body.classList.contains('light-theme')
        ? 'fa-solid fa-sun'
        : 'fa-solid fa-moon';
});

modalSpan.onclick = ()=>{ modal.style.display = 'none'; };
window.onclick = e=>{ if(e.target===modal) modal.style.display = 'none'; };

/* --------------------------------------------------------------
   Рендер таблицы
-------------------------------------------------------------- */
function renderTable(){
    const syms = (data.symbols||[])
        .filter(s=>s.toUpperCase().includes(searchEl.value.toUpperCase()));

    syms.sort((a,b)=>{
        let va, vb;
        if(sort.column==='symbol'){
            return sort.order==='asc' ? a.localeCompare(b) : b.localeCompare(a);
        }
        if(sort.column==='price'){
            va = data.prices[a]||0; vb = data.prices[b]||0;
        }
        if(sort.column.startsWith('rsi_')){
            const tf = sort.column.replace('rsi_','');
            va = data.rsi[a]?.[tf] ?? (sort.order==='desc' ? -1 : 999);
            vb = data.rsi[b]?.[tf] ?? (sort.order==='desc' ? -1 : 999);
        }
        if(va<vb) return sort.order==='asc' ? -1 : 1;
        if(va>vb) return sort.order==='asc' ?  1 : -1;
        return 0;
    });

    if(!syms.length && (data.symbols||[]).length){
        tbody.innerHTML = `<tr><td colspan="11" class="loading-state">Ничего не найдено</td></tr>`;
        return;
    }

    let html = '';
    syms.forEach(sym=>{
        const base  = sym.replace('USDT','');
        const price = fmtPrice(data.prices[sym]);
        let cells = '';
        TF.forEach(tf=>{
            const rsi = data.rsi[sym]?.[tf];
            const hm  = rsiClass(rsi);
            const canvasId = `sp_${sym}_${tf}`;
            cells += `<td>
                <div class="hm-cell">
                    <div class="hm-value ${hm.cls} ${hm.zone}">${hm.txt}</div>
                    <canvas class="sparkline" id="${canvasId}" width="80" height="18"></canvas>
                </div>
            </td>`;
        });
        html += `<tr>
            <td class="sticky-col"><span class="symbol">${base}</span><span class="quote">USDT</span></td>
            <td class="price-col"><span class="price-col-value">$${price}</span></td>
            ${cells}
        </tr>`;
    });
    tbody.innerHTML = html;

    // мини‑чарты + клики + tooltip
    syms.forEach(sym=>{
        const base = sym.replace('USDT','');
        TF.forEach(tf=>{
            const canvas = document.getElementById(`sp_${sym}_${tf}`);
            if(!canvas) return;
            const pricesArr  = data.closes?.[sym]?.[tf] || [];
            const volumesArr = data.volumes?.[sym]?.[tf] || [];
            const lastRsi    = data.rsi[sym]?.[tf];

            drawMini(canvas, pricesArr, volumesArr);

            canvas.onclick = ()=>{
                const title = `${base}/USDT – ${tf}`;
                modalHead.textContent = title;
                drawFull(
                    modalChart,
                    pricesArr,
                    volumesArr,
                    title
                );
                modal.style.display = 'block';
            };

            canvas.onmousemove = (e)=>{
                const rsiText = (lastRsi!==undefined && !isNaN(lastRsi))
                    ? lastRsi.toFixed(1)
                    : '—';
                const html = `${base}/USDT · ${tf} · RSI: ${rsiText}`;
                showTooltip(e.clientX, e.clientY, html);
            };
            canvas.onmouseleave = ()=>{ hideTooltip(); };
        });
    });
}

