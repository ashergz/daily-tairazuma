# Daily Tairazuma

This public source powers the native Cubari reader for u/Dark074's image posts in r/Seihantai.

The dedicated Cloudflare Worker runs the sync every five minutes and updates `cubari.json` through the GitHub Contents API. The GitHub Action is retained as a manual emergency backstop only. Gallery submissions use Cubari's Reddit proxy. Direct Reddit-hosted images become one-page chapters. Non-image links are skipped.

Worker deployment files live in `worker/`. Its `GITHUB_TOKEN` secret must have repository Contents read/write access for `ashergz/daily-tairazuma`.

Native Cubari source:

https://raw.githubusercontent.com/ashergz/daily-tairazuma/main/cubari.json

Reader:

https://cubari.moe/read/gist/cmF3L2FzaGVyZ3ovZGFpbHktdGFpcmF6dW1hL21haW4vY3ViYXJpLmpzb24/
