# 函数注解添加规范 Spec

## Why
当前代码库中的函数缺少统一的 JSDoc 注解，影响代码可读性和 IDE 支持。添加规范的函数注解可以提升代码质量，便于开发者理解函数用途、参数和返回值。

## What Changes
- 对 `packages/republic/src` 目录下所有类的非构造函数方法添加 JSDoc 注解
- 注解需包含：功能描述、参数说明（@param）、返回值说明（@returns）
- 已有注解的函数保留现有内容，仅补充缺失部分

## Impact
- Affected specs: 提升代码文档完整性
- Affected code:
  - packages/republic/src/core/execution.ts
  - packages/republic/src/llm.ts
  - packages/republic/src/clients/chat.ts
  - packages/republic/src/clients/text.ts
  - packages/republic/src/clients/embedding.ts
  - packages/republic/src/tools/executor.ts
  - packages/republic/src/tools/context.ts
  - packages/republic/src/tape/manager.ts
  - packages/republic/src/tape/session.ts
  - packages/republic/src/tape/store.ts
  - packages/republic/src/tape/context.ts
  - 其他相关文件

## ADDED Requirements
### Requirement: 函数注解标准化
系统 SHALL 为所有非构造函数的方法添加规范的 JSDoc 注解，注解格式如下：
```
/**
 * [函数功能描述]
 * @param [参数名] [参数描述]
 * @returns [返回值描述]
 */
```

#### Scenario: 添加函数注解
- **WHEN** 开发者查看一个未注解的公共方法
- **THEN** 该方法应包含完整的 JSDoc 注解，包含功能描述、参数和返回值说明

#### Scenario: 保留现有注解
- **WHEN** 函数已有 JSDoc 注解
- **THEN** 保留现有注解内容，不覆盖已有描述

### Requirement: 构造函数排除
**Condition**: 构造函数不需要添加 JSDoc 注解
**Reason**: 构造函数用途通过类文档或参数命名可推断
