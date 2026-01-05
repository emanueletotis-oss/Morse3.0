// --- CONFIGURAZIONE E DIZIONARIO ---
const MORSE_MAP = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z', '-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','/':' '};

// --- VARIABILI DI STATO ---
let audioCtx, activeStream, rxInterval;
let isTransmitting = false, isLooping = false, stopSignal = false;

// Logica di ricezione
let lastState = false;
let lastTransitionTime = performance.now();
let currentSymbol = "";
let minBrightness = 255, maxBrightness = 0;
let history = []; // Per la media mobile della luminosità

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopReception(); stopTransmission();
}

// --- TRASMISSIONE (Semplificata e robusta) ---
async function startTx(type) {
    if (isTransmitting) return;
    if (type === 'sound') { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); }
    
    const code = document.getElementById('outputMorse').value;
    if (!code) return;

    isTransmitting = true; stopSignal = false;
    const btn = document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch');
    btn.classList.add('active-tx');

    let track = null;
    if (type === 'torch') {
        try {
            const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
            track = s.getVideoTracks()[0];
        } catch(e) { alert("Torcia non disponibile"); stopTransmission(); return; }
    }

    const unit = 200; // ms base
    do {
        for (let char of code) {
            if (stopSignal) break;
            let d = char === '.' ? unit : char === '-' ? unit * 3 : 0;
            if (d > 0) {
                if (type === 'sound') playTone(d);
                if (track) track.applyConstraints({advanced: [{torch: true}]});
                await new Promise(r => setTimeout(r, d));
                if (track) track.applyConstraints({advanced: [{torch: false}]});
                await new Promise(r => setTimeout(r, unit));
            } else if (char === ' ') await new Promise(r => setTimeout(r, unit * 3));
            else if (char === '/') await new Promise(r => setTimeout(r, unit * 7));
        }
        await new Promise(r => setTimeout(r, unit * 10));
    } while (isLooping && !stopSignal);

    if (track) track.stop();
    stopTransmission();
}

function playTone(d) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(audioCtx.destination);
    osc.frequency.value = 600;
    g.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01);
    g.gain.setTargetAtTime(0, audioCtx.currentTime + d/1000 - 0.01, 0.01);
    osc.start(); osc.stop(audioCtx.currentTime + d/1000);
}

function stopTransmission() {
    stopSignal = true; isTransmitting = false;
    document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active-tx'));
}

// --- CORE RICEZIONE: IL MOTORE DI DECODIFICA ---
function handleSignal(isOn) {
    const now = performance.now();
    const duration = now - lastTransitionTime;
    const indicator = document.getElementById('signalIndicator');

    if (isOn !== lastState) {
        if (isOn) { 
            // Inizio segnale (Luce accesa): analizziamo la durata del SILENZIO
            if (duration > 400 && duration < 1200) { // Spazio tra lettere
                decodeSymbol();
                document.getElementById('rxMorse').value += " ";
            } else if (duration >= 1200) { // Spazio tra parole
                decodeSymbol();
                document.getElementById('rxMorse').value += " / ";
                document.getElementById('rxText').value += " ";
            }
        } else {
            // Fine segnale (Luce spenta): analizziamo la durata del SEGNALE
            if (duration > 50) { // Filtro anti-rumore
                const type = (duration < 350) ? "." : "-";
                currentSymbol += type;
                document.getElementById('rxMorse').value += type;
            }
        }
        lastState = isOn;
        lastTransitionTime = now;
        indicator.className = isOn ? 'signal-active' : '';
    }
}

function decodeSymbol() {
    if (currentSymbol === "") return;
    const txt = MORSE_MAP[currentSymbol] || "?";
    document.getElementById('rxText').value += txt;
    currentSymbol = "";
    // Auto-scroll
    document.getElementById('rxText').scrollTop = document.getElementById('rxText').scrollHeight;
}

// --- RICEZIONE VISIVA (Soglia Adattiva) ---
async function startVideoRx() {
    stopReception();
    activeStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment', width: 640}});
    const v = document.getElementById('videoElement');
    v.srcObject = activeStream; v.play();
    v.classList.add('active');
    document.querySelector('.target-box').style.display = 'block';
    document.getElementById('camPlaceholder').style.display = 'none';

    const canvas = document.getElementById('canvasElement');
    const ctx = canvas.getContext('2d', {willReadFrequently: true});

    rxInterval = setInterval(() => {
        if (v.readyState < 2) return;
        canvas.width = 40; canvas.height = 40;
        // Campioniamo solo il centro (quadrato rosso)
        ctx.drawImage(v, v.videoWidth/2-20, v.videoHeight/2-20, 40, 40, 0, 0, 40, 40);
        const data = ctx.getImageData(0,0,40,40).data;
        
        let brightness = 0;
        for(let i=0; i<data.length; i+=4) brightness += (data[i]+data[i+1]+data[i+2])/3;
        brightness /= (data.length/4);

        // DINAMICA: Aggiorna min/max in tempo reale
        if (brightness < minBrightness) minBrightness = brightness;
        if (brightness > maxBrightness) maxBrightness = brightness;
        
        // Decadimento lento dei valori estremi per adattarsi a nuove scene
        minBrightness += 0.1; maxBrightness -= 0.1;

        const range = maxBrightness - minBrightness;
        const threshold = minBrightness + (range * 0.5); // Soglia al 50% del range rilevato

        // Segnale ON se luminosità > soglia E il range è significativo (> 20 punti)
        const isOn = (range > 20) && (brightness > threshold);
        
        // UI
        const percent = range > 0 ? ((brightness - minBrightness) / range) * 100 : 0;
        document.getElementById('signalLevelBar').style.width = percent + "%";
        document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";

        handleSignal(isOn);
    }, 40);
}

// --- RICEZIONE AUDIO (Analisi Picco) ---
async function startAudioRx() {
    stopReception();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    
    activeStream = await navigator.mediaDevices.getUserMedia({audio: true});
    const src = audioCtx.createMediaStreamSource(activeStream);
    const analyzer = audioCtx.createAnalyser();
    analyzer.fftSize = 512;
    src.connect(analyzer);
    
    const buffer = new Uint8Array(analyzer.frequencyBinCount);
    rxInterval = setInterval(() => {
        analyzer.getByteFrequencyData(buffer);
        // Cerchiamo il volume massimo nel range umano (300-1200Hz)
        let maxVol = 0;
        for(let i=6; i<30; i++) if(buffer[i] > maxVol) maxVol = buffer[i];

        const isOn = maxVol > 110; // Soglia fissa per audio (più stabile della luce)
        
        document.getElementById('signalLevelBar').style.width = (maxVol/255*100) + "%";
        document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";
        
        handleSignal(isOn);
    }, 40);
}

function stopReception() {
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
    clearInterval(rxInterval);
    decodeSymbol();
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalLevelBar').style.width = "0%";
}

// Event Listeners
document.getElementById('btnConvert').onclick = () => {
    const t = document.getElementById('inputText').value.toUpperCase();
    document.getElementById('outputMorse').value = t.split('').map(c => {
        for(let k in MORSE_MAP) if(MORSE_MAP[k] === c) return k;
        return c === ' ' ? '/' : '';
    }).join(' ');
};
document.getElementById('btnRxCamera').onclick = startVideoRx;
document.getElementById('btnRxAudio').onclick = startAudioRx;
document.getElementById('btnRxStop').onclick = stopReception;
document.getElementById('btnClearRx').onclick = () => {
    document.getElementById('rxMorse').value = "";
    document.getElementById('rxText').value = "";
};
document.getElementById('btnCopy').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('outputMorse').value);
};
document.getElementById('btnLoop').onclick = () => {
    isLooping = !isLooping;
    document.getElementById('btnLoop').innerHTML = isLooping ? "Loop ON" : "Loop OFF";
};