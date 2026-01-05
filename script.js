// --- CONFIGURAZIONE DIZIONARIO ---
const MORSE_MAP = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z', '-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','/':' '};
const REVERSE_MAP = Object.fromEntries(Object.entries(MORSE_MAP).map(([k,v]) => [v,k]));

// TEMPI: 400ms è lo standard "Safe" per evitare lag hardware
const UNIT = 400; 

// --- STATO ---
let audioCtx, activeStream, rxInterval;
let signalActive = false;
let lastTransition = 0;
let currentBuffer = "";
let isTransmitting = false;
let stopSignal = false;
let isFirstSignalDetected = false; // Fix per lo slash iniziale

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopReception(); stopTransmission();
}

// --- LOGICA DI RICEZIONE ---
function handleSignalChange(isOn) {
    const now = performance.now();
    
    // LOGICA "ANTI-SLASH" INIZIALE
    if (!isFirstSignalDetected) {
        if (isOn) {
            isFirstSignalDetected = true;
            signalActive = true;
            lastTransition = now;
            document.getElementById('signalIndicator').className = 'signal-active';
        }
        return; // Ignora tutto finché non arriva il primo segnale vero
    }

    if (isOn !== signalActive) {
        const duration = now - lastTransition;

        if (!isOn) { 
            // FINE IMPULSO (LUCE/SUONO -> BUIO/SILENZIO)
            if (duration > 60) { // Filtro anti-glitch
                // Finestra flessibile per il punto e la linea
                if (duration < UNIT * 1.8) {
                    currentBuffer += ".";
                    updateLiveMorse(".");
                } else {
                    currentBuffer += "-";
                    updateLiveMorse("-");
                }
            }
        } else {
            // FINE PAUSA (BUIO/SILENZIO -> LUCE/SUONO)
            // Se la pausa è > 2 unità, è una nuova lettera
            if (duration > UNIT * 1.5) { 
                decodeLetter();
                // Se la pausa è molto lunga (> 5 unità), è uno spazio parola
                if (duration > UNIT * 4.5) { 
                    document.getElementById('rxText').value += " ";
                    document.getElementById('rxMorse').value += " / ";
                } else {
                    document.getElementById('rxMorse').value += " ";
                }
            }
        }
        signalActive = isOn;
        lastTransition = now;
        document.getElementById('signalIndicator').className = isOn ? 'signal-active' : '';
    }
}

function updateLiveMorse(char) {
    const rxM = document.getElementById('rxMorse');
    rxM.value += char;
    rxM.scrollTop = rxM.scrollHeight;
}

function decodeLetter() {
    if (currentBuffer === "") return;
    const letter = MORSE_MAP[currentBuffer] || "?";
    const rxT = document.getElementById('rxText');
    rxT.value += letter;
    currentBuffer = "";
    rxT.scrollTop = rxT.scrollHeight;
}

// --- RICEZIONE VISIVA ---
async function startVideoRx() {
    stopReception();
    isFirstSignalDetected = false;
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: 640 }
        });
        const v = document.getElementById('videoElement');
        v.srcObject = activeStream;
        v.classList.add('active');
        document.querySelector('.target-box').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';

        const canvas = document.getElementById('canvasElement');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        let minB = 255, maxB = 0;

        rxInterval = setInterval(() => {
            if (v.readyState < 2) return;
            canvas.width = 40; canvas.height = 40;
            ctx.drawImage(v, v.videoWidth/2-20, v.videoHeight/2-20, 40, 40, 0, 0, 40, 40);
            const pixels = ctx.getImageData(0,0,40,40).data;
            let brightness = 0;
            for(let i=0; i<pixels.length; i+=4) brightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
            brightness /= (pixels.length/4);

            // Calibrazione dinamica ultra-veloce
            if (brightness < minB) minB = brightness;
            if (brightness > maxB) maxB = brightness;
            minB += 0.2; maxB -= 0.2; 

            const diff = maxB - minB;
            const threshold = minB + (diff * 0.65);
            const isOn = (diff > 15) && (brightness > threshold);
            
            const level = diff > 0 ? ((brightness - minB) / diff) * 100 : 0;
            document.getElementById('signalLevelBar').style.width = level + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";

            handleSignalChange(isOn);
        }, 40);
    } catch(e) { alert("Camera Error"); }
}

// --- RICEZIONE AUDIO ---
async function startAudioRx() {
    stopReception();
    isFirstSignalDetected = false;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();

    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 512;
        source.connect(analyzer);

        const buffer = new Uint8Array(analyzer.frequencyBinCount);
        let minVol = 255, maxVol = 0;

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(buffer);
            let currentVol = 0;
            // Range frequenza beep (600-900Hz)
            for(let i=10; i<25; i++) if(buffer[i] > currentVol) currentVol = buffer[i];

            if (currentVol < minVol) minVol = currentVol;
            if (currentVol > maxVol) maxVol = currentVol;
            minVol += 0.5; maxVol -= 0.5;

            const diff = maxVol - minVol;
            const threshold = minVol + (diff * 0.5);
            const isOn = (diff > 40) && (currentVol > threshold);

            document.getElementById('signalLevelBar').style.width = (currentVol/255*100) + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";
            
            handleSignalChange(isOn);
        }, 40);
    } catch(e) { alert("Mic Error"); }
}

// --- TRASMISSIONE MIGLIORATA (FIX PRIMO PUNTO) ---
async function startTx(type) {
    if (isTransmitting) return;
    const text = document.getElementById('outputMorse').value;
    if (!text) return;

    isTransmitting = true; stopSignal = false;
    const btn = document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch');
    btn.classList.add('active-tx');

    let track = null;
    let stream = null;

    // 1. INIZIALIZZAZIONE HARDWARE
    if (type === 'torch') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
            track = stream.getVideoTracks()[0];
        } catch(e) { stopTransmission(); return; }
    } else {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume();
    }

    // 2. WARM-UP (500ms di attesa prima del primo segnale)
    await new Promise(r => setTimeout(r, 500));

    const play = async (d) => {
        if (type === 'sound') {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.frequency.value = 800; // Tono più squillante
            g.gain.setValueAtTime(0, audioCtx.currentTime);
            g.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02);
            o.start();
            await new Promise(r => setTimeout(r, d));
            g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.02);
            o.stop(audioCtx.currentTime + 0.05);
        } else if (track) {
            try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
            await new Promise(r => setTimeout(r, d));
            try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
        }
    };

    // 3. CICLO DI TRASMISSIONE
    do {
        for (let c of text) {
            if (stopSignal) break;
            if (c === '.') { await play(UNIT); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === '-') { await play(UNIT*3); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === ' ') { await new Promise(r => setTimeout(r, UNIT*2)); }
            else if (c === '/') { await new Promise(r => setTimeout(r, UNIT*5)); }
        }
        await new Promise(r => setTimeout(r, UNIT * 10)); // Pausa lunga tra i loop
    } while (isLooping && !stopSignal);

    if (track) { track.stop(); if(stream) stream.getTracks().forEach(t => t.stop()); }
    stopTransmission();
}

function stopTransmission() {
    stopSignal = true; isTransmitting = false;
    document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active-tx'));
}

function stopReception() {
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
    clearInterval(rxInterval);
    decodeLetter();
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalIndicator').className = '';
    document.getElementById('signalLevelBar').style.width = "0%";
}

// --- EVENTI ---
document.getElementById('btnConvert').onclick = () => {
    const val = document.getElementById('inputText').value.toUpperCase();
    document.getElementById('outputMorse').value = val.split('').map(c => {
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
    currentBuffer = "";
};
document.getElementById('btnLoop').onclick = () => {
    isLooping = !isLooping;
    document.getElementById('btnLoop').innerHTML = isLooping ? "Loop ON" : "Loop OFF";
};