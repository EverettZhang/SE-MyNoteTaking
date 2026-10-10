"""Translate command-line text into Traditional Chinese with OpenRouter."""

import argparse
import json
from pathlib import Path
import sys

from dotenv import dotenv_values
import requests


ROOT_DIR = Path(__file__).resolve().parent
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "deepseek/deepseek-v4-flash-0731"
PROMPT_PATH = ROOT_DIR / "prompts" / "translate_prompt.md"


def llm_generate(text: str) -> str:
    """Return the validated Traditional Chinese translation of text."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Text to translate must not be empty.")

    api_key = dotenv_values(ROOT_DIR / ".env").get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is missing from .env.")

    system_prompt = PROMPT_PATH.read_text(encoding="utf-8")
    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "reasoning": {"enabled": True},
        },
        timeout=60,
    )
    response.raise_for_status()
    try:
        content = response.json()["choices"][0]["message"]["content"]
        result = json.loads(content)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValueError("OpenRouter returned invalid translation JSON.") from exc

    if not isinstance(result, dict) or not isinstance(result.get("translation"), str):
        raise ValueError("OpenRouter returned invalid translation JSON.")
    translation = result["translation"].strip()
    if not translation:
        raise ValueError("OpenRouter returned an empty translation.")
    return translation


def main() -> int:
    parser = argparse.ArgumentParser(description="Translate text into Traditional Chinese.")
    parser.add_argument("text", nargs="+", help="Text to translate")
    args = parser.parse_args()

    try:
        print(json.dumps({"translation": llm_generate(" ".join(args.text))}, ensure_ascii=False))
    except (ValueError, OSError, requests.RequestException) as exc:
        print(f"Translation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
