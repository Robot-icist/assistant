"""Cache-aware streaming session for NVIDIA Nemotron 3.5 ASR.

The server contract (audio in, JSON out) is kept identical to the old
whisper_streaming_web server.  This module only replaces the recognition
engine: audio is decoded once and fed to the model as cache-aware chunks,
instead of re-transcribing a growing buffer with Whisper.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import timedelta
from typing import Optional

import numpy as np
import torch
from transformers.generation.streamers import BaseStreamer

logger = logging.getLogger(__name__)

# RNNT generation keeps per-call state on the model instance (encoder frame
# pointer, step durations, streaming flags), so only one stream may run
# ``model.generate`` at a time.  The voice pipeline is single-user: a second
# client waits until the active stream ends instead of corrupting its output.
_GENERATE_LOCK = threading.Lock()
# The model can append a detected language tag such as <en-US> in auto mode.
LANG_TAG_RE = re.compile(r"<[a-z]{2,3}(?:-[A-Z]{2})?>")


def format_time(seconds: float) -> str:
    """Same timestamp format as the Whisper server (timedelta, whole seconds)."""
    return str(timedelta(seconds=int(max(0.0, seconds))))


class AudioTimeline:
    """Thread-safe rolling audio buffer addressed by absolute sample index.

    The generator consumed by ``model.generate`` runs on a worker thread while
    the WebSocket reader appends PCM on the asyncio thread.  Keeping absolute
    indices makes the overlap required by the feature extractor explicit.
    """

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._buffer = np.empty(0, dtype=np.float32)
        self._buffer_start = 0  # absolute sample index of _buffer[0]
        self._total = 0  # total samples appended
        self._closed = False

    @property
    def total(self) -> int:
        with self._cond:
            return self._total

    @property
    def closed(self) -> bool:
        with self._cond:
            return self._closed

    def append(self, samples: np.ndarray) -> None:
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return
        with self._cond:
            if self._closed:
                return
            self._buffer = np.concatenate((self._buffer, samples))
            self._total += samples.size
            self._cond.notify_all()

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._cond.notify_all()

    def get(self, start: int, end: int) -> Optional[np.ndarray]:
        """Return samples ``[start, end)``; pad the tail with silence after close."""
        with self._cond:
            while True:
                if start >= self._total and self._closed:
                    return None
                if end <= self._total or self._closed:
                    break
                self._cond.wait(0.25)

            rel_start = start - self._buffer_start
            if rel_start < 0:
                # Defensive; callers request monotonically increasing ranges.
                rel_start = 0

            if end <= self._total:
                data = self._buffer[rel_start : end - self._buffer_start]
            else:
                available = self._buffer[rel_start:]
                missing = end - self._total
                data = np.concatenate((available, np.zeros(missing, dtype=np.float32)))

            # Drop audio before the requested range, but keep the overlap used
            # by the next feature-extraction chunk.
            drop = start - self._buffer_start
            if drop > 0:
                self._buffer = self._buffer[drop:]
                self._buffer_start = start

            return data


class _CallbackStreamer(BaseStreamer):
    """Streams the full decoded transcript instead of word-finished deltas.

    ``TextStreamer`` only forwards text up to the last space, so the word being
    spoken is held back until the next word starts (or until the stream ends).
    That silently drops the last word when an utterance is committed at a pause.
    Decoding the whole token cache and reporting the complete text keeps the
    trailing partial word visible, which is what a live transcript wants.
    """

    def __init__(self, tokenizer, callback):
        self.tokenizer = tokenizer
        self._callback = callback
        self._cache: list = []
        self._skip_first = True
        self.text = ""

    def put(self, value):
        if getattr(value, "ndim", 1) > 1:
            value = value[0]
        if self._skip_first:
            # generate() first feeds the decoder start (blank) token.
            self._skip_first = False
            return

        self._cache.extend(int(token) for token in value.tolist())
        text = self.tokenizer.decode(self._cache, skip_special_tokens=True)
        text = LANG_TAG_RE.sub("", text)
        if text != self.text:
            self.text = text
            self._callback(text)

    def end(self):
        # ``put`` always reports the complete transcript, so nothing is pending.
        return


class NemotronStreamingSession:
    """One cache-aware streaming recognition session.

    The session is fed raw 16 kHz mono float32 audio via :meth:`push_audio`.
    It emits the same payload shape as the Whisper server through
    :meth:`snapshot`.
    """

    def __init__(
        self,
        model,
        processor,
        language: str = "auto",
        device: str = "cuda",
        dtype: torch.dtype = torch.float16,
        endpoint_silence: float = 0.7,
        max_pending_chars: int = 400,
        silence_rms: float = 0.01,
    ) -> None:
        self.model = model
        self.processor = processor
        self.language = language or "auto"
        self.device = device
        self.dtype = dtype
        self.endpoint_silence = max(0.2, float(endpoint_silence))
        self.max_pending_chars = max(80, int(max_pending_chars))
        self.silence_rms = max(0.0, float(silence_rms))

        features = processor.feature_extractor
        self._sample_rate = int(features.sampling_rate)
        self._hop = int(features.hop_length)
        self._nfft = int(features.n_fft)

        self._first_samples = int(processor.num_samples_first_audio_chunk)
        self._chunk_samples = int(processor.num_samples_per_audio_chunk)
        self._first_mel = int(processor.num_mel_frames_first_audio_chunk)
        self._chunk_mel = int(processor.num_mel_frames_per_audio_chunk)

        self._timeline = AudioTimeline()
        self._state_lock = threading.Lock()
        # Full decoded transcript for this stream and how much of it has been
        # promoted to the committed line (the rest stays in the partial buffer).
        self._text = ""
        self._committed_len = 0
        self._last_text_time = time.monotonic()
        self._last_voice_time = self._last_text_time
        self._received = 0
        self._processed = 0
        self._started = False
        self._closed = False
        self._finished = threading.Event()
        self._error: Optional[BaseException] = None
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------ audio
    def push_audio(self, samples: np.ndarray) -> None:
        if self._closed:
            return
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            return
        self._timeline.append(samples)
        rms = float(np.sqrt(np.mean(np.square(samples), dtype=np.float64)))
        now = time.monotonic()
        with self._state_lock:
            self._received += samples.size
            if rms >= self.silence_rms:
                self._last_voice_time = now
            should_start = not self._started and self._received >= self._first_samples
        if should_start:
            self._start_worker()

    def _start_worker(self) -> None:
        with self._state_lock:
            if self._started:
                return
            self._started = True
        self._thread = threading.Thread(
            target=self._run,
            name="nemotron-stream-session",
            daemon=True,
        )
        self._thread.start()

    def close(self) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
        self._timeline.close()

        # If the client disconnected before a full first chunk arrived, still
        # flush the tail (padded with silence) so short utterances are not lost.
        with self._state_lock:
            started = self._started
        if not started and self._timeline.total > 0:
            self._start_worker()
        elif not started:
            self._finished.set()

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._finished.wait(timeout)

    @property
    def finished(self) -> bool:
        return self._finished.is_set()

    @property
    def error(self) -> Optional[BaseException]:
        return self._error

    # --------------------------------------------------------------- internals
    def _run(self) -> None:
        try:
            with torch.inference_mode():
                first_audio = self._timeline.get(0, self._first_samples)
                if first_audio is None:
                    return

                first_inputs = self.processor(
                    first_audio,
                    sampling_rate=self._sample_rate,
                    is_streaming=True,
                    is_first_audio_chunk=True,
                    language=self.language,
                    return_tensors="pt",
                )
                first_inputs = first_inputs.to(self.device, dtype=self.dtype)

                streamer = _CallbackStreamer(self.processor.tokenizer, self._on_text)
                generate_kwargs = dict(first_inputs)
                generate_kwargs["input_features"] = self._iter_features(first_inputs)
                generate_kwargs["streamer"] = streamer

                if not _GENERATE_LOCK.acquire(blocking=False):
                    logger.info(
                        "Another ASR stream is active; this session will start "
                        "when it finishes."
                    )
                    # Give up if the client disconnects while we are waiting.
                    while not _GENERATE_LOCK.acquire(timeout=0.5):
                        if self._closed:
                            return
                try:
                    self.model.generate(**generate_kwargs)
                finally:
                    _GENERATE_LOCK.release()
        except BaseException as exc:  # noqa: BLE001 - surfaced to the server
            self._error = exc
            logger.exception("Nemotron stream session failed: %s", exc)
        finally:
            with self._state_lock:
                # Session over: nothing can change the transcript any more.
                self._committed_len = len(self._text)
            self._finished.set()

    def _iter_features(self, first_inputs):
        # First chunk features are already on the model device.
        yield first_inputs.input_features[:, : self._first_mel, :]

        mel_frame_idx = self._first_mel
        while True:
            start_idx = mel_frame_idx * self._hop - self._nfft // 2
            end_idx = start_idx + self._chunk_samples
            audio = self._timeline.get(start_idx, end_idx)
            if audio is None:
                return

            inputs = self.processor(
                audio,
                sampling_rate=self._sample_rate,
                is_streaming=True,
                is_first_audio_chunk=False,
                language=self.language,
                return_tensors="pt",
            )
            inputs = inputs.to(self.device, dtype=self.dtype)

            with self._state_lock:
                self._processed = max(self._processed, end_idx)

            yield inputs.input_features
            mel_frame_idx += self._chunk_mel

    def _on_text(self, text: str) -> None:
        """Receive the full transcript decoded so far."""
        if not text:
            return
        with self._state_lock:
            self._text = text
            self._last_text_time = time.monotonic()

    def _commit_if_due(self, now: float) -> None:
        """Move text from the partial buffer to committed text at a pause.

        Keeping text in ``buffer_transcription`` until a short silence is what
        prevents the Android client from firing on every decoded word: it only
        acts when the first line has text AND ``buffer_transcription`` is empty.

        A pause requires all three of:
          * no new decoded text for ``endpoint_silence`` seconds,
          * no above-threshold audio for ``endpoint_silence`` seconds (so GPU
            lag on a long utterance cannot look like the end of speech),
          * at least one word buffered.
        """
        with self._state_lock:
            if len(self._text) <= self._committed_len:
                return

            pending = self._text[self._committed_len :]
            silent_audio = (now - self._last_voice_time) >= self.endpoint_silence
            quiet_decoder = (now - self._last_text_time) >= self.endpoint_silence

            if silent_audio and quiet_decoder:
                # The utterance is over: commit everything decoded so far,
                # including the trailing (possibly still growing) word.
                self._committed_len = len(self._text)
                return

            # Long monologues: keep the committed line moving so the payload
            # does not grow without bound.  Split on a word boundary.
            if len(pending) >= self.max_pending_chars:
                idx = max(
                    pending.rfind(" "),
                    pending.rfind("\n"),
                    pending.rfind("\t"),
                )
                if idx > 0:
                    self._committed_len += idx + 1
                else:
                    self._committed_len = len(self._text)

    # ----------------------------------------------------------------- payload
    def snapshot(self) -> dict:
        now = time.monotonic()
        self._commit_if_due(now)

        with self._state_lock:
            committed = self._text[: self._committed_len].strip()
            remainder = self._text[self._committed_len :].strip()
            # The web client renders `line.text` and `buffer_transcription` back
            # to back, so the partial buffer needs one separating space.  A
            # whitespace-only remainder must stay empty, otherwise the Android
            # client would see a non-empty buffer and never fire.
            pending = f" {remainder}" if committed and remainder else remainder
            received_seconds = self._received / self._sample_rate
            processed_seconds = min(self._processed, self._received) / self._sample_rate

        remaining = max(0.0, round(received_seconds - processed_seconds, 2))

        if committed:
            lines = [
                {
                    "speaker": 1,
                    "text": committed,
                    "beg": format_time(0),
                    "end": format_time(received_seconds),
                    "diff": 0,
                }
            ]
        else:
            lines = [
                {
                    "speaker": 1,
                    "text": "",
                    "beg": format_time(0),
                    "end": format_time(received_seconds),
                    "diff": 0,
                }
            ]

        return {
            "lines": lines,
            "buffer_transcription": pending,
            "buffer_diarization": "",
            "remaining_time_transcription": remaining,
            "remaining_time_diarization": 0,
        }

    def response_content(self) -> str:
        state = self.snapshot()
        return " | ".join(
            [
                " ".join(
                    f"{line['speaker']} {line['text']}"
                    for line in state["lines"]
                    if line["text"]
                ),
                state["buffer_transcription"],
                state["buffer_diarization"],
            ]
        )
