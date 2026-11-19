# Nemotron 3.5 ASR streaming server

Drop-in replacement for `whisper_streaming_web/whisper_fastapi_online_server.py`,
powered by `nvidia/nemotron-3.5-asr-streaming-0.6b` (cache-aware FastConformer-RNNT)
running on CUDA through Hugging Face Transformers.

The WebSocket contract is unchanged:

- endpoint: `ws://<host>:10000/asr` (also accepts `/`)
- browser clients: binary WebM/Opus frames
- Android client: raw 16 kHz mono s16le PCM with `?android=true`
- JSON payload: `lines`, `buffer_transcription`, `buffer_diarization`,
  `remaining_time_transcription`, `remaining_time_diarization`

Text is kept in `buffer_transcription` until `ASR_ENDPOINT_SILENCE` (default
`0.7` s) of silence has passed, then it is committed to `lines[0].text`, which is
what makes the Android client fire only after a pause. A pause requires both no
new decoded text *and* no above-threshold audio for that long, so slow GPU
chunks cannot look like the end of an utterance.

The transcript is held as one growing text, so the word currently being spoken
already appears at the end of `buffer_transcription` instead of being withheld
until the following word starts. Committing at a pause therefore never drops the
last word of an utterance.

Transcription is serialized: RNNT generation keeps per-stream state on the model
instance, so a second client waits until the active stream ends. The assistant
is a single-user pipeline, so this avoids corrupting a running transcript.

## Setup

The project has its own `uv`-managed virtual environment; nothing is installed
into the global Python.

```powershell
cd src/python/nemotron_asr
uv sync
```

The first run downloads the model from Hugging Face (~1.2 GB).

## Run

From the repo root, `nemotronProcess.js` starts it automatically when
`WHISPER=true`:

```powershell
npm run entts        # Nemotron ASR + XTTS
```

Set `ASR_ENGINE=whisper` to keep using the original Whisper server.

The launcher runs `uv` from PATH; set `UV_EXE` to an absolute path if `uv` is
installed somewhere else.

Manual run:

```powershell
uv run --project src/python/nemotron_asr python src/python/nemotron_asr/nemotron_fastapi_online_server.py --port 10000
```

Useful options / env vars:

| Option | Env | Default |
| --- | --- | --- |
| `--asr-model` | `NEMOTRON_MODEL` | `nvidia/nemotron-3.5-asr-streaming-0.6b` |
| `--language` | `ASR_LANGUAGE` | `auto` |
| `--chunk-ms` | `ASR_CHUNK_MS` | `560` (80/320/560/1120) |
| `--endpoint-silence` | `ASR_ENDPOINT_SILENCE` | `0.7` |
| `--device` | `ASR_DEVICE` | `auto` (CUDA when available) |
| `--dtype` | `ASR_DTYPE` | `auto` (float16 on CUDA) |
| `--no-warmup` | `ASR_WARMUP` | warmup on |

Warmup is enabled by default and runs a short in-memory pass before the server
reports ready. The first CUDA forward pass costs several seconds on a cold
process, so doing it during startup avoids a stall on the first live utterance.
Set `ASR_WARMUP=0` (or pass `--no-warmup`) to skip it.

Legacy `whisper_streaming_web` flags (`--min-chunk-size`, `--buffer_trimming_sec`,
`--vad`, `--model`, ...) are accepted and ignored so existing launch lines keep
working.

## Health

`GET /health` reports the loaded model, device and lookahead for the current
streaming latency.
