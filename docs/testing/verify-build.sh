#!/usr/bin/env bash
# verify-build.sh — 构建产物审计：确保测试文件未泄漏进扩展包
#
# 在 pnpm build 之后运行。检查 .output/ 中是否存在测试相关文件。
# 若发现任何测试文件，以非零退出码失败。
#
# 用法:
#   pnpm build && bash docs/testing/verify-build.sh
#   pnpm test:verify-build

set -euo pipefail

OUTPUT_DIR=".output"
TEST_PATTERNS=(
  '*.test.*'
  '*.spec.*'
  'testing/'
  '__tests__/'
  'vitest.config.*'
  'playwright.config.*'
  '*.test.ts'
  '*.spec.ts'
)

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "🔍 扫描构建产物中的测试文件…"
echo ""

FOUND=0

for dir in "$OUTPUT_DIR"/*/; do
  if [[ ! -d "$dir" ]]; then continue; fi
  browser_name=$(basename "$dir")
  echo "  检查 $browser_name …"

  for pattern in "${TEST_PATTERNS[@]}"; do
    matches=$(find "$dir" -name "$pattern" -o -path "*/$pattern" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo -e "    ${RED}✗ 发现: $matches${NC}"
      FOUND=$((FOUND + 1))
    fi
  done
done

echo ""

if [[ $FOUND -gt 0 ]]; then
  echo -e "${RED}❌ 构建产物中发现 $FOUND 个测试文件！${NC}"
  echo "   测试文件不应进入扩展包。请检查源文件导入路径。"
  exit 1
else
  echo -e "${GREEN}✅ 构建产物中无测试文件泄漏${NC}"
fi
