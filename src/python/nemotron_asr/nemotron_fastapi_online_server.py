"""Nemotron 3.5 ASR streaming server.

Drop-in replacement for ``whisper_fastapi_online_server.py``:

* WebSocket ``/asr`` accepts the same binary audio frames (WebM/Opus from the
  browser, raw 16 kHz s16le PCM when ``android=true``).
* It emits the same JSON payload shape: ``lines``, ``buffer_transcription``,
  ``buffer_diarization`` and the two ``remaining_time_*`` fields.
* The process prints ``WHISPER Service Ready`` so existing launchers keep
  working, plus a Nemotron-specific readiness line.
"""

from __future__ import annotations

import argparse
import asyncio
import fnmatch
import ipaddress
import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from nemotron_streaming import NemotronStreamingSession

try:
    import ffmpeg
except ImportError:  # pragma: no cover - only needed for WebM clients
    ffmpeg = None

load_dotenv()

SAMPLE_RATE = 16000
CHANNELS = 1
BYTES_PER_SAMPLE = 2
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE

BASE_DIR = Path(__file__).resolve().parent
WHISPER_DIR = BASE_DIR.parent / "whisper_streaming_web"
WEB_HTML_PATH = WHISPER_DIR / "web" / "live_transcription.html"
DEFAULT_WARMUP_FILE = WHISPER_DIR / "samples_jfk.wav"

DEFAULT_MODEL = os.environ.get(
    "NEMOTRON_MODEL", "nvidia/nemotron-3.5-asr-streaming-0.6b"
)

# Nemotron runtime latency presets (right lookahead in subsampled frames).
LATENCY_TO_LOOKAHEAD = {80: 0, 320: 3, 560: 6, 1120: 13}
LOOKAHEAD_TO_LATENCY = {v: k for k, v in LATENCY_TO_LOOKAHEAD.items()}

LANGUAGE_ALIASES = {
    "zh": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-hant": "zh-TW",
    "ja": "ja-JP",
    "jw": "id-ID",
    "nb": "nb-NO",
    "nn": "nn-NO",
    "pt-br": "pt-BR",
    "pt-pt": "pt-PT",
    "en-us": "en-US",
    "en-gb": "en-GB",
    "fr-fr": "fr-FR",
    "fr-ca": "fr-CA",
    "es-es": "es-ES",
    "es-us": "es-US",
    "de-de": "de-DE",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("nemotron_asr")
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Nemotron 3.5 ASR streaming server")

    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=10000)
    parser.add_argument("--asr-model", type=str, default=DEFAULT_MODEL)
    parser.add_argument(
        "--language",
        "--lan",
        dest="language",
        type=str,
        default=os.environ.get("ASR_LANGUAGE", "auto"),
        help="Target locale (en-US, fr-FR, ...) or 'auto'.",
    )
    parser.add_argument(
        "--chunk-ms",
        type=int,
        default=int(os.environ.get("ASR_CHUNK_MS", "560")),
        choices=sorted(LATENCY_TO_LOOKAHEAD.keys()),
        help="Streaming latency: 80, 320, 560 or 1120 ms.",
    )
    parser.add_argument(
        "--lookahead-tokens",
        type=int,
        default=None,
        help="Override the model lookahead directly (0, 3, 6 or 13).",
    )
    parser.add_argument(
        "--endpoint-silence",
        type=float,
        default=float(os.environ.get("ASR_ENDPOINT_SILENCE", "0.7")),
        help="Silence in seconds before partial text is committed.",
    )
    parser.add_argument(
        "--dtype",
        type=str,
        default=os.environ.get("ASR_DTYPE", "auto"),
        choices=["auto", "float16", "bfloat16", "float32"],
    )
    parser.add_argument(
        "--device",
        type=str,
        default=os.environ.get("ASR_DEVICE", "auto"),
        choices=["auto", "cuda", "cpu"],
    )
    parser.add_argument("--model_cache_dir", type=str, default=None)
    parser.add_argument(
        "--warmup",
        dest="warmup",
        action="store_true",
        default=os.environ.get("ASR_WARMUP", "1").lower()
        not in ("0", "false", "no", "off"),
        help="Run a short warmup pass before reporting ready (default: on).",
    )
    parser.add_argument("--no-warmup", dest="warmup", action="store_false")
    parser.add_argument("--warmup-file", type=str, default=str(DEFAULT_WARMUP_FILE))

    # --- legacy whisper_streaming_web flags ---------------------------------
    # Kept so existing launch scripts/emulators do not fail.  They are not used
    # by the cache-aware Nemotron engine.
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--model_dir", type=str, default=None)
    parser.add_argument("--min-chunk-size", type=float, default=1.0)
    parser.add_argument("--buffer_trimming", type=str, default="segment")
    parser.add_argument("--buffer_trimming_sec", type=float, default=1.0)
    parser.add_argument("--confidence-validation", type=str, default="true")
    parser.add_argument("--vad", action="store_true", default=False)
    parser.add_argument("--vac", action="store_true", default=False)
    parser.add_argument("--vac-chunk-size", type=float, default=0.04)
    parser.add_argument("--diarization", type=str, default="false")
    parser.add_argument("--transcription", type=str, default="true")
    parser.add_argument("--backend", type=str, default="nemotron")
    parser.add_argument("--task", type=str, default="transcribe")
    parser.add_argument(
        "-l",
        "--log-level",
        dest="log_level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default="INFO",
    )
    return parser


args = build_parser().parse_args()
logger.setLevel(getattr(logging, args.log_level.upper(), logging.INFO))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def str2bool(value) -> bool:
    return str(value).lower() in ("yes", "true", "t", "1", "on")


ALLOWED_IPS = (os.environ.get("ALLOWED_IPS") or "*").strip()


def is_ip_allowed(ip: str) -> bool:
    if not ALLOWED_IPS or ALLOWED_IPS == "*":
        return True
    return any(
        fnmatch.fnmatch(ip, pattern.strip())
        for pattern in ALLOWED_IPS.split(",")
        if pattern.strip()
    )


def normalize_client_ip(host: Optional[str]) -> str:
    if not host:
        return ""
    host = host.strip()
    if host.startswith("["):  # [::1]:1234
        return host[1 : host.find("]")] if "]" in host else host
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        pass
    if host.count(":") == 1:
        return host.rsplit(":", 1)[0]
    return host


def normalize_language(language: str, processor) -> str:
    language = (language or "auto").strip()
    if language.lower() == "auto":
        return "auto"

    candidates = [language, language.lower(), language.replace("_", "-")]
    alias = LANGUAGE_ALIASES.get(language.lower())
    if alias:
        candidates.append(alias)

    prompt_dict = getattr(processor, "prompt_dictionary", None) or {}
    if prompt_dict:
        for candidate in candidates:
            if candidate in prompt_dict:
                return candidate
        # Try a bare code (fr-FR -> fr).
        bare = language.split("-")[0].lower()
        if bare in prompt_dict:
            return bare
        logger.warning(
            "Language %r is not in the Nemotron prompt dictionary; using auto.",
            language,
        )
        return "auto"
    return language


def resolve_device(requested: str) -> str:
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested but unavailable; falling back to CPU.")
        return "cpu"
    return requested


def resolve_dtype(requested: str, device: str) -> torch.dtype:
    if requested == "auto":
        return torch.float16 if device == "cuda" else torch.float32
    mapping = {
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
        "float32": torch.float32,
    }
    dtype = mapping[requested]
    if device == "cpu" and dtype != torch.float32:
        logger.warning("Using float32 on CPU (requested %s).", requested)
        return torch.float32
    return dtype


def resolve_lookahead() -> int:
    if args.lookahead_tokens is not None:
        lookahead = int(args.lookahead_tokens)
    else:
        lookahead = LATENCY_TO_LOOKAHEAD[int(args.chunk_ms)]
    if lookahead not in LOOKAHEAD_TO_LATENCY:
        raise SystemExit(
            f"Unsupported lookahead {lookahead}; choose one of "
            f"{sorted(LOOKAHEAD_TO_LATENCY)}"
        )
    return lookahead


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------
def start_ffmpeg_decoder(android: bool = False):
    """Decode client bytes to 16 kHz mono s16le PCM on stdout."""
    if ffmpeg is None:
        raise RuntimeError(
            "ffmpeg-python is not installed; only android=true raw PCM works"
        )
    input_kwargs = {"format": "s16le"} if android else {"format": "webm"}
    return (
        ffmpeg.input("pipe:0", **input_kwargs)
        .output(
            "pipe:1",
            format="s16le",
            acodec="pcm_s16le",
            ac=CHANNELS,
            ar=str(SAMPLE_RATE),
        )
        .run_async(
            pipe_stdin=True,
            pipe_stdout=True,
            pipe_stderr=True,
            quiet=True,
        )
    )


def pcm_bytes_to_float32(data: bytes) -> np.ndarray:
    usable = len(data) - (len(data) % BYTES_PER_SAMPLE)
    if usable <= 0:
        return np.empty(0, dtype=np.float32)
    return np.frombuffer(data[:usable], dtype=np.int16).astype(np.float32) / 32768.0


def load_warmup_audio(path: str) -> np.ndarray:
    """Load a short real utterance for warmup, falling back to silence.

    The first forward pass pays a one-time CUDA kernel setup cost (several
    seconds on the RTX 5080 laptop). Running it here keeps that cost out of the
    first live utterance.
    """
    silence = np.zeros(int(SAMPLE_RATE * 1.5), dtype=np.float32)
    try:
        import soundfile as sf

        audio, sr = sf.read(path, dtype="float32", always_2d=False)
    except Exception as exc:
        logger.warning("Could not read warmup file %s (%s); using silence.", path, exc)
        return silence

    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if audio.size == 0:
        return silence

    if sr != SAMPLE_RATE:
        duration = audio.size / float(sr)
        target = max(1, int(duration * SAMPLE_RATE))
        audio = np.interp(
            np.linspace(0.0, duration, target, endpoint=False),
            np.linspace(0.0, duration, audio.size, endpoint=False),
            audio,
        ).astype(np.float32)

    return audio[: int(SAMPLE_RATE * 2.0)]


async def ffmpeg_stdout_reader(proc, session: NemotronStreamingSession):
    loop = asyncio.get_running_loop()
    remainder = bytearray()
    while True:
        try:
            chunk = await asyncio.wait_for(
                loop.run_in_executor(None, proc.stdout.read, 3200),
                timeout=2.0,
            )
        except asyncio.TimeoutError:
            # Do not print "FFmpeg read timeout": the legacy watchdog keys on
            # that string and would restart a perfectly healthy model process.
            logger.debug("ffmpeg read stalled; continuing")
            continue

        if not chunk:
            logger.info("ffmpeg stdout closed")
            return

        remainder.extend(chunk)
        usable = len(remainder) - (len(remainder) % BYTES_PER_SAMPLE)
        if usable:
            session.push_audio(pcm_bytes_to_float32(bytes(remainder[:usable])))
            del remainder[:usable]


async def ffmpeg_stderr_reader(proc):
    """Drain ffmpeg stderr so its pipe cannot fill up and block decoding."""
    loop = asyncio.get_running_loop()
    while True:
        try:
            chunk = await loop.run_in_executor(None, proc.stderr.read, 4096)
        except Exception:
            return
        if not chunk:
            return
        logger.debug("ffmpeg: %s", chunk.decode(errors="replace").strip())


async def results_formatter(websocket: WebSocket, session: NemotronStreamingSession):
    last_content = None
    while True:
        try:
            if session.error is not None and session.finished:
                logger.error("Streaming session ended with an error.")
                try:
                    await websocket.close(code=1011)
                except Exception:
                    pass
                return

            state = session.snapshot()
            first_line = state["lines"][0]
            has_content = bool(
                first_line.get("text") or state.get("buffer_transcription")
            )
            content = (
                first_line.get("text", "")
                + "|"
                + state.get("buffer_transcription", "")
                + "|"
                + state.get("buffer_diarization", "")
            )

            if has_content and content != last_content:
                await websocket.send_json(state)
                last_content = content

            if session.finished:
                # One last snapshot after the worker committed its tail.
                final_state = session.snapshot()
                final_line = final_state["lines"][0]
                final_content = (
                    final_line.get("text", "")
                    + "|"
                    + final_state.get("buffer_transcription", "")
                    + "|"
                    + final_state.get("buffer_diarization", "")
                )
                if (
                    final_line.get("text") or final_state.get("buffer_transcription")
                ) and final_content != last_content:
                    await websocket.send_json(final_state)
                return

            await asyncio.sleep(0.1)
        except (WebSocketDisconnect, asyncio.CancelledError):
            return
        except Exception:
            logger.warning("Exception in results_formatter: %s", traceback.format_exc())
            await asyncio.sleep(0.5)


async def _close_ffmpeg(proc) -> None:
    if proc is None:
        return
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(None, proc.stdin.close), timeout=1.0
        )
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass
    try:
        await asyncio.wait_for(loop.run_in_executor(None, proc.wait), timeout=2.0)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
asr_model = None
processor = None
device = "cpu"
model_dtype = torch.float32
lookahead_tokens = 6


@asynccontextmanager
async def lifespan(app: FastAPI):
    global asr_model, processor, device, model_dtype, lookahead_tokens
    from transformers import AutoModelForRNNT, AutoProcessor

    device = resolve_device(args.device)
    model_dtype = resolve_dtype(args.dtype, device)
    lookahead_tokens = resolve_lookahead()

    logger.info("Loading Nemotron ASR model %s ...", args.asr_model)
    processor = AutoProcessor.from_pretrained(
        args.asr_model, cache_dir=args.model_cache_dir
    )
    processor.set_num_lookahead_tokens(lookahead_tokens)

    load_kwargs = {"cache_dir": args.model_cache_dir, "dtype": model_dtype}
    try:
        asr_model = AutoModelForRNNT.from_pretrained(args.asr_model, **load_kwargs)
    except TypeError:
        # Older transformers releases use torch_dtype.
        load_kwargs.pop("dtype", None)
        load_kwargs["torch_dtype"] = model_dtype
        asr_model = AutoModelForRNNT.from_pretrained(args.asr_model, **load_kwargs)

    asr_model.to(device)
    asr_model.eval()

    if device == "cuda":
        logger.info(
            "Nemotron loaded on CUDA: %s | dtype=%s | lookahead=%s (%sms)",
            torch.cuda.get_device_name(0),
            model_dtype,
            lookahead_tokens,
            LOOKAHEAD_TO_LATENCY.get(lookahead_tokens, "?"),
        )
    else:
        logger.info("Nemotron loaded on CPU | dtype=%s", model_dtype)

    if args.warmup:
        try:
            warm = NemotronStreamingSession(
                asr_model,
                processor,
                language=normalize_language(args.language, processor),
                device=device,
                dtype=model_dtype,
                endpoint_silence=args.endpoint_silence,
            )
            warm.push_audio(load_warmup_audio(args.warmup_file))
            warm.close()
            ok = await asyncio.to_thread(warm.wait, 180)
            logger.info("Warmup %s", "complete" if ok else "timed out")
        except Exception as exc:
            logger.warning("Warmup failed (continuing): %s", exc)

    logger.info("NEMOTRON ASR Service Ready")
    # Legacy readiness marker used by whisperProcess.js.
    print("WHISPER Service Ready", flush=True)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    _demo_html = WEB_HTML_PATH.read_text(encoding="utf-8")
except Exception:
    _demo_html = None


@app.middleware("http")
async def filter_http_requests(request: Request, call_next):
    ip = normalize_client_ip(request.client.host if request.client else "")
    if not is_ip_allowed(ip):
        return JSONResponse(
            status_code=403, content={"detail": "Forbidden: IP not allowed"}
        )
    return await call_next(request)


@app.get("/")
async def get():
    if _demo_html is not None:
        return HTMLResponse(_demo_html)
    return JSONResponse({"service": "nemotron-3.5-asr-streaming", "status": "ok"})


@app.get("/health")
async def health():
    return {
        "status": "ready" if asr_model is not None else "loading",
        "model": args.asr_model,
        "device": device,
        "lookahead_tokens": lookahead_tokens,
    }


@app.websocket("/")
async def websocket_default(websocket: WebSocket):
    await _handle_websocket(websocket)


@app.websocket("/asr")
async def websocket_endpoint(websocket: WebSocket):
    await _handle_websocket(websocket)


async def _handle_websocket(websocket: WebSocket):
    ip = normalize_client_ip(websocket.client.host if websocket.client else "")
    if not is_ip_allowed(ip):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    query = dict(websocket.query_params)
    android = str2bool(query.get("android", False))
    raw_pcm = android or str2bool(query.get("pcm", False))
    # Avoid the literal "connection open": legacy launchers start a watchdog
    # on that string.
    logger.info("WS client connected ip=%s mode=%s", ip, "pcm" if raw_pcm else "webm")

    if asr_model is None or processor is None:
        await websocket.close(code=1013, reason="ASR model not loaded")
        return

    session = NemotronStreamingSession(
        asr_model,
        processor,
        language=normalize_language(args.language, processor),
        device=device,
        dtype=model_dtype,
        endpoint_silence=args.endpoint_silence,
    )

    ffmpeg_process = None
    tasks = []
    pcm_remainder = bytearray()

    try:
        if not raw_pcm:
            ffmpeg_process = start_ffmpeg_decoder(android=False)
            tasks.append(
                asyncio.create_task(ffmpeg_stdout_reader(ffmpeg_process, session))
            )
            tasks.append(asyncio.create_task(ffmpeg_stderr_reader(ffmpeg_process)))

        formatter_task = asyncio.create_task(results_formatter(websocket, session))
        tasks.append(formatter_task)

        loop = asyncio.get_running_loop()
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            data = message.get("bytes")
            text = message.get("text")
            if text is not None:
                # Ignore/handle control text frames without breaking old clients.
                if text.strip().lower() in ("stop", "close", "eof"):
                    break
                continue
            if data is None:
                continue

            if raw_pcm:
                pcm_remainder.extend(data)
                usable = len(pcm_remainder) - (len(pcm_remainder) % BYTES_PER_SAMPLE)
                if usable:
                    session.push_audio(
                        pcm_bytes_to_float32(bytes(pcm_remainder[:usable]))
                    )
                    del pcm_remainder[:usable]
            else:
                try:
                    await asyncio.wait_for(
                        loop.run_in_executor(None, ffmpeg_process.stdin.write, data),
                        timeout=1.0,
                    )
                    await asyncio.wait_for(
                        loop.run_in_executor(None, ffmpeg_process.stdin.flush),
                        timeout=1.0,
                    )
                except (BrokenPipeError, AttributeError, TimeoutError, OSError):
                    logger.warning("ffmpeg stdin write failed; dropping frame")
                    # The reader task will notice EOF and end the session.  Do
                    # not reset the recognition state mid-utterance.

    except WebSocketDisconnect:
        logger.info("WS client disconnected")
    except Exception:
        logger.warning("WebSocket handler error: %s", traceback.format_exc())
    finally:
        session.close()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await _close_ffmpeg(ffmpeg_process)
        logger.info("WS session cleaned up")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        reload=False,
        log_level=args.log_level.lower(),
    )
