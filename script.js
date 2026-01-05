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

// TEMPISTICHE (Base 250ms come da tua impostazione)
const UNIT_TIME = 250; 

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

// Variabili per la decodifica
let lastTransitionTime = Date.now();
let signalState = false; 
let currentSymbol = ""; 

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopTransmission();
    stopReception();
}

// --- CONVERSIONE TESTO -> MORSE ---
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
    rxMorse.value = "";
    rxText.value = "";
    currentSymbol = "";
});

// --- HELPER AUDIO ---
function unlockAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// --- TRASMISSIONE ---
async function playBeep(duration) {
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 600; 
    osc.type = 'sine';
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.01);
    gain.gain.setValueAtTime(1, now + (duration/1000) - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + (duration/1000));
    osc.start(now);
    osc.stop(now + (duration/1000));
    return new Promise(r => setTimeout(r, duration));
}

async function setTorch(on, track) {
    if (track) {
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch(e){}
    }
}

async function startTx(type) {
    if (type === 'sound') unlockAudio();
    if (isTransmitting) return;
    const code = outputMorse.value;
    if (!code) return;
    const btn = document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch');
    btn.classList.add('active-tx');
    isTransmitting = true;
    stopSignal = false;
    let track = null;
    let stream = null;
    if (type === 'torch') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            track = stream.getVideoTracks()[0];
        } catch(e) {
            alert("Torcia non supportata.");
            stopTransmission();
            return;
        }
    }
    do {
        for (let char of code) {
            if (stopSignal) break;
            let dur = 0;
            if (char === '.') dur = UNIT_TIME;
            else if (char === '-') dur = UNIT_TIME * 3;
            else if (char === ' ') { await sleep(UNIT_TIME * 3); continue; }
            else if (char === '/') { await sleep(UNIT_TIME * 7); continue; }
            if (dur > 0) {
                if (type === 'sound') await playBeep(dur);
                if (type === 'torch') { setTorch(true, track); await sleep(dur); setTorch(false, track); }
                await sleep(UNIT_TIME);
            }
        }
        await sleep(UNIT_TIME * 4); 
    } while (isLooping && !stopSignal);
    if(track) stream.getTracks().forEach(t => t.stop());
    stopTransmission();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stopTransmission() {
    stopSignal = true;
    isTransmitting = false;
    isLooping = false;
    updateLoopUI();
    document.getElementById('btnSound').classList.remove('active-tx');
    document.getElementById('btnTorch').classList.remove('active-tx');
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

// --- LOGICA DI RICEZIONE MIGLIORATA ---

function processInput(isOn) {
    const now = Date.now();
    const duration = now - lastTransitionTime;
    const indicator = document.getElementById('signalIndicator');
    
    if (isOn) indicator.classList.add('signal-active');
    else indicator.classList.remove('signal-active');

    // Transizione: SEGNALE CAMBIATO (da OFF a ON o viceversa)
    if (isOn !== signalState) {
        
        if (!isOn) { 
            // Fine di un impulso (abbiamo appena spento la luce/suono)
            // Determiniamo se era un PUNTO o una LINEA
            if (duration > 50) { // Filtro anti-rumore (ignora impulsi troppo brevi)
                if (duration < UNIT_TIME * 1.8) {
                    currentSymbol += ".";
                    rxMorse.value += ".";
                } else {
                    currentSymbol += "-";
                    rxMorse.value += "-";
                }
            }
        } else {
            // Inizio di un nuovo impulso (c'era silenzio prima)
            // Determiniamo se il silenzio era uno spazio tra lettere o parole
            if (duration > UNIT_TIME * 5) { // Spazio tra parole
                decodeCurrentSymbol();
                rxMorse.value += " / ";
                rxText.value += " ";
            } else if (duration > UNIT_TIME * 2) { // Spazio tra lettere
                decodeCurrentSymbol();
                rxMorse.value += " ";
            }
        }
        
        signalState = isOn;
        lastTransitionTime = now;
    }
}

// Funzione per tradurre il simbolo accumulato (es. ".-") in lettera ("A")
function decodeCurrentSymbol() {
    if (currentSymbol === "") return;
    const letter = REVERSE_MORSE[currentSymbol] || "?";
    rxText.value += letter;
    currentSymbol = "";
}

// 1. RICEZIONE VIDEO CON FOCUS SUL TARGET
async function startVideoRx() {
    stopReception();
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } 
        });
        const vid = document.getElementById('videoElement');
        vid.srcObject = activeStream;
        vid.classList.add('active');
        document.querySelector('.target-box').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';

        const canvas = document.getElementById('canvasElement');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        let avgBright = 0;

        rxInterval = setInterval(() => {
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
                // Disegniamo una porzione ridotta del video sul canvas per analisi
                canvas.width = 100; canvas.height = 100;
                
                // Ritagliamo il centro del video (dove c'è il quadratino rosso)
                const sourceSize = Math.min(vid.videoWidth, vid.videoHeight) * 0.2; // Prendi il 20% centrale
                const sx = (vid.videoWidth - sourceSize) / 2;
                const sy = (vid.videoHeight - sourceSize) / 2;
                
                ctx.drawImage(vid, sx, sy, sourceSize, sourceSize, 0, 0, 100, 100);
                
                const frame = ctx.getImageData(0, 0, 100, 100);
                let totalBright = 0;
                for(let i=0; i<frame.data.length; i+=4) {
                    totalBright += (frame.data[i] + frame.data[i+1] + frame.data[i+2]) / 3;
                }
                const currentBright = totalBright / (frame.data.length / 4);

                // Auto-calibrazione soglia
                if (avgBright === 0) avgBright = currentBright;
                avgBright = (avgBright * 0.9) + (currentBright * 0.1);

                // Il segnale è ON se la luminosità attuale supera la media di una soglia fissa
                const isBright = currentBright > (avgBright + 30);
                
                // Update UI barra
                const diff = Math.max(0, currentBright - avgBright);
                signalLevelBar.style.width = Math.min(100, diff * 2) + '%';
                signalLevelBar.style.backgroundColor = isBright ? 'lime' : 'gray';

                processInput(isBright);
            }
        }, 50); // 20 fps per l'analisi

    } catch(e) { alert("Camera error: " + e); }
}

// 2. RICEZIONE AUDIO MIGLIORATA
async function startAudioRx() {
    stopReception();
    try {
        unlockAudio();
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 512;
        source.connect(analyzer);
        
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        const hzPerBin = audioCtx.sampleRate / analyzer.fftSize;
        
        // Cerchiamo in un range più ampio (400Hz - 1000Hz)
        const lowBin = Math.floor(400 / hzPerBin);
        const highBin = Math.ceil(1000 / hzPerBin);

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(dataArray);
            let maxVol = 0;
            for(let i = lowBin; i <= highBin; i++) {
                if(dataArray[i] > maxVol) maxVol = dataArray[i];
            }
            
            // Soglia volume (regolabile se l'ambiente è rumoroso)
            const isTone = maxVol > 100;
            
            signalLevelBar.style.width = (maxVol / 255 * 100) + '%';
            signalLevelBar.style.backgroundColor = isTone ? 'lime' : 'gray';

            processInput(isTone);
        }, 50);

    } catch(e) { alert("Mic error: " + e); }
}

function stopReception() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }
    if (rxInterval) clearInterval(rxInterval);
    
    // Decodifica l'ultimo simbolo se rimasto in sospeso
    decodeCurrentSymbol();
    
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalIndicator').classList.remove('signal-active');
    signalLevelBar.style.width = '0%';
}

document.getElementById('btnRxCamera').addEventListener('click', startVideoRx);
document.getElementById('btnRxAudio').addEventListener('click', startAudioRx);
document.getElementById('btnRxStop').addEventListener('click', stopReception);