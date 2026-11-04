# 万能文字引擎“创业工坊”核心产品定位（V1）

## 1. 产品定位（一句话）
“创业工坊”不是小说转文游的转换器，而是一个面向**玩家高自由度游玩**与**创作者灵感推演/测试**的 AI 辅助叙事与游戏开发一体化引擎。

## 2. 核心价值主张
1. 对玩家：在不牺牲世界观一致性的前提下，获得不被“剧情杀”强拉回主线的高自由度体验。
2. 对创作者：把“写-测-改”整合为一个实时闭环，通过双屏调试和时间回溯快速验证设定与分支。
3. 对平台：以统一 JSON 状态机承载多题材内容，实现可复用、可发布、可回放、可导出的内容生产链路。

## 3. 四大模块（严格对齐实现路径）

### 模块一：输入与解析引擎（Map-Reduce 转换流）
1. 输入范围（MVP）：3~10 万字 TXT/EPUB；暂不做复杂 URL 抓取。
2. Map：按章节/Token 窗口并行提取两条流。
3. 事件图谱流：提取角色、事件、物品、势力与显性关系。
4. 法则提炼流：使用探针提示词提取 `Implicit_Rules`，重点捕获隐性设定（阶级拓扑、资源消耗、因果铁律）。
5. Baseline Injection：每次 Map 前注入“世界观圣经 + 核心实体摘要”，避免无上下文切块误判。
6. Reduce：四级冲突仲裁矩阵。
7. 第一级：时序覆写与版本衰减（后章节权重更高）。
8. 第二级：全局证据密度投票（GraphRAG 频次比阈值隔离噪声）。
9. 第三级：CRA 冲突解决代理生成“AI 补丁叙事”。
10. 第四级：不可调和冲突触发平行世界分支（World Tree Bifurcation）。
11. Generate：输出第 0 回合快照、剧情树和可执行状态机。
12. 残稿补全向导：自动识别信息盲区并引导补设（手填或 AI 生成）。

### 模块二：创作者中心（创意工坊面板）
1. 双轨权限。
2. 普通级：可视化参数面板（主角人设、势力归属、属性滑块）。
3. 专家级：开放 JSON Schema + 系统 Prompt + 规则层（正则、禁忌词、边界约束）。
4. Timeline Scrubber：在剧情树任意节点设定“第 0 回合”起点（非第一章开局）。
5. 防 OOC 与幻觉：
6. 硬规则一：代理权隔离，系统只给选项，禁止替玩家决策。
7. 硬规则二：每回合强制完整状态面板刷新，确保长程状态一致性。
8. 时间步长策略：由 LLM 基于题材推荐默认值（如日粒度/周粒度），并允许创作者手动覆盖。

### 模块三：游玩与沙盒推演系统
1. Play-and-Debug 双屏。
2. 左屏：游玩渲染区（叙事与交互选项）。
3. 右屏：JSON 状态调试器（双向绑定，What-if 改属性/关系/物品）。
4. 时间回溯：支持“撤销本回合”，回滚上一个状态快照并重算。
5. 主线与蝴蝶效应并存。
6. 顺应原著：锁定主线关键结局并高保真还原名场面。
7. 自由脱轨：不剧情杀；保留世界法则与 NPC 性格，切入沙盒动态推演多结局。
8. 生命周期状态机：引擎必须支持 `INIT`、`INTRO_CINEMATIC`、`MAIN_LOOP`、`ENDING_CINEMATIC` 多阶段，不得假设始终处于文字选择态。
9. 前端渲染策略：React/Vue 根组件使用 Strategy Pattern 或状态映射按 `current_phase` 渲染；仅在 `MAIN_LOOP` 渲染左右分屏。

### 模块四：输出与内容闭环
1. 一键发布：将当前参数与分支快照固化为可分享实例。
2. 完整小说导出：按 `narrative_log` 时间流拼接为完整互动小说文本。
3. 合规策略：MVP 暂不实现审核系统，后续接敏感词/策略引擎。
4. 多媒体扩展：通过根节点 `media_assets` 统一托管 BGM、开场/结尾视频、动态立绘，保持与叙事状态机解耦。

## 4. 统一 JSON 状态机契约（MVP 必须落地）

```json
{
  "game_instance_id": "uuid",
  "genre_metadata": {
    "genre": "东方玄幻",
    "theme_style": "xuanhuan"
  },
  "current_phase": "INIT",
  "time_step_config": {
    "unit": "day",
    "value": 1,
    "source": "LLM_RECOMMENDED",
    "recommendation_reason": "玄幻题材默认日粒度"
  },
  "media_assets": {
    "bgm_tracks": [],
    "intro_cinematic": null,
    "ending_cinematic": null,
    "character_portraits": {}
  },
  "world_state": {
    "current_turn": 0,
    "time_cycle": {
      "season": "spring",
      "weather": "clear",
      "time_of_day": "morning"
    },
    "global_factions": [
      {
        "faction_id": "f_001",
        "name": "九门",
        "power_level": 78,
        "attitude_to_player": -10
      }
    ],
    "world_events": []
  },
  "player_entity": {
    "biography": {
      "name": "",
      "age": 18,
      "gender": "",
      "origin_background": ""
    },
    "core_attributes": {
      "cultivation": {
        "value": 10,
        "min": 0,
        "max": 100,
        "description": "修为"
      }
    },
    "status_effects": [
      {
        "effect_name": "内伤",
        "duration": 2,
        "impact_formula": "cultivation-5"
      }
    ],
    "inventory_system": [
      {
        "item_id": "i_001",
        "name": "洛阳铲",
        "category": "equipment",
        "quantity": 1
      }
    ],
    "equipped_gear": {
      "weapon": "i_001"
    }
  },
  "dynamic_npc_network": [
    {
      "npc_id": "n_001",
      "name": "李青",
      "social_role": "同门",
      "affinity_matrix": {
        "trust": 60,
        "fear": 5,
        "lust": 0
      },
      "relationship_tag": "师兄弟",
      "memory_flags": [
        "知道玩家曾救过自己"
      ]
    }
  ],
  "event_engine": {
    "narrative_log": "",
    "observation_data": "",
    "available_actions": [
      {
        "action_id": "a_001",
        "prompt_text": "继续修炼",
        "required_stats": {
          "cultivation": 8
        }
      }
    ]
  }
}
```

## 5. 输出协议与提示词约束（引擎硬规则）
1. Structured JSON Output 或 Function Calling 二选一，禁止自然语言裸输出。
2. 每回合响应必须同时包含：
3. `event_engine.narrative_log`
4. `event_engine.available_actions`
5. 最新全量状态快照（用于上下文强制刷新）
6. 引擎在“给出选项”后必须挂起，等待玩家输入 action_id。

## 5.1 集中式 API 管理网关（API Manager Pattern）
1. 绝对禁止在 UI 组件、页面逻辑、Map/Reduce 业务层中直接编写 `fetch` 或 `axios` 调用大模型。
2. 所有模型外部调用统一收束至 `backend/src/services/llmService.ts`。
3. 采用 Adapter Pattern 管理供应商差异，当前预留 `OPENAI_COMPAT` 与 `GEMINI`。
4. 换源仅改配置：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TASK_MODELS`。
5. 统一覆盖四类调用：Map 信息提取、Reduce 阶段 CRA 补丁生成、主循环剧情生成、后续扩展任务调用。

## 6. MVP 版本边界
1. 做：TXT/EPUB 上传、Map-Reduce 解析、冲突仲裁、双屏调试、回溯、快照发布、小说导出、Phase 生命周期渲染骨架、`media_assets` 资源清单。
2. 不做：复杂 URL 抓取、自动合规审核、跨模态资源（语音/立绘）联动。

## 7. 验收指标（首版）
1. 解析成功率：TXT/EPUB 解析并产出合法 JSON 的任务成功率 >= 95%。
2. 状态一致性：100 回合压力测试中关键字段不漂移（current_turn、core_attributes、affinity_matrix）。
3. 冲突处理：对“吃书”测试集，四级仲裁后可生成可玩状态树，阻塞率 <= 5%。
4. 创作效率：创作者完成一次“设定改动->回放验证->导出”的闭环时长下降 >= 50%。

## 8. 立即可执行的技术拆分
1. 先实现 Schema Validator 与回合状态快照存储。
2. 再实现 Map 双流抽取器（事件流/法则流）与 Reduce 冲突仲裁器。
3. 然后接入双屏前端（渲染区 + JSON 调试器）和时间回溯。
4. 最后接快照发布与 narrative_log 导出。
