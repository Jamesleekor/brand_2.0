# B.R.A.N.D 2.0 — Git Workflow for a Solo + Codex Project

이 문서는 Git 초보자가 B.R.A.N.D 2.0을 안전하게 버전 관리하기 위한 최소 운영법이다.

목표:

- `main` = 내가 실제로 테스트해서 통과한 안정 버전
- `feature/...` = 다음 기능 작업 중
- commit = 의미 있는 복구 지점
- tag = 큰 단계 COMPLETE 표식
- GitHub private repo = 선택적 원격 백업

---

# 1. 최초 1회: Git 설치 확인

PowerShell 또는 터미널:

```powershell
git --version
```

버전이 나오면 설치 완료.

처음 한 번만 사용자 정보 설정:

```powershell
git config --global user.name "YOUR NAME"
git config --global user.email "YOUR EMAIL"
```

이 이름/이메일은 commit 작성자 정보다.

---

# 2. 기준 폴더 선택

반드시 **지금 실제 브라우저 E2E를 통과한 Guild 1.2 작업 폴더**를 기준으로 한다.

오래된 ZIP이나 Guild 1.1 폴더에서 시작하지 않는다.

예:

```powershell
cd "C:\BRAND\brand_app"
```

현재 위치 확인:

```powershell
Get-Location
```

---

# 3. Secret 확인

현재 프로젝트 `.gitignore`에는 최소 다음이 있어야 한다.

```gitignore
node_modules
dist
.env.local
*.log
```

확인:

```powershell
Get-Content .gitignore
```

`.env.local`이 ignore되는지:

```powershell
git check-ignore -v .env.local
```

Git 초기화 후에도:

```powershell
git ls-files .env.local
```

이 명령은 **아무것도 출력하지 않아야 정상**이다.

Supabase URL은 공개 가능할 수 있어도 service-role key, secret, password는 commit하지 않는다.

---

# 4. Guild 1 COMPLETE baseline 만들기

프로젝트 루트에서:

```powershell
git init
git branch -M main
git status
```

파일을 staging:

```powershell
git add .
```

반드시 확인:

```powershell
git status
```

여기에 아래가 올라오면 안 된다.

- `.env.local`
- `node_modules/`
- `dist/`
- 비밀번호/키 파일

문제없으면 최초 commit:

```powershell
git commit -m "chore: establish Guild 1 complete baseline"
```

그리고 큰 완료 지점에 tag:

```powershell
git tag -a guild1-complete -m "Guild 1 complete; transfer E2E deferred"
```

확인:

```powershell
git log --oneline --decorate -10
```

예상 형태:

```text
abc1234 (HEAD -> main, tag: guild1-complete) chore: establish Guild 1 complete baseline
```

이 순간부터 `main`은 Guild 1 안정판이다.

---

# 5. Codex 문서 넣기

이 handoff pack의:

```text
AGENTS.md
docs/BRAND_CURRENT_STATE_2026-08-12.md
docs/GUILD2_SPEC.md
docs/GIT_WORKFLOW.md
```

를 프로젝트에 복사한다.

그 뒤:

```powershell
git status
git add AGENTS.md docs
git commit -m "docs: add Codex handoff and Guild 2 specification"
```

이 commit도 안정적인 문서 변경이므로 `main`에 바로 넣어도 된다.

---

# 6. Guild 2 작업 branch 만들기

Guild 2 코드를 main에서 직접 수정하지 않는다.

```powershell
git switch -c feature/guild2-gs-engine
```

확인:

```powershell
git branch
```

`* feature/guild2-gs-engine`가 보여야 한다.

Codex는 이 branch에서 작업하게 한다.

---

# 7. Codex에게 첫 지시

Codex를 프로젝트 루트에서 열고 다음처럼 시작한다.

```text
Read AGENTS.md, docs/BRAND_CURRENT_STATE_2026-08-12.md,
and docs/GUILD2_SPEC.md first.

We are on feature/guild2-gs-engine.

Before editing:
1. inspect the existing Guild 1 code,
2. inspect all legacy Guild GS/contribution tables/functions/migrations,
3. identify production-schema assumptions,
4. if the actual production DB cannot be inspected directly, create a preflight SQL
   and stop before guessing.

Do not commit or push.
Do not run destructive git commands.
Do not rerun old Guild 1 migrations.

After implementation, run npm run build and report:
- files changed,
- SQL that I must apply manually,
- E2E tests I must perform,
- anything still unverified.
```

---

# 8. 일상적인 작업 사이클

Codex 수정 후:

```powershell
git status
```

변경 내용 확인:

```powershell
git diff
```

빌드:

```powershell
npm run build
```

필요할 때만:

```powershell
npm run dev
```

`npm ci`는 매번 하지 않는다.

다음 경우에만:

- 처음 받은 새 환경
- node_modules 없음
- dependency/lockfile 변경
- 깨끗한 재설치가 필요함

---

# 9. 작은 checkpoint commit

Guild 2가 한 번에 완성되지 않아도,
작동하는 중간 단계라면 feature branch에 commit해도 된다.

예:

```powershell
git add .
git commit -m "feat(guild): add GS ledger foundation"
```

다음:

```powershell
git add .
git commit -m "feat(guild): add contribution session and observation scoring"
```

버그 수정:

```powershell
git add .
git commit -m "fix(guild): correct four-member compensation calculation"
```

추천 prefix:

- `feat:` 새 기능
- `fix:` 버그
- `docs:` 문서
- `refactor:` 동작 변경 없는 구조 정리
- `chore:` 설정/환경/기타

commit 메시지는 완벽할 필요 없다.
“어디까지 되돌릴 수 있는 지점인지” 알 수 있으면 된다.

---

# 10. E2E 통과 전에는 main에 merge하지 않기

Codex build가 성공했다고 COMPLETE가 아니다.

브라우저에서 실제 teacher/student E2E를 한다.

문제가 있으면 계속 feature branch에서 수정한다.

main은 건드리지 않는다.

그래서 Guild 2가 망가져도:

```powershell
git switch main
```

하면 즉시 Guild 1 안정판으로 돌아갈 수 있다.

---

# 11. Guild 2 최종 통과 후 merge

먼저 feature branch에서 마지막 상태 확인:

```powershell
git status
npm run build
```

미커밋 변경이 있으면 commit:

```powershell
git add .
git commit -m "feat(guild): complete Guild 2 GS engine"
```

main 이동:

```powershell
git switch main
```

merge:

```powershell
git merge --no-ff feature/guild2-gs-engine
```

이제 main이 Guild 2 포함 안정판.

tag:

```powershell
git tag -a guild2-complete -m "Guild 2 complete"
```

확인:

```powershell
git log --oneline --decorate --graph -15
```

---

# 12. feature branch 삭제

Guild 2 merge 및 E2E가 완전히 끝난 뒤에만:

```powershell
git branch -d feature/guild2-gs-engine
```

삭제하지 않아도 문제는 없다.

---

# 13. 자주 쓰는 명령 8개

```powershell
git status
```
현재 상태.

```powershell
git diff
```
아직 commit하지 않은 변경.

```powershell
git diff --staged
```
staging한 변경.

```powershell
git log --oneline --decorate --graph -15
```
최근 history.

```powershell
git branch
```
branch 목록.

```powershell
git switch main
```
안정판으로 이동.

```powershell
git switch feature/guild2-gs-engine
```
작업 branch로 이동.

```powershell
git show guild1-complete
```
Guild 1 완료 snapshot 확인.

---

# 14. 실수했을 때

## 아직 commit하지 않은 한 파일을 버리고 싶음

```powershell
git restore "src/path/File.tsx"
```

주의: 그 파일의 미커밋 수정이 사라진다.

## 실수로 staging함

코드는 유지하고 staging만 취소:

```powershell
git restore --staged "src/path/File.tsx"
```

또는 전체:

```powershell
git restore --staged .
```

## 이미 commit한 버그를 안전하게 취소

초보일 때는 history를 지우는 reset보다 `revert`를 추천.

먼저:

```powershell
git log --oneline
```

취소할 commit:

```powershell
git revert COMMIT_HASH
```

취소 자체가 새 commit으로 남는다.

---

# 15. 당분간 피할 명령

익숙해질 때까지 직접 쓰지 않는 것을 권장:

```text
git reset --hard
git clean -fd
git push --force
git rebase
git checkout -- .
```

Codex에게도 AGENTS.md에서 기본 금지해 둔다.

---

# 16. Supabase migration과 Git의 차이

매우 중요하다.

Git으로 코드 commit을 되돌린다고,
이미 Supabase에 실행한 SQL migration이 자동으로 되돌아가지는 않는다.

예:

1. migration SQL을 commit
2. Supabase에 실행
3. 나중에 Git branch를 과거로 이동

→ DB는 여전히 migration이 적용된 상태다.

따라서 DB 변경은 항상:

- incremental migration
- preflight
- postcheck
- 필요 시 explicit rollback/reversal plan

으로 관리한다.

이미 production에 적용한 migration 파일을 나중에 고쳐서 history를 바꾸지 않는다.
새 correction migration을 추가한다.

---

# 17. Optional: GitHub private backup

로컬 Git만으로도 버전 관리는 된다.

하지만 PC 고장/실수에 대비하려면 private remote repo를 하나 두는 것이 좋다.

GitHub에서 빈 private repository를 만든 뒤,
GitHub가 보여주는 remote URL을 사용:

```powershell
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
git push origin --tags
```

feature branch도 백업하고 싶으면:

```powershell
git push -u origin feature/guild2-gs-engine
```

`.env.local`과 secrets가 commit되지 않았는지 반드시 먼저 확인한다.

---

# 18. Recommended B.R.A.N.D branch rhythm

```text
main
  |
  |-- tag: guild1-complete
  |
  +-- feature/guild2-gs-engine
       |
       +-- small commits
       |
       +-- E2E PASS
       |
       +---- merge ----> main
                         |
                         |-- tag: guild2-complete
                         |
                         +-- feature/guild3-mission
```

이 패턴만 유지해도 ZIP 파일 수십 개를 관리할 필요가 거의 없어진다.

---

# 19. Rule of thumb

**main = 학생들에게 보여줘도 되는 현재 안정판**

**feature branch = 지금 뜯어고치는 작업장**

**commit = 복구 지점**

**tag = 큰 단계 COMPLETE 표지판**

이 네 문장만 기억하면 된다.
