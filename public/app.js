const $ = id => document.getElementById(id);
const TOTAL_AGENTS = 10;
let cameraStream = null;
let selectedAgent = null;

function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
    window.scrollTo(0, 0);
}

function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}

// Paso 1: términos
$('termsCheckbox').addEventListener('change', e => { $('btnStart').disabled = !e.target.checked; });
$('btnStart').addEventListener('click', () => show('s-agent'));
$('openTerms').addEventListener('click', e => { e.preventDefault(); $('termsModal').classList.add('open'); });
$('closeTerms').addEventListener('click', () => $('termsModal').classList.remove('open'));

// Paso 2: agentes
const grid = $('agents');
for (let i = 1; i <= TOTAL_AGENTS; i++) {
    const d = document.createElement('div');
    d.className = 'agent';
    d.innerHTML = `<img src="agents/thumb-${i}.jpg" alt="Agente ${i}">`;
    d.addEventListener('click', () => {
        document.querySelectorAll('.agent').forEach(a => a.classList.remove('selected'));
        d.classList.add('selected');
        selectedAgent = i;
        $('btnAgentNext').disabled = false;
    });
    grid.appendChild(d);
}
$('btnAgentNext').addEventListener('click', () => { show('s-photo'); });
$('btnBackAgent').addEventListener('click', () => show('s-agent'));

// Paso 3: foto
function checkFormValid() {
    $('generateBtn').disabled = !($('imagePreview').src || '').startsWith('data:image');
}
function setPreview(src) {
    $('imagePreview').src = src;
    $('previewContainer').style.display = src ? 'inline-block' : 'none';
    checkFormValid();
}
$('removeBtn').addEventListener('click', () => { setPreview(''); $('fileInput').value = ''; });
$('uploadBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => setPreview(ev.target.result);
    r.readAsDataURL(f);
});

$('cameraBtn').addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Tu navegador no permite acceso a la cámara (usa HTTPS o localhost).');
        return;
    }
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        $('cameraVideo').srcObject = cameraStream;
        $('cameraModal').classList.add('open');
    } catch (err) {
        let msg = 'No se pudo acceder a la cámara.';
        if (err.name === 'NotFoundError') msg = 'No se detectó ninguna cámara.';
        else if (err.name === 'NotAllowedError') msg = 'Permiso de cámara denegado.';
        else if (err.name === 'NotReadableError') msg = 'La cámara está siendo usada por otra aplicación.';
        showToast(msg);
    }
});

function closeCamera() {
    $('cameraModal').classList.remove('open');
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}
$('closeCameraBtn').addEventListener('click', closeCamera);

$('captureBtn').addEventListener('click', () => {
    let count = 3;
    const el = $('countdown');
    $('captureBtn').disabled = true;
    el.style.display = 'block';
    el.textContent = count;
    const timer = setInterval(() => {
        count--;
        if (count > 0) { el.textContent = count; return; }
        clearInterval(timer);
        el.style.display = 'none';
        $('captureBtn').disabled = false;
        const v = $('cameraVideo');
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        ctx.translate(c.width, 0); ctx.scale(-1, 1); // quitar efecto espejo del preview
        ctx.drawImage(v, 0, 0);
        setPreview(c.toDataURL('image/jpeg', 0.92));
        closeCamera();
    }, 1000);
});

function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    const u8 = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    return new File([u8], filename, { type: mime });
}

// Generar
$('generateBtn').addEventListener('click', async () => {
    if (!selectedAgent) { showToast('Elige un agente'); show('s-agent'); return; }
    $('loading').style.display = 'flex';
    try {
        const fd = new FormData();
        fd.append('image', dataURLtoFile($('imagePreview').src, 'foto.jpg'));
        fd.append('agent', selectedAgent);
        const res = await fetch('/api/generate', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al generar la imagen');

        $('resultImage').src = data.image;
        $('qrImg').src = data.qrCode;
        window.lastDownloadUrl = data.downloadUrl;
        show('s-result');
        if (window.confetti) {
            confetti({ particleCount: 120, spread: 80, origin: { y: .6 }, colors: ['#6161ff', '#00ca72', '#ffcb00', '#fb275d', '#ffffff'] });
        }
    } catch (e) {
        showToast(e.message || 'Error al generar la imagen');
    } finally {
        $('loading').style.display = 'none';
    }
});

// Resultado
$('downloadBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = $('resultImage').src;
    a.download = `HumanAgentPortrait_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
});
$('newBtn').addEventListener('click', () => {
    selectedAgent = null;
    document.querySelectorAll('.agent').forEach(a => a.classList.remove('selected'));
    $('btnAgentNext').disabled = true;
    setPreview('');
    $('fileInput').value = '';
    $('termsCheckbox').checked = false;
    $('btnStart').disabled = true;
    show('s-welcome');
});

// Aviso si falta la API key
fetch('/api/health').then(r => r.json()).then(d => {
    if (!d.hasApiKey) showToast('⚠️ Configura GOOGLE_API_KEY en el archivo .env');
}).catch(() => {});
