let words = [];
let currentWord = null;
let audio = null;

function getGeminiKey() {
    return window.env?.GEMINI_API_KEY || '';
}


async function testAudioAccess() {
    const audioPath = `indonesian_audio/ada.mp3`;
    try {
        const response = await fetch(audioPath, { method: 'HEAD' });
        if (response.ok) {
            return { success: true, message: '✅ Audio files are accessible!' };
        } else {
            return {
                success: false,
                message: `❌ Cannot access audio files (Status: ${response.status})\n\nPlease ensure:\n1. flashcard.html is in the same directory as indonesian_audio/\n2. You're using a web server (http://), not opening the file directly (file://)\n3. Current page URL: ${window.location.href}`
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `❌ Error accessing audio: ${error.message}\n\nMake sure you're running a local web server.`
        };
    }
}

async function showDiagnostics() {
    const result = await testAudioAccess();
    const diagDiv = document.getElementById('diagnostics');
    diagDiv.innerHTML = `
        <div class="info-box">
            <strong>Setup Check:</strong><br>
            ${result.message.replace(/\n/g, '<br>')}
            <br><br>
            <strong>Current Location:</strong> ${window.location.href}
            <br>
            <strong>Total Words Loaded:</strong> ${words.length}
        </div>
    `;
}

async function loadWords() {
    try {
        const response = await fetch('words.json');
        if (!response.ok) throw new Error('Failed to load words.json');
        words = await response.json();
        showRandomWord();
        await showDiagnostics();
    } catch (error) {
        document.getElementById('flashcard').innerHTML = `
            <div class="error">
                <strong>Error:</strong> ${error.message}<br>
                Make sure words.json is in the same directory as this HTML file.
            </div>
        `;
    }
}

function getAudioFilename(indonesianText) {
    return 'indonesian_audio/' + indonesianText.replace(/ /g, '_') + '.mp3';
}

function getRandomWord() {
    return words[Math.floor(Math.random() * words.length)];
}

function playAudio() {
    if (!currentWord) return;

    const audioFile = getAudioFilename(currentWord.indonesian);

    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }

    fetch(audioFile, { method: 'HEAD' })
        .then(response => {
            if (!response.ok) {
                throw new Error(
                    `Audio file not found: ${audioFile}\n\nTroubleshooting:\n` +
                    `- Verify indonesian_audio folder is in the same directory\n` +
                    `- Check that ${currentWord.indonesian.replace(/ /g, '_')}.mp3 exists`
                );
            }
            audio = new Audio(audioFile);
            audio.onerror = (e) => {
                console.error('Audio error:', e);
                alert(`Failed to play audio: ${audioFile}`);
            };
            return audio.play();
        })
        .then(() => showTranslation())
        .catch(error => {
            console.error('Error:', error);
            alert(error.message || 'Error playing audio. Make sure the audio file exists.');
            showTranslation();
        });
}

function showTranslation() {
    const el = document.getElementById('english-translation');
    if (el) el.classList.add('show');
}

async function generateSentence() {
    const apiKey = getGeminiKey();
    const sentenceDiv = document.getElementById('sentence-section');

    if (!apiKey) {
        if (sentenceDiv) {
            sentenceDiv.innerHTML = '<div class="sentence-error">GEMINI_API_KEY is not set in .env</div>';
            sentenceDiv.classList.add('show');
        }
        return;
    }

    if (!currentWord) return;

    if (sentenceDiv) {
        sentenceDiv.innerHTML = '<div class="sentence-loading">✨ Generating sentence...</div>';
        sentenceDiv.classList.add('show');
    }

    const otherWords = words
        .filter(w => w.indonesian !== currentWord.indonesian)
        .sort(() => Math.random() - 0.5)
        .slice(0, 5)
        .map(w => w.indonesian);

    const prompt = `Create a simple Indonesian sentence using the word "${currentWord.indonesian}".

Guidelines:
- The sentence should be natural and commonly used
- Try to use other simple words like: ${otherWords.join(', ')}
- Keep it appropriate for language learners (A1-A2 level)

Provide the result EXACTLY using this format:
Indonesian: [Your Indonesian sentence here]
English: [The English translation here]`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            }
        );

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error?.message || `API error (${response.status})`);
        }

        const data = await response.json();
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        let indoSentence = '';
        let engTranslation = '';
        for (const line of resultText.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.toLowerCase().startsWith('indonesian:')) {
                indoSentence = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.toLowerCase().startsWith('english:')) {
                engTranslation = trimmed.split(':').slice(1).join(':').trim();
            }
        }
        if (!indoSentence) indoSentence = resultText;

        if (sentenceDiv) {
            sentenceDiv.innerHTML = `
                <div class="sentence-label">Example Sentence</div>
                <div class="sentence-indonesian">🇮🇩 ${indoSentence}</div>
                ${engTranslation ? `<div class="sentence-english">🇬🇧 ${engTranslation}</div>` : ''}
                <button class="play-sentence-button" data-sentence="${indoSentence.replace(/"/g, '&quot;')}" onclick="speakSentence(this.dataset.sentence)">🔊 Play Sentence</button>
            `;
            sentenceDiv.classList.add('show');
        }
    } catch (error) {
        console.error('Gemini API error:', error);
        if (sentenceDiv) {
            sentenceDiv.innerHTML = `<div class="sentence-error">⚠️ ${error.message}</div>`;
            sentenceDiv.classList.add('show');
        }
    }
}

async function speakSentence(sentence) {
    if (!sentence) return;
    await speakWithGeminiTTS(sentence);
}

async function speakWithGeminiTTS(sentence) {
    const apiKey = getGeminiKey();
    if (!apiKey) {
        console.error('[Gemini TTS] No API key — set GEMINI_API_KEY in .env');
        return;
    }
    console.log('[Gemini TTS] Generating audio for:', sentence);
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: sentence }] }],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: 'Aoede' }
                            }
                        }
                    }
                })
            }
        );
        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error?.message || `Gemini TTS HTTP ${response.status}`);
        }
        const data = await response.json();
        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData?.data) throw new Error('No audio data in Gemini TTS response');

        const binaryStr = atob(inlineData.data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const rateMatch = (inlineData.mimeType || '').match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
        await ctx.resume();
        const buf = ctx.createBuffer(1, float32.length, sampleRate);
        buf.getChannelData(0).set(float32);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        console.log('[Gemini TTS] Playing', buf.duration.toFixed(2), 's');
    } catch (error) {
        console.error('[Gemini TTS] Error:', error);
    }
}

function showWord(wordObj) {
    currentWord = wordObj;
    document.getElementById('flashcard').innerHTML = `
        <div class="card">
            <div class="indonesian-word">${currentWord.indonesian}</div>
            <div id="english-translation" class="english-translation">
                ${currentWord.english}
            </div>
            <div id="sentence-section" class="sentence-section"></div>
        </div>
        <div class="button-group">
            <button class="play-button" onclick="playAudio()">
                🔊 Play & Show Translation
            </button>
            <button class="generate-button" onclick="generateSentence()">
                ✨ Example Sentence
            </button>
            <button class="next-button" onclick="showRandomWord()">
                ➡️ Next Word
            </button>
        </div>
    `;
}

function showRandomWord() {
    const word = getRandomWord();
    const cueInput = document.getElementById('cueWordInput');
    if (cueInput) cueInput.value = word.indonesian;
    showWord(word);
    hideCueWordError();
}

function handleCueWordInput(inputValue) {
    if (inputValue.trim() === '') {
        hideCueWordError();
        showRandomWord();
        return;
    }
    const word = words.find(w => w.indonesian.toLowerCase() === inputValue.trim().toLowerCase());
    if (word) {
        showWord(word);
        hideCueWordError();
    } else {
        showCueWordError('Word not found in flashcard list.');
    }
}

function showCueWordError(msg) {
    const errDiv = document.getElementById('cueWordError');
    if (errDiv) {
        errDiv.textContent = msg;
        errDiv.style.display = 'block';
    }
}

function hideCueWordError() {
    const errDiv = document.getElementById('cueWordError');
    if (errDiv) {
        errDiv.textContent = '';
        errDiv.style.display = 'none';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    loadWords();
});
