# Checklist

## store.ts 修复

- [x] 第 45 行条件判断已修复：`!name` 改为 `name !== null`
- [x] 第 52 行条件判断已修复：`!name` 改为 `name !== null`
- [x] lastAnchor() 查询能正确返回锚点索引（name=null 时匹配任意锚点）
- [x] Tape.chat() 多轮对话能正常工作
