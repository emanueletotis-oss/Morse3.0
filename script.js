// --- CONFIGURAZIONE ---
const MORSE_MAP = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z', '-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','/':' '};
const REVERSE_MAP = Object.fromEntries(Object.entries(MORSE_MAP).map(([k,v]) => [v,k]));

const UNIT = 400; 

let audioCtx, activeStream, rxInterval;
let signalActive = false;
let lastTransition = 0;
let currentBuffer = "";
let isTransmitting = false;
let stopSignal = false;
let isLooping = false;
let isFirstSignalDetected = false;

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopReception(); 
    stopTransmission();
}

// --- LOGICA DI DECODIFICA ---
function handleSignalChange(isOn) {
    const now = performance.now();
    
    if (!isFirstSignalDetected) {
        if (isOn) {
            isFirstSignalDetected = true;
            signalActive = true;
            lastTransition = now;
            document.getElementById('signalIndicator').className = 'signal-active';
        }
        return; 
    }

    if (isOn !== signalActive) {
        const duration = now - lastTransition;
        if (!isOn) { 
            if (duration > 60) {
                if (duration < UNIT * 1.8) {
                    currentBuffer += ".";
                    updateLiveMorse(".");
                } else {
                    currentBuffer += "-";
                    updateLiveMorse("-");
                }
            }
        } else {
            if (duration > UNIT * 1.5) { 
                decodeLetter();
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

// Funzione di controllo per decodifica automatica a fine messaggio
function checkAutoDecode() {
    if (!signalActive && currentBuffer !== "") {
        if (performance.now() - lastTransition > UNIT * 2.5) {
            decodeLetter();
        }
    }
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

            if (brightness < minB) minB = brightness;
            if (brightness > maxB) maxB = brightness;
            minB += 0.2; maxB -= 0.2; 

            const diff = maxB - minB;
            const threshold = minB + (diff * 0.65);
            const isOn = (diff > 18) && (brightness > threshold);
            
            const level = diff > 0 ? ((brightness - minB) / diff) * 100 : 0;
            document.getElementById('signalLevelBar').style.width = level + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";

            handleSignalChange(isOn);
            checkAutoDecode(); // Controlla se deve tradurre l'ultima lettera
        }, 40);
    } catch(e) { alert("Errore Camera"); }
}

// --- RICEZIONE AUDIO (OTTIMIZZATA IPHONE) ---
async function startAudioRx() {
    stopReception();
    isFirstSignalDetected = false;
    
    // Inizializzazione AudioContext forzata per iOS
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    try {
        // Disabilitiamo filtri che su iPhone uccidono il segnale morse
        activeStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        });
        
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 512;
        source.connect(analyzer);

        const buffer = new Uint8Array(analyzer.frequencyBinCount);
        let minVol = 255, maxVol = 0;

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(buffer);
            let currentVol = 0;
            // Cerchiamo l'energia nel range dei beep
            for(let i=8; i<30; i++) if(buffer[i] > currentVol) currentVol = buffer[i];

            if (currentVol < minVol) minVol = currentVol;
            if (currentVol > maxVol) maxVol = currentVol;
            minVol += 0.5; maxVol -= 0.5;

            const diff = maxVol - minVol;
            const threshold = minVol + (diff * 0.5);
            const isOn = (diff > 40) && (currentVol > threshold);

            document.getElementById('signalLevelBar').style.width = (currentVol/255 * 100) + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";
            
            handleSignalChange(isOn);
            checkAutoDecode(); 
        }, 40);
    } catch(e) { alert("Errore Microfono: assicurati di aver dato i permessi."); }
}

// --- TRASMISSIONE ---
async function startTx(type) {
    if (isTransmitting) return;
    const text = document.getElementById('outputMorse').value;
    if (!text) return;

    // Sblocco AudioContext per iPhone
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    isTransmitting = true; stopSignal = false;
    document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch').classList.add('active-tx');

    let track = null;
    let stream = null;

    if (type === 'torch') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
            track = stream.getVideoTracks()[0];
            await new Promise(r => setTimeout(r, 1000));
        } catch(e) { stopTransmission(); return; }
    }

    const play = async (d) => {
        if (type === 'sound') {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.frequency.value = 800;
            g.gain.setValueAtTime(0, audioCtx.currentTime);
            g.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.01);
            o.start();
            await new Promise(r => setTimeout(r, d));
            g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01);
            o.stop(audioCtx.currentTime + 0.05);
        } else if (track) {
            try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
            await new Promise(r => setTimeout(r, d));
            try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
        }
    };

    do {
        for (let c of text) {
            if (stopSignal) break;
            if (c === '.') { await play(UNIT); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === '-') { await play(UNIT*3); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === ' ') { await new Promise(r => setTimeout(r, UNIT*2)); }
            else if (c === '/') { await new Promise(r => setTimeout(r, UNIT*5)); }
        }
        await new Promise(r => setTimeout(r, UNIT * 10));
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
        if (c === ' ') return '/';
        for (let key in MORSE_MAP) {
            if (MORSE_MAP[key] === c) return key;
        }
        return '';
    }).join(' ');
};

document.getElementById('btnCopy').onclick = () => {
    const el = document.getElementById('outputMorse');
    el.select();
    document.execCommand('copy');
};

document.getElementById('btnSound').onclick = () => { startTx('sound'); };
document.getElementById('btnTorch').onclick = () => { startTx('torch'); };
document.getElementById('btnStop').onclick = stopTransmission;

document.getElementById('btnLoop').onclick = () => {
    isLooping = !isLooping;
    const btn = document.getElementById('btnLoop');
    btn.innerHTML = isLooping ? "Loop ON &#10004;" : "Loop &#8635;";
    btn.className = `action-btn small-btn ${isLooping ? 'loop-on' : 'loop-off'}`;
};

document.getElementById('btnRxCamera').onclick = startVideoRx;
document.getElementById('btnRxAudio').onclick = startAudioRx;
document.getElementById('btnRxStop').onclick = stopReception;

document.getElementById('btnClearRx').onclick = () => {
    document.getElementById('rxMorse').value = "";
    document.getElementById('rxText').value = "";
    currentBuffer = "";
    isFirstSignalDetected = false;
};