// --- CONFIGURAZIONE ---
const MORSE_MAP = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z', '-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','/':' '};
const REVERSE_MAP = Object.fromEntries(Object.entries(MORSE_MAP).map(([k,v]) => [v,k]));

// UNITÀ DI TEMPO (400ms = Molto stabile per sensori lenti)
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
    
    // Evita lo slash iniziale
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
            // FINE IMPULSO: Discriminazione Punto/Linea
            if (duration > 50) { // Filtro anti-rumore
                // Usiamo UNIT * 2 come soglia critica (800ms se UNIT è 400)
                // Se il suono dura meno di 800ms è un PUNTO, altrimenti è una LINEA
                if (duration < UNIT * 2) {
                    currentBuffer += ".";
                    updateLiveMorse(".");
                } else {
                    currentBuffer += "-";
                    updateLiveMorse("-");
                }
            }
        } else {
            // FINE PAUSA: Spazio Lettera/Parola
            if (duration > UNIT * 1.5) { 
                decodeLetter();
                if (duration > UNIT * 4) { 
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

function checkAutoDecode() {
    if (!signalActive && currentBuffer !== "") {
        if (performance.now() - lastTransition > UNIT * 2) {
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
            const isOn = (diff > 20) && (brightness > threshold);
            
            const level = diff > 0 ? ((brightness - minB) / diff) * 100 : 0;
            document.getElementById('signalLevelBar').style.width = level + "%";
            document.getElementById('signalLevelBar').style.backgroundColor = isOn ? "lime" : "gray";

            handleSignalChange(isOn);
            checkAutoDecode();
        }, 40);
    } catch(e) { alert("Errore Camera"); }
}

// --- RICEZIONE AUDIO (VERSIONE OTTIMIZZATA PER IPHONE) ---
async function startAudioRx() {
    stopReception();
    isFirstSignalDetected = false;
    
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
        });
        
        co