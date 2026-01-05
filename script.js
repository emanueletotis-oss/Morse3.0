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

// TEMPISTICHE RALLENTATE
// 250ms è il "compromesso d'oro" per le web-cam dei telefoni che spesso vanno a 30fps
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

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    
    // Reset completo quando si cambia pagina
    stopTransmission();
    stopReception();
}

// --- CONVERSIONE ---
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
});

// --- HELPER AUDIO ---
// Questa funzione DEVE essere chiamata dentro un evento click
function unlockAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
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
    
    // Rampe per evitare il "click" sgradevole inizio/fine
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

// Funzione principale di trasmissione
async function startTx(type) {
    // 1. SBLOCCO AUDIO IMMEDIATO (Cruciale per iOS)
    if (type === 'sound') unlockAudio();
    
    if (isTransmitting) return;
    const code = outputMorse.value;
    if (!code) return;

    // UI
    const btn = document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch');
    btn.classList.add('active-tx');

    isTransmitting = true;
    stopSignal = false;
    
    let track = null;
    let stream = null;

    // Setup Torcia
    if (type === 'torch') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            track = stream.getVideoTracks()[0];
            // Test preliminare
            await setTorch(true, track);
            await sleep(100);
            await setTorch(false, track);
        } catch(e) {
            alert("Torcia non accessibile o non supportata in questo browser.");
            stopTransmission();
            return;
        }
    }

    // Loop Trasmissione
    do {
        for (let char of code) {
            if (stopSignal) break;
            
            // Unità di tempo rallentata per favorire la ricezione
            let dur = 0;
            if (char === '.') dur = UNIT_TIME;
            else if (char === '-') dur = UNIT_TIME * 3;
            else if (char === ' ') { await sleep(UNIT_TIME * 3); continue; }
            else if (char === '/') { await sleep(UNIT_TIME * 7); continue; }
            
            if (dur > 0) {
                if (type === 'sound') await playBeep(dur);
                if (type === 'torch') { 
                    setTorch(true, track); 
                    await sleep(dur); 
                    setTorch(false, track); 
                }
                
                // Pausa tra simboli
                await sleep(UNIT_TIME);
            }
        }
        await sleep(UNIT_TIME * 7); 
    } while (isLooping && !stopSignal);

    // Pulizia
    if(track) {
        track.stop();
        stream.getTracks().forEach(t => t.stop());
    }
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

// Handler Click Trasmissione
document.getElementById('btnSound').addEventListener('click', () => { 
    stopSignal = true; 
    setTimeout(() => startTx('sound'), 100); 
});
document.getElementById('btnTorch').addEventListener('click', () => { 
    stopSignal = true; 
    setTimeout(() => startTx('torch'), 100); 
});
document.getElementById('btnStop').addEventListener('click', stopTransmission);

document.getElementById('btnLoop').addEventListener('click', () => {
    isLooping = !isLooping;
    updateLoopUI();
});

function updateLoopUI() {
    const btn = document.getElementById('btnLoop');
    if (isLooping) {
        btn.classList.remove('loop-off');
        btn.classList.add('loop-on');
        btn.innerHTML = "Loop ON &#10004;";
    } else {
        btn.classList.remove('loop-on');
        btn.classList.add('loop-off');
        btn.innerHTML = "Loop &#8635;";
    }
}


// --- RICEZIONE (LOGICA RIFATTA) ---

let lastSignalTime = 0;
let signalState = false; 
let currentSymbol = ""; 

function processInput(isOn) {
    const now = Date.now();
    const indicator = document.getElementById('signalIndicator');
    
    // Aggiorna indicatore visivo
    if(isOn) indicator.classList.add('signal-active');
    else indicator.classList.remove('signal-active');

    // Transizione OFF -> ON (Inizio segnale)
    if (isOn && !signalState) {
        const delta = now - lastSignalTime;
        
        // Interpreta il silenzio precedente
        // > 6 unità = Spazio parola
        // > 2 unità = Spazio lettera
        if (delta > UNIT_TIME * 5) {
            rxMorse.value += " / ";
            rxText.value += " ";
        } else if (delta > UNIT_TIME * 2.2) {
            if (currentSymbol) {
                rxText.value += REVERSE_MORSE[currentSymbol] || '?';
                rxMorse.value += " ";
                currentSymbol = "";
            }
        }
        
        signalState = true;
        lastSignalTime = now;
    } 
    // Transizione ON -> OFF (Fine segnale)
    else if (!isOn && signalState) {
        const delta = now - lastSignalTime;
        
        // Interpreta la durata del segnale
        if (delta > 50) { // Ignora glitch < 50ms
            if (delta < UNIT_TIME * 1.8) {
                currentSymbol += ".";
                rxMorse.value += ".";
            } else {
                currentSymbol += "-";
                rxMorse.value += "-";
            }
        }
        
        signalState = false;
        lastSignalTime = now;
    }
}

// 1. VIDEO (Auto-calibrazione Media)
async function startVideoRx() {
    stopReception(); // Pulisce tracce precedenti
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const vid = document.getElementById('videoElement');
        vid.srcObject = activeStream;
        vid.classList.add('active');
        document.querySelector('.target-box').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';

        const canvas = document.getElementById('canvasElement');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        levelLabel.innerText = "Luce: (tieni fermo sul segnale)";
        
        // Variabile per media mobile (auto-calibrazione)
        let averageLight = 0;
        
        rxInterval = setInterval(() => {
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
                canvas.width = 40; canvas.height = 40;
                ctx.drawImage(vid, 0, 0, 40, 40);
                
                // Analizza centro 10x10
                const frame = ctx.getImageData(15, 15, 10, 10);
                let total = 0;
                for(let i=0; i<frame.data.length; i+=4) total += (frame.data[i] + frame.data[i+1] + frame.data[i+2]) / 3;
                const currentLight = total / (frame.data.length / 4);
                
                // Inizializza media
                if (averageLight === 0) averageLight = currentLight;
                
                // Aggiorna media lentamente (si adatta all'ambiente)
                averageLight = (averageLight * 0.95) + (currentLight * 0.05);
                
                // Se la luce attuale è significativamente maggiore della media (+30)
                // O se è luce assoluta molto forte (>230)
                const threshold = 35; 
                const diff = currentLight - averageLight;
                const isBright = (diff > threshold) || (currentLight > 240);
                
                // Visualizza barra (differenza normalizzata)
                const barVal = Math.min(100, Math.max(0, diff * 2));
                signalLevelBar.style.width = barVal + '%';
                if(isBright) signalLevelBar.style.backgroundColor = 'lime';
                else signalLevelBar.style.backgroundColor = 'gray';

                processInput(isBright);
            }
        }, 50);

    } catch(e) { alert("Errore Camera: " + e); }
}

// 2. AUDIO (Banda Larga)
async function startAudioRx() {
    stopReception();
    try {
        unlockAudio();
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        levelLabel.innerText = "Volume Tono (500-700Hz):";
        
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 512;
        source.connect(analyzer);
        
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        
        // Calcola indici array per 500Hz e 700Hz
        const hzPerBin = audioCtx.sampleRate / analyzer.fftSize;
        const startBin = Math.floor(500 / hzPerBin);
        const endBin = Math.ceil(700 / hzPerBin);

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(dataArray);
            
            // Cerca il valore massimo nella banda di frequenza target
            let maxVal = 0;
            for(let i = startBin; i <= endBin; i++) {
                if(dataArray[i] > maxVal) maxVal = dataArray[i];
            }
            
            // Soglia udibile (120 su 255 è un buon compromesso per ambiente silenzioso)
            const threshold = 120;
            const isTone = maxVal > threshold;
            
            // UI Barra
            const percent = (maxVal / 255) * 100;
            signalLevelBar.style.width = percent + '%';
            if(isTone) signalLevelBar.style.backgroundColor = 'lime';
            else signalLevelBar.style.backgroundColor = 'gray';

            processInput(isTone);
            
        }, 40);

    } catch(e) { alert("Errore Microfono: " + e); }
}

// Ferma tutto e pulisce i permessi
function stopReception() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop()); // Spegne pallino verde iOS
        activeStream = null;
    }
    if (rxInterval) clearInterval(rxInterval);
    
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalIndicator').classList.remove('signal-active');
    signalLevelBar.style.width = '0%';
}

document.getElementById('btnRxCamera').addEventListener('click', startVideoRx);
document.getElementById('btnRxAudio').addEventListener('click', startAudioRx);
document.getElementById('btnRxStop').addEventListener('click', stopReception);