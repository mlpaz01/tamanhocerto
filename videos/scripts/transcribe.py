#!/usr/bin/env python3
"""Transcrição local com faster-whisper.

Uso:
    python3 transcribe.py --audio audio.wav --model small [--language pt] [--prompt "..."]

Imprime no stdout (última linha) um JSON:
    {"text": "...", "language": "pt", "duration": 123.4, "segments": [...]}

Requer: pip install faster-whisper
faster-whisper roda em CPU (int8) — ideal para o free tier ARM da Oracle.
"""
import argparse
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--model", default="small")
    p.add_argument("--language", default=None)
    p.add_argument("--prompt", default=None)
    p.add_argument("--compute-type", default="int8")
    p.add_argument("--device", default="cpu")
    args = p.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001
        print(f"faster-whisper não instalado: {e}", file=sys.stderr)
        return 1

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(
            args.audio,
            language=args.language,
            initial_prompt=args.prompt,
            vad_filter=True,
        )

        seg_list = []
        text_parts = []
        for i, s in enumerate(segments):
            seg_list.append({
                "id": i,
                "start": round(s.start, 3),
                "end": round(s.end, 3),
                "text": s.text,
            })
            text_parts.append(s.text)

        result = {
            "text": "".join(text_parts).strip(),
            "language": info.language,
            "duration": round(getattr(info, "duration", 0.0), 3),
            "segments": seg_list,
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"Erro na transcrição: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
