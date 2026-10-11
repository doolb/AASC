# Qwen API错误提示与WAV排查

日期：2026-10-11。状态：Qwen API与豆包API错误原因打印已实现并验证；原WAV问题待音频复现。

## 任务与需求

用户报告Qwen API逐句“TTS WAV 块不完整”，后要求实际错误原因加入打印。按现有失败日志显示明确、脱敏的已知上游错误码和中文提示。设计与声明级伪代码见docs/design/tts-providers.md和docs/spec/tts-providers.md，先同步spec再写代码。v64已完成发布，本轮日志提示已实现，原WAV故障仍未确定根因。

## 需求等级分析

使用analyze-requirement-level enterprise模式。错误提示范围已明确；WAV根因仍缺少原始音频。Qwen API与豆包API日志改进主等级L6（错误输出契约）、实施能力L4，建议下放为限量读取、已知码映射、既有打印三步，无需架构变更。错误提示方案已获确认，可开发；WAV修复需补充。错误码打印部分评分：层级清晰度24/25、证据充分度18/20、实现完备度18/20、风险暴露度19/20、L4可落地性14/15，总分93/100，置信度0.90。

证据：用户明确要求“这些错误提示应该加到打印上”（强，输出契约）；修复前HTTP层非2xx立即拒绝，丢弃上游业务码（强，实施断点）；真实HTTP 400/Arrearage，修复前日志仅HTTP状态（强，验证输入）。WAV复现缺失与错误提示契约分开评估。

WAV待补充：输入输出缺少原始音频头与实际字节，建议只提取长度元数据，否则可能把截断误当兼容头；依赖约束当前API欠费，需可成功请求的账户，否则无法确认上游格式；验收证据缺少原文本同模型/音色实测，需合成成功并严格校验后确认，否则不能宣称修复。

## 文件与实施流程

- tts-provider-http.js：按显式选项在原总时限内限量读取失败响应；默认调用行为保持。
- tts-provider-registry.js及小型错误映射模块：Qwen API仅映射已知业务码到固定提示，HTTP与200业务错误共用映射。
- tests/tts-provider-integration.test.js：覆盖错误映射、边界、无泄露、无缓存、下载无鉴权和恢复成功。
- docs/self-test.md与受影响文档、release/offline-release-status.json：实施后同步；仅代码改动后将servicePackage设为true。

已取得前轮方案确认，先同步伪代码后实现，并将已完成日志需求从todo移除，保留WAV待复现条目。用户本轮确认后已完成实现；豆包context_texts仅核查，当前尚未接入。

## 自测、兼容性与性能

已完成：现有tts-provider-integration.test.js六项基线全部通过；标准524字节WAV通过；未知data大小0xffffffff与截断522字节样本均复现“TTS WAV 块不完整”。当前独立API请求HTTP 400/Arrearage，无音频、无播放、无配置改动，密钥及签名URL未输出。

实施后：验证欠费、鉴权、权限、参数、限流、200业务失败；未知、非JSON、超限、断开响应仅固定提示，恶意message及错误码不能泄露密钥。正常Qwen API与豆包/system/qwen-chat保持，原超时、容量和完整音频校验不放宽。运行TTS定向回归及只读自测；错误响应容量固定较小、沿用总时限，禁止无限收集或重试。

## 风险与预计工时

错误码目录不完整时回退固定HTTP提示，后续按官方证据补充白名单。WAV原始样本缺失时不实施宽松校验，避免缓存半成品。错误打印实现及回归预计1小时；WAV根因排查取决于可用API或完整样本，不承诺当前已修复。当前不发布新包；完成后另行按授权和版本规则出包。

## 完成与验证

修改tts-provider-http.js与tts-provider-registry.js，新增tts-provider-errors.js，补充集成测试。错误体最多16KiB，沿用请求总时限；白名单码固定中文输出，豆包已知共用码仅检查官方标记，未知/非JSON/超限/中断回退固定HTTP提示，原始message与签名URL不进入错误对象。映射回调异常或非Error返回仍保持HTTP失败。

`node --test tests/tts-provider-integration.test.js`52/52；扩大至settings/ws/qwen-chat/system-route/chat-manual/agent-chat/server-concurrency共96/96，无失败或跳过。3个生产JS `node --check`通过。package.json仅提供全仓test，当前使用定向Node测试验证受影响模块，未运行全仓测试。真实当前百炼生产适配器请求返回HTTP 400/Arrearage并显示固定中文欠费提示，无音频下载。测试日志位于.cache/tts-errors-integration-test.log和.cache/tts-errors-regression.log，不提交。

servicePackage=true，minApk=true、dependenciesPackage=false维持。没有生成APK、生产依赖或新服务包；v64不含本轮改动。原WAV音频仍未取得，不放宽任何音频校验。

通过`npm run restart:server`重启本机8081；静态TTS脚本HTTP 200，正确/control WebSocket初始化收到ttsProviderConfig，服务恢复。
