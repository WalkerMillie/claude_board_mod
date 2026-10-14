# work-board

Claude Code 의 자동 메모리(`MEMORY.md`)를 카드 보드 패널로 보여 주는 mod 입니다.

- `/board` 를 입력하면 패널이 열립니다. 하루(KST) 중 처음 여는 새 세션에서도, 메모가 있는 프로젝트라면 한 번 자동으로 열립니다.
- 지금 세션이 실행되는 폴더를 기준으로 그 프로젝트의 메모 폴더(`~/.claude/projects/<프로젝트>/memory`)를 자동으로 찾습니다. 하위 폴더나 git 워크트리에서 실행해도 같은 메모를 찾습니다.
- 카드를 누르면 상세 화면이 열리고, 남은 조치·주의 사항·메모 본문을 볼 수 있습니다. 상세 화면에서는 이전/다음 카드로 이동하거나 메모 파일을 편집기(VSCode, 없으면 기본 텍스트 편집기)로 열 수 있습니다.
- 위쪽의 `전체`·`남은 조치`·`주의`·`보류` 버튼으로 걸러 보고, 검색칸에 입력하면 제목·남은 조치·주의 사항을 함께 검색합니다.

## 메모를 읽는 방식

- `MEMORY.md` 에 `## 활성 작업` 과 `## 보류·미착수` 섹션이 있으면, 그 안의 ★ 표시 줄만 날짜 순으로 보여 줍니다(오늘·어제·이번 주·이번 달·그 이전).
- 그런 섹션이 없는 일반 `MEMORY.md` 라면, 링크가 달린 모든 줄을 `## ` 제목별로 묶어서 보여 줍니다.
- 한 줄 안에서 `남음=…` 은 남은 조치로, `🔴…` 은 주의 사항으로 따로 표시합니다.

```markdown
## 활성 작업
- [★10-13 결제 모듈 교체 — PR 머지 · 남음=운영 배포·모니터링 · 🔴롤백 스크립트 미검증](project_payment_20261013.md)
```

## 설치 (macOS)

Claude Code CLI 2.1.290 이상이 필요합니다. 터미널에서 아래 두 줄을 실행합니다.

```bash
claude plugin marketplace add WalkerMillie/claude_board_mod
```

```bash
claude plugin install work-board@claude-board-mod
```

설치한 뒤에 새로 여는 세션부터 적용됩니다. Claude 데스크톱 앱의 Code 탭에서도 새 세션을 열면 `/board` 를 쓸 수 있습니다.

## 업데이트

```bash
claude plugin marketplace update claude-board-mod && claude plugin update work-board@claude-board-mod
```

## 삭제

```bash
claude plugin uninstall work-board@claude-board-mod
```

## 개발

```bash
claude plugin validate . && claude plugin test .
```
