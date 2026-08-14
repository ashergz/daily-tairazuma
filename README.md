# Daily Tairazuma

This public source powers the native Cubari reader for u/Dark074's image posts in r/Seihantai.

The GitHub Action runs every five minutes and uses GitHub's built-in `GITHUB_TOKEN` to update `cubari.json`; no personal token or MFA setting is required. Gallery submissions use Cubari's Reddit proxy. Direct Reddit-hosted images become one-page chapters. Non-image links are skipped.

Native Cubari source:

https://raw.githubusercontent.com/ashergz/daily-tairazuma/main/cubari.json

Reader:

https://cubari.moe/read/gist/cmF3L2FzaGVyZ3ovZGFpbHktdGFpcmF6dW1hL21haW4vY3ViYXJpLmpzb24/
