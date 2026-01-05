// --- CONFIGURAZIONE DIZIONARIO ---
const MORSE_MAP = {
    '.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z', '-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','/':' '
};
const REVERSE_MAP = Object.fromEntries(Object.entries(MORSE_MAP).map(([k,v]) => [v,k]));

// --- PARAMETRI DI RICEZIONE (CALIBRATI) ---
const UNIT = 250; // Millisecondi base
const TOLERANCE = 0.7; // Fattore di tolleranza per fluttuazioni frame-rate

// --- VARIABILI DI STATO ---
let audioCtx, activeStream, rxInterval;
let signalActive = false;
let lastTransition = performance.now();
let currentBuffer = ""; // Accumula . e -
let isTransmitting = false;
let stopSignal = false;

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    stopReception(); stopTransmission();
}

// --- LOGICA DI DECODIFICA (IL CUORE DEL SISTEMA) ---
function handleSignalChange(isOn) {
    const now = performance.now();
    const duration = now - lastTransition;
    const indicator = document.getElementById('signalIndicator');

    if (isOn !== signalActive) {
        if (!isOn) { 
            // PASSAGGIO DA LUCE A BUIO (Fine di un punto o linea)
            // Se il segnale è durato meno di 50ms, ignoralo (rumore/glitch)
            if (duration > 50) {
                if (duration < UNIT * 1.8) {
                    currentBuffer += ".";
                    updateLiveMorse(".");
                } else {
                    currentBuffer += "-";
                    updateLiveMorse("-");
                }
            }
        } else {
            // PASSAGGIO DA BUIO A LUCE (Inizio segnale dopo una pausa)
            // Controlliamo quanto è durata la pausa
            if (duration > UNIT * 2.2) { 
                // Se la pausa è stata lunga, la lettera precedente è finita
                decodeLetter();
                if (duration > UNIT * 5) { 
                    // Se la pausa è lunghissima, è uno spazio tra parole
                    document.getElementById('rxText').value += " ";
                    document.getElementById('rxMorse').value += " / ";
                } else {
                    document.getElementById('rxMorse').value += " ";
                }
            }
        }
        signalActive = isOn;
        lastTransition = now;
        indicator.className = isOn ? 'signal-active' : '';
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

// --- RICEZIONE VISIVA MIGLIORATA ---
async function startVideoRx() {
    stopReception();
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 } }
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
            // Analisi dell'area centrale
            ctx.drawImage(v, v.videoWidth/2-20, v.videoHeight/2-20, 40, 40, 0, 0, 40, 40);
            const pixels = ctx.getImageData(0,0,40,40).data;
            
            let brightness = 0;
            for(let i=0; i<pixels.length; i+=4) {
                brightness += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
            }
            brightness /= (pixels.length/4);

            // Adattamento dinamico della soglia
            if (brightness < minB) minB = brightness;
            if (brightness > maxB) maxB = brightness;
            
            // "Dimentica" lentamente i valori per ricalibrarsi
            minB += 0.05; maxB -= 0.05;

            const diff = maxB - minB;
            const threshold = minB + (diff * 0.6); // Soglia al 60% per essere più sicuri del segnale ON

            // Consideriamo ON solo se c'è un contrasto netto (>15 punti su 255)
            const isOn = (diff > 15) && (brightness > threshold);
            
            // Barra di debug
            const level = diff > 0 ? ((brightness - minB) / diff) * 100 : 0;
            document.getElementById('signalLevelBar').style.width = level + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";

            handleSignalChange(isOn);
        }, 33); // ~30 FPS
    } catch(e) { alert("Camera Error: " + e); }
}

// --- RICEZIONE AUDIO MIGLIORATA ---
async function startAudioRx() {
    stopReception();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();

    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(activeStream);
    const analyzer = audioCtx.createAnalyser();
    analyzer.fftSize = 512;
    source.connect(analyzer);

    const buffer = new Uint8Array(analyzer.frequencyBinCount);
    
    rxInterval = setInterval(() => {
        analyzer.getByteFrequencyData(buffer);
        // Cerchiamo l'energia nelle frequenze medie (500-1000Hz)
        let maxVal = 0;
        for(let i=8; i<25; i++) if(buffer[i] > maxVal) maxVal = buffer[i];

        const isOn = maxVal > 120; // Soglia sensibilità mic
        document.getElementById('signalLevelBar').style.width = (maxVal/255*100) + "%";
        document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";
        
        handleSignalChange(isOn);
    }, 40);
}

// --- TRASMISSIONE (Invariata ma pulita) ---
async function startTx(type) {
    if (isTransmitting) return;
    const text = document.getElementById('outputMorse').value;
    if (!text) return;

    if (type === 'sound') {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume();
    }

    isTransmitting = true; stopSignal = false;
    document.getElementById(type === 'sound' ? 'btnSound' : 'btnTorch').classList.add('active-tx');

    let track = null;
    if (type === 'torch') {
        try {
            const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
            track = s.getVideoTracks()[0];
        } catch(e) { stopTransmission(); return; }
    }

    const play = async (d) => {
        if (type === 'sound') {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            o.frequency.value = 600;
            g.gain.setValueAtTime(0, audioCtx.currentTime);
            g.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.01);
            o.start();
            await new Promise(r => setTimeout(r, d));
            g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01);
            o.stop(audioCtx.currentTime + 0.05);
        } else if (track) {
            track.applyConstraints({advanced: [{torch: true}]});
            await new Promise(r => setTimeout(r, d));
            track.applyConstraints({advanced: [{torch: false}]});
        }
    };

    do {
        for (let c of text) {
            if (stopSignal) break;
            if (c === '.') { await play(UNIT); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === '-') { await play(UNIT*3); await new Promise(r => setTimeout(r, UNIT)); }
            else if (c === ' ') { await new Promise(r => setTimeout(r, UNIT*2)); }
            else if (c === '/') { await new Promise(r => setTimeout(r, UNIT*6)); }
        }
        await new Promise(r => setTimeout(r, UNIT * 8));
    } while (isLooping && !stopSignal);

    if (track) track.stop();
    stopTransmission();
}

function stopTransmission() {
    stopSignal = true; isTransmitting = false;
    document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active-tx'));
}

function stopReception() {
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
    clearInterval(rxInterval);
    decodeLetter(); // Traduci l'ultima lettera rimasta nel buffer
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('signalLevelBar').style.width = "0%";
}

// --- EVENTI ---
document.getElementById('btnConvert').onclick = () => {
    const val = document.getElementById('inputText').value.toUpperCase();
    document.getElementById('outputMorse').value = val.split('').map(c => REVERSE_MAP[c] || (c===' '?'/':'')).join(' ');
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