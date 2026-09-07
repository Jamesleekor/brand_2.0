# Webfont builder

Windows CMD 예시:

```cmd
py -m pip install fonttools brotli
py build_webfonts.py FONTS.zip --out webfonts_output
```

기본 Brotli quality는 8이다. 이 값은 업로드된 45 face 전체에서 E2E 검증했다. `--brotli-quality 10` 또는 11도 가능하지만 대형 한글 폰트에서 매우 느릴 수 있다.

안전 기본값:
- SHA-256 exact source match
- full-glyph runtime WOFF2
- preview만 subset
- embedding flag 검사
- 생성 직후 WOFF2 재오픈/cmap 검사

`font_sources.json`은 45개 원본의 SHA-256과 27개 논리 family/weight 매핑을 고정한다.
