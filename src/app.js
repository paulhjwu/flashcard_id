let words = [];
let currentWord = null;
let audio = null;
let englishSearchMatches = [];

function getGeminiKey() {
    return window.env?.GEMINI_API_KEY || '';
}


async function testAudioAccess() {
    if (!window.electronAudio?.checkAudioDir) {
        return { success: false, message: '❌ Cannot check audio directory: IPC bridge unavailable.' };
    }
    const { exists } = await window.electronAudio.checkAudioDir();
    if (exists) {
        return { success: true, message: '✅ Audio files are accessible!' };
    }
    return { success: false, message: '❌ The indonesian_audio directory was not found. Make sure it exists next to flashcard.html.' };
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

function getAudioFilenameWav(indonesianText) {
    return 'indonesian_audio/' + indonesianText.replace(/ /g, '_') + '.wav';
}

function extractGeminiInlineAudio(data) {
    const parts = data.candidates?.[0]?.content?.parts || [];
    const inlineData = parts.find(p => p.inlineData?.data)?.inlineData;
    if (!inlineData?.data) {
        const blockReason = data.promptFeedback?.blockReason;
        const finishReason = data.candidates?.[0]?.finishReason;
        console.error('[Gemini TTS] Unexpected response:', JSON.stringify(data).slice(0, 500));
        throw new Error(
            blockReason ? `Gemini TTS blocked: ${blockReason}` :
            finishReason ? `Gemini TTS finished with reason: ${finishReason}` :
            'No audio data in Gemini TTS response'
        );
    }
    return inlineData;
}

function writeStringDataView(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function pcm16ToWav(pcmBytes, sampleRate) {
    const dataSize = pcmBytes.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeStringDataView(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStringDataView(view, 8, 'WAVE');
    writeStringDataView(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStringDataView(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer).set(pcmBytes, 44);
    return new Uint8Array(buffer);
}

async function generateAndStoreGeminiAudio(indonesianText) {
    if (!window.electronAudio?.generateTtsAudio) throw new Error('TTS IPC bridge is unavailable');
    const { relativePath } = await window.electronAudio.generateTtsAudio(indonesianText);
    return relativePath;
}

function tryLoadAudio(filePath) {
    return new Promise((resolve, reject) => {
        const a = new Audio();
        a.addEventListener('canplay', () => resolve(a), { once: true });
        a.addEventListener('error', () => reject(new Error(`Cannot load: ${filePath}`)), { once: true });
        a.src = filePath;
    });
}

function getRandomWord() {
    return words[Math.floor(Math.random() * words.length)];
}

function normalizeText(text) {
    return String(text || '').toLowerCase();
}

function getEnglishVariants(wordObj) {
    if (Array.isArray(wordObj?.english)) return wordObj.english.map(String);
    if (typeof wordObj?.english === 'string') return [wordObj.english];
    return [];
}

function englishMatchesQuery(wordObj, query) {
    const normalizedQuery = normalizeText(query).trim();
    if (!normalizedQuery) return false;

    return getEnglishVariants(wordObj).some((variant) =>
        normalizeText(variant).includes(normalizedQuery)
    );
}

function renderEnglishSearchResults(matches, query) {
    const dropdown = document.getElementById('englishSearchDropdown');
    const countEl = document.getElementById('englishSearchCount');
    if (!dropdown || !countEl) return;

    if (!query.trim()) {
        dropdown.innerHTML = '<option value="">Type above to search...</option>';
        dropdown.disabled = true;
        countEl.textContent = '';
        englishSearchMatches = [];
        return;
    }

    if (matches.length === 0) {
        countEl.textContent = 'No Indonesian matches found.';
        dropdown.innerHTML = '<option value="">No matches</option>';
        dropdown.disabled = true;
        englishSearchMatches = [];
        return;
    }

    countEl.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'} found`;
    dropdown.innerHTML = [
        '<option value="">Select an Indonesian word...</option>',
        ...matches.map((word, index) => {
            const englishLabel = getEnglishVariants(word).join(', ');
            return `<option value="${index}">${word.indonesian} - ${englishLabel}</option>`;
        })
    ].join('');
    dropdown.disabled = false;

    englishSearchMatches = matches;
}

function handleEnglishDropdownSelect(value) {
    if (value === '') return;
    const index = Number(value);
    const selectedWord = englishSearchMatches[index];
    if (!selectedWord) return;

    const cueInput = document.getElementById('cueWordInput');
    if (cueInput) cueInput.value = selectedWord.indonesian;
    showWord(selectedWord);
    hideCueWordError();
}

function handleEnglishSearchInput(inputValue) {
    const query = inputValue || '';
    if (!query.trim()) {
        renderEnglishSearchResults([], '');
        return;
    }

    const matches = words.filter((word) => englishMatchesQuery(word, query));
    renderEnglishSearchResults(matches, query);
}

async function playAudio() {
    if (!currentWord) return;

    if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio = null;
    }

    const mp3File = getAudioFilename(currentWord.indonesian);
    const wavFile = getAudioFilenameWav(currentWord.indonesian);

    try {
        audio = await tryLoadAudio(mp3File).catch(() =>
            tryLoadAudio(wavFile).catch(async () => {
                console.warn(`Audio missing for ${currentWord.indonesian}. Generating with Google TTS...`);
                const generated = await generateAndStoreGeminiAudio(currentWord.indonesian);
                return tryLoadAudio(generated);
            })
        );
        await audio.play();
        showTranslation();
    } catch (error) {
        console.error('Error:', error);
        alert(error.message || 'Error playing audio.');
        showTranslation();
    }
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

    const contextWordTarget = 100;
    const availableContextWords = words.filter(w => w.indonesian !== currentWord.indonesian);
    const otherWords = availableContextWords
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.min(contextWordTarget, availableContextWords.length))
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
                <button class="play-sentence-button" data-sentence="${indoSentence.replace(/"/g, '&quot;')}" onclick="speakSentenceSlow(this.dataset.sentence)">🐢 Play Slow</button>
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
    await speakWithGoogleTTS(sentence, 1.0);
}

async function speakSentenceSlow(sentence) {
    if (!sentence) return;
    await speakWithGoogleTTS(sentence, 0.5);
}

async function speakWithGoogleTTS(sentence, rate) {
    if (!window.electronAudio?.generateTtsBytes) {
        console.error('[Google TTS] IPC bridge unavailable');
        return;
    }
    try {
        const { audioBase64 } = await window.electronAudio.generateTtsBytes(sentence, rate);
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await a.play();
    } catch (error) {
        console.error('[Google TTS] Error:', error);
    }
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
        const inlineData = extractGeminiInlineAudio(data);

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
    const englishDisplay = getEnglishVariants(currentWord).join(', ');
    document.getElementById('flashcard').innerHTML = `
        <div class="card">
            <div class="indonesian-word">${currentWord.indonesian}</div>
            <div id="english-translation" class="english-translation">
                ${englishDisplay}
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
    englishSearchMatches = [];
});
