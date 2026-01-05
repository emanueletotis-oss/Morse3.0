// --- DIZIONARIO ---
const MORSE_CODE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '0': '-----', ' ': '/'
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_CODE).map(([k, v]) => [v, k]));

// COSTANTI DI TEMPO (Flessibili)
let UNIT_TIME = 200; // Tempo base di riferimento (ms)

// --- ELEMENTI DOM ---
const outputMorse = document.getElementById('outputMorse');
const rxMorse = document.getElementById('rxMorse');
const rxText = document.getElementById('rxText');
const signalLevelBar = document.getElementById('signalLevelBar');
const levelLabel = document.getElementById('levelLabel');

// --- STATO ---
let isLooping = false;
let isTransmitting = false;
let stopSignal = false;
let audioCtx = null;
let activeStream = null;
let rxInterval = null;

// Stato Ricezione
let lastTransitionTime = performance.now();
let signalActive = false;
let currentMorseBuffer = ""; 

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopTransmission();
    stopReception();
}

// --- TRASMISSIONE (Invariata) ---
document.getElementById('btnConvert').addEventListener('click', () => {
    const text = document.getElementById('inputText').value.trim();
    if(!text) return;
    outputMorse.value = text.toUpperCase().split('').map(c => MORSE_CODE[c] || '').join(' ');
});

document.getElementById('inputMorseManual').addEventListener('input', (e) => {
    const morse = e.target.value.trim();
    document.getElementById('outputTranslatedText').value = morse.split(' ').map(c => REVERSE_MORSE[c] || '').join('');
});

document.getElementById('btnCopy').addEventListener('click', () => {
    outputMorse.select(); document.execCommand('copy');
});

document.getElementById('btnClearRx').addEventListener('click', () => {
    rxMorse.value = ""; rxText.value = ""; currentMorseBuffer = "";
});

function unlockAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

async function playBeep(duration) {
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = 650; osc.type = 'sine';
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.01);
    gain.gain.setValueAtTime(1, now + (duration/1000) - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + (duration/1000));
    osc.start(now); osc.stop(now + (duration/1000));
    return new Promise(r => setTimeout(r, duration));
}

async function setTorch(on, track) {
    if (track) try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch(e){}
}

async function startTx(type) {
    if (type === 'sound') unlockAudio();
    if (isTransmitting) return;
    const code = outputMorse.value;
    if (!code) return;
    const btn = document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch');
    btn.classList.add('active-tx');
    isTransmitting = true; stopSignal = false;
    let track = null; let stream = null;
    if (type === 'torch') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            track = stream.getVideoTracks()[0];
        } catch(e) { alert("Torcia non disponibile"); stopTransmission(); return; }
    }
    do {
        for (let char of code) {
            if (stopSignal) break;
            let dur = (char === '.') ? UNIT_TIME : (char === '-') ? UNIT_TIME * 3 : 0;
            if (dur > 0) {
                if (type === 'sound') await playBeep(dur);
                if (type === 'torch') { setTorch(true, track); await sleep(dur); setTorch(false, track); }
                await sleep(UNIT_TIME); 
            } else if (char === ' ') await sleep(UNIT_TIME * 3);
            else if (char === '/') await sleep(UNIT_TIME * 7);
        }
        await sleep(UNIT_TIME * 5);
    } while (isLooping && !stopSignal);
    if(track) stream.getTracks().forEach(t => t.stop());
    stopTransmission();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function stopTransmission() {
    stopSignal = true; isTransmitting = false; isLooping = false;
    document.getElementById('btnSound').classList.remove('active-tx');
    document.getElementById('btnTorch').classList.remove('active-tx');
    updateLoopUI();
}
document.getElementById('btnSound').addEventListener('click', () => { stopSignal = true; setTimeout(() => startTx('sound'), 100); });
document.getElementById('btnTorch').addEventListener('click', () => { stopSignal = true; setTimeout(() => startTx('torch'), 100); });
document.getElementById('btnStop').addEventListener('click', stopTransmission);
document.getElementById('btnLoop').addEventListener('click', () => { isLooping = !isLooping; updateLoopUI(); });
function updateLoopUI() {
    const btn = document.getElementById('btnLoop');
    btn.innerHTML = isLooping ? "Loop ON &#10004;" : "Loop &#8635;";
    btn.className = `action-btn small-btn ${isLooping ? 'loop-on' : 'loop-off'}`;
}

// --- NUOVA LOGICA DI RICEZIONE AUTO-ADATTIVA ---

function processInput(isOn) {
    const now = performance.now();
    const duration = now - lastTransitionTime;
    const indicator = document.getElementById('signalIndicator');

    if (isOn) indicator.classList.add('signal-active');
    else indicator.classList.remove('signal-active');

    // Cambiamento di stato (da acceso a spento o viceversa)
    if (isOn !== signalActive) {
        
        if (!isOn) { 
            // FINE SEGNALE (abbiamo misurato la durata della luce/suono)
            if (duration > 40) { // Filtro anti-glitch
                if (duration < UNIT_TIME * 2.2) {
                    currentMorseBuffer += ".";
                    rxMorse.value += ".";
                } else {
                    currentMorseBuffer += "-";
                    rxMorse.value += "-";
                }
            }
        } else {
            // INIZIO SEGNALE (abbiamo misurato la durata del silenzio precedente)
            if (duration > UNIT_TIME * 6) { 
                decodeBuffer();
                rxMorse.value += " / ";
                rxText.value += " ";
            } else if (duration > UNIT_TIME * 2) {
                decodeBuffer();
                rxMorse.value += " ";
            }
        }
        
        signalActive = isOn;
        lastTransitionTime = now;
    }
}

function decodeBuffer() {
    if (currentMorseBuffer === "") return;
    const char = REVERSE_MORSE[currentMorseBuffer] || "?";
    rxText.value += char;
    currentMorseBuffer = "";
    // Scroll automatico per vedere l'ultima lettera
    rxText.scrollTop = rxText.scrollHeight;
    rxMorse.scrollTop = rxMorse.scrollHeight;
}

// 1. RICEZIONE VIDEO (Analisi del solo quadratino rosso)
async function startVideoRx() {
    stopReception();
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: 640, height: 480 } 
        });
        const vid = document.getElementById('videoElement');
        vid.srcObject = activeStream;
        vid.classList.add('active');
        document.querySelector('.target-box').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';

        const canvas = document.getElementById('canvasElement');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        let rollingAvg = 128; // Media luminosa iniziale

        rxInterval = setInterval(() => {
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
                // Analizziamo solo l'area centrale (corrispondente alla target-box)
                canvas.width = 50; canvas.height = 50;
                
                // Ritaglio centrale del 15% del video
                const cropSize = vid.videoHeight * 0.15;
                const sx = (vid.videoWidth - cropSize) / 2;
                const sy = (vid.videoHeight - cropSize) / 2;
                
                ctx.drawImage(vid, sx, sy, cropSize, cropSize, 0, 0, 50, 50);
                
                const frame = ctx.getImageData(0, 0, 50, 50);
                let currentBrightness = 0;
                for(let i=0; i<frame.data.length; i+=4) {
                    // Formula luminanza corretta
                    currentBrightness += (frame.data[i] * 0.299 + frame.data[i+1] * 0.587 + frame.data[i+2] * 0.114);
                }
                currentBrightness /= (frame.data.length / 4);

                // Hysteresis dinamica per adattarsi a luci diverse
                const threshold = rollingAvg + 40; 
                const isBright = currentBrightness > threshold;

                // Aggiornamento media lenta (per adattarsi a cambiamenti di luce ambientale)
                rollingAvg = (rollingAvg * 0.98) + (currentBrightness * 0.02);

                // UI Feedback
                const signalPower = Math.min(100, Math.max(0, (currentBrightness - rollingAvg) * 2));
                signalLevelBar.style.width = signalPower + '%';
                signalLevelBar.style.backgroundColor = isBright ? 'lime' : '#444';

                processInput(isBright);
            }
        }, 40); // 25 campioni al secondo

    } catch(e) { alert("Errore camera: " + e); }
}

// 2. RICEZIONE AUDIO (Filtraggio frequenza)
async function startAudioRx() {
    stopReception();
    try {
        unlockAudio();
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 1024;
        source.connect(analyzer);
        
        const data = new Uint8Array(analyzer.frequencyBinCount);
        const binSize = audioCtx.sampleRate / analyzer.fftSize;
        
        // Cerchiamo il picco tra 500Hz e 900Hz (range tipico dei segnali SOS)
        const minBin = Math.floor(500 / binSize);
        const maxBin = Math.ceil(900 / binSize);

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(data);
            let volume = 0;
            for(let i = minBin; i <= maxBin; i++) {
                if(data[i] > volume) volume = data[i];
            }
            
            const isTone = volume > 110; // Soglia sensibilità mic
            
            signalLevelBar.style.width = (volume / 255 * 100) + '%';
            signalLevelBar.style.backgroundColor = isTone ? 'lime' : '#444';

            processInput(isTone);
        }, 40);

    } catch(e) { alert("Errore microfono: " + e); }
}

function stopReception() {
    if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
        activeStream = null;
    }
    if (rxInterval) clearInterval(rxInterval);
    decodeBuffer(); // Forza traduzione dell'ultimo carattere
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalIndicator').classList.remove('signal-active');
    signalLevelBar.style.width = '0%';
}

document.getElementById('btnRxCamera').addEventListener('click', startVideoRx);
document.getElementById('btnRxAudio').addEventListener('click', startAudioRx);
document.getElementById('btnRxStop').addEventListener('click', stopReception);