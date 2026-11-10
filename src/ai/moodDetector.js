// agent/moodDetector.js
const HUMAN = /\b(cs|agen|agent|operator|manusia)\b/i;
const ANGRY =
	/\b(kesal|kesel|kecewa|marah|parah|payah|lelet|lemot banget|nyebelin|komplain)\b|[!?]{3,}/i;

function detectMood(text = '') {
	const t = String(text).trim();
	if (/^(KONFIRMASI|BATAL|\d)$/i.test(t)) return 'NORMAL'; // jawaban tombol bukan marah
	if (HUMAN.test(t)) return 'HUMAN';
	if (ANGRY.test(t)) return 'ANGRY';
	return 'NORMAL';
}

module.exports = { detectMood };
