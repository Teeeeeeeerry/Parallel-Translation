#!/usr/bin/env bash
# 提交信息约定 CI 校验（#138）：避免人工把关遗漏
# 规则（CONTEXT.md 约定）：
#   1. fix 类提交信息须含根因箭头（「→」或「—」）与 issue 编号（#N）
#   2. 含 fix 提交的 PR 须一并 bump package.json 版本号
# 用法: check-commit-conventions.sh <base-sha> <head-sha>
set -euo pipefail

BASE_SHA=${1:?usage: check-commit-conventions.sh <base-sha> <head-sha>}
HEAD_SHA=${2:?usage: check-commit-conventions.sh <base-sha> <head-sha>}

fail=0

# 1. fix 提交信息检查
echo "== 检查 fix 提交信息（根因 + issue 编号）=="
while IFS= read -r subject; do
  [ -z "$subject" ] && continue
  case "$subject" in
    fix:* | fix\(*)
      echo "  $subject"
      if ! grep -qE '→|—' <<<"$subject"; then
        echo "  [失败] 缺少根因箭头（「→」或「—」，格式: 根因 → 现象）"
        fail=1
      fi
      if ! grep -qE '#[0-9]+' <<<"$subject"; then
        echo "  [失败] 缺少 issue 编号（#N）"
        fail=1
      fi
      ;;
  esac
done < <(git log --format=%s "$BASE_SHA..$HEAD_SHA")

# 2. fix PR 须 bump 版本号（同 PR 内即可，无需同提交）
if git log --format=%s "$BASE_SHA..$HEAD_SHA" | grep -qE '^fix'; then
  echo "== 检查 package.json 版本 bump =="
  base_v=$(git show "$BASE_SHA:package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')
  head_v=$(git show "$HEAD_SHA:package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')
  echo "  base: $base_v  head: $head_v"
  if [ "$head_v" = "$base_v" ]; then
    echo "  [失败] fix PR 未 bump package.json 版本号（$base_v → $head_v）"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "校验未通过"
  exit 1
fi
echo "校验通过"
