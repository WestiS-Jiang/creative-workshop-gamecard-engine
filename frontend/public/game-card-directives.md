# 游戏卡导演批注语法

在游戏卡（Markdown 文件）中，你可以使用 HTML 注释形式的批注来精确控制引擎行为。这些批注对游戏内容完全透明——不写任何批注，一切照旧运行；写了，引擎会优先使用你的设定。

## 语法格式

```
<!--@指令名 参数 -->
```

或带冒号的键值形式：

```
<!--@指令名: 值 -->
```

批注可以写在游戏卡的**任意位置**，引擎会在加载时全文扫描提取。建议集中放在文档开头或结尾，方便维护。

---

## 一、角色语音 `@voice`

控制 TTS 语音合成的音色。引擎默认会由 AI 自动推断角色声线，但如果你对角色的声音有明确想象，可以手动指定。

### 语法

```
<!--@voice 角色名: 音色描述 -->
```

### 音色描述格式

建议以 `XX岁左右，男性/女性，` 开头，然后描述声音特质：

- **音质**：低沉 / 清亮 / 沙哑 / 磁性 / 稚嫩 / 苍老
- **语速**：极快 / 偏快 / 适中 / 偏慢 / 极慢
- **习惯**：尾音上扬 / 咬字清晰 / 吞音 / 带鼻音 / 句尾叹气
- **情感基调**：慵懒 / 严肃 / 活泼 / 冷淡 / 温柔

### 示例

```
<!--@voice 林黛玉: 18岁左右，女性，气息微弱的柔软嗓音，语速偏慢，句尾常带叹息感，像是随时会消散 -->
<!--@voice 孙悟空: 30岁左右，男性，高亢洪亮，语速极快，带痞气的嬉笑腔调，重音夸张 -->
<!--@voice 旁白: 40岁左右，男性，低沉沙哑的播音腔，不疾不徐，字正腔圆 -->
```

> **提示**：`旁白` 是一个特殊角色名，用于控制叙述旁白的语音。

---

## 二、语音朗读 `@tts`

控制游戏中哪些内容需要 TTS 语音朗读，以及朗读速度。默认情况下，玩家角色、NPC、旁白的语音朗读都开启，语速为 1.0x。

### 语法

控制朗读开关（可组合多个）：

```
<!--@tts-player: off -->
<!--@tts-npc: on -->
<!--@tts-narration: off -->
```

控制朗读速度（0.7 ~ 1.5）：

```
<!--@tts-speed: 1.2 -->
```

全部关闭语音的快捷方式：

```
<!--@tts: off -->
```

控制立绘显示：

```
<!--@portrait-player: off -->
<!--@portrait-npc: on -->
```

控制自动推进（朗读完一句后自动播放下一句）：

```
<!--@auto-advance: on -->
```

### 参数说明

| 指令 | 说明 | 默认值 |
|---|---|---|
| `@tts` | 总开关，`off` 关闭所有语音 | `on` |
| `@tts-player` | 玩家角色台词朗读 | `on` |
| `@tts-npc` | NPC 台词朗读 | `on` |
| `@tts-narration` | 旁白叙述朗读 | `on` |
| `@tts-speed` | 朗读速度倍率（0.7 ~ 1.5） | `1.0` |
| `@portrait-player` | 显示玩家角色立绘 | `on` |
| `@portrait-npc` | 显示 NPC 立绘 | `on` |
| `@auto-advance` | 自动推进对话（朗读结束后自动下一句） | `off` |

### 示例

恐怖游戏中只保留旁白朗读，隐藏所有立绘，营造低语氛围：

```
<!--@tts-player: off -->
<!--@tts-npc: off -->
<!--@tts-narration: on -->
<!--@tts-speed: 0.8 -->
<!--@portrait-player: off -->
<!--@portrait-npc: off -->
```

快节奏喜剧，加快语速，开启自动推进：

```
<!--@tts-speed: 1.3 -->
<!--@auto-advance: on -->
```

纯文字阅读体验，关闭所有语音和立绘：

```
<!--@tts: off -->
<!--@portrait-player: off -->
<!--@portrait-npc: off -->
```

> **提示**：玩家仍可在游戏内设置菜单中覆盖这些默认值。

---

## 三、角色性格 `@persona`

锚定角色的说话方式和性格特征。在长线游戏中，AI 可能让角色"串味"——冷酷杀手突然说出温柔台词。`@persona` 会在每轮对话生成时注入角色约束，确保一致性。

### 语法

```
<!--@persona 角色名: 性格与说话风格描述 -->
```

### 描述要点

- **语言风格**：用词偏好、句式习惯、常用口头禅
- **情感倾向**：外向/内敛、坦率/含蓄、热情/冷淡
- **行为模式**：生气时会怎样、紧张时会怎样、高兴时会怎样

### 示例

```
<!--@persona 林黛玉: 说话含蓄婉转，常用反问和自嘲，从不直接表达需求，擅长用诗词典故暗示心意。生气时反而更安静，悲伤时用笑容掩饰。 -->
<!--@persona 孙悟空: 口无遮拦，自称"俺老孙"，爱吹嘘，但关键时刻意外靠谱。对唐僧嘴硬心软，对妖怪毫不留情。 -->
<!--@persona 诸葛亮: 语气永远从容不迫，惯用排比和反问，喜欢引经据典。即使面临绝境也保持微笑，用沉默制造压迫感。 -->
```

---

## 四、角色立绘 `@portrait`

控制 AI 生成角色立绘时使用的外貌描述。如果不指定，引擎会从游戏卡文本中自动推断角色外貌。

### 语法

```
<!--@portrait 角色名: 英文外貌描述 -->
```

### 描述要点

描述应使用英文（用于图像生成 prompt），包含：

- **基础特征**：性别、年龄、肤色、体型
- **发型发色**：长度、颜色、样式
- **五官特征**：标志性特征（疤痕、痣、眼色）
- **默认服装**：日常穿着风格

### 示例

```
<!--@portrait 林黛玉: Young woman, 16-17 years old, East Asian, delicate slender build, pale porcelain skin, long straight black hair with side-swept bangs, melancholic almond eyes, wearing flowing white silk hanfu with light green embroidery -->
<!--@portrait 孙悟空: Athletic male figure, golden eyes with vertical pupils, wild auburn hair held by a golden headband, mischievous grin, wearing tiger-skin skirt and golden chainmail, carrying a golden staff -->
```

---

## 五、画风 `@art`

预设游戏的画面风格。玩家仍可在游戏内切换，但这里设定的是默认值。

### 语法

方式一：使用预设风格名

```
<!--@art: 预设名 -->
```

方式二：自定义画风描述（英文）

```
<!--@art-prompt: 画风描述 -->
```

### 可用预设名

| 预设名 | 说明 |
|---|---|
| `auto` | 自动（由 AI 根据游戏卡推断，默认值） |
| `cinematic` | 电影纪实 |
| `casual_photo` | 生活写实 |
| `cctv` | CCTV 监控风格 |
| `next_gen_3d` | 次世代 3D 渲染 |
| `idol_drama` | 偶像剧 |
| `fashion_comic` | 时尚漫画（JOJO 风） |
| `ghibli` | 手绘动漫（吉卜力风） |
| `animation_3d` | 3D 动画 |
| `impressionist_oil` | 印象油画 |
| `retro_scifi_anime` | 科幻复古动漫 |
| `ink_xianxia` | 现代水墨仙侠 |
| `american_comic` | 美式漫画 |
| `otome` | 浪漫乙女风 |
| `gothic_folk_horror` | 哥特民俗恐怖 |
| `grotesque_ink_horror` | 怪诞墨迹恐怖 |
| `dark_footage` | 黑暗录像 |
| `modern_cartoon` | 现代卡通渲染 |
| `healing_watercolor` | 治愈系水彩 |
| `acid_pop` | 酸性波普涂鸦 |
| `gongbi` | 新国风工笔插画 |
| `manhwa` | 韩漫风 |
| `retro_pixel` | 复古像素 |

### 示例

```
<!--@art: ink_xianxia -->
```

```
<!--@art-prompt: Dark academia aesthetic, candlelit library, leather-bound books, warm sepia tones, oil painting texture, golden hour lighting -->
```

> **注意**：如果同时写了 `@art` 和 `@art-prompt`，`@art-prompt` 优先。

---

## 六、对话风格 `@dialogue`

控制 AI 生成对话时的整体写作风格。适合对叙事基调有明确要求的作者。

### 语法

```
<!--@dialogue: 风格描述 -->
```

### 示例

```
<!--@dialogue: 模仿鲁迅的冷峻笔触，多用短句，善用反讽和隐喻。对话要克制，角色很少直接表达情感。 -->
```

```
<!--@dialogue: 轻松搞笑的风格，角色经常吐槽和玩梗，旁白偶尔打破第四面墙，整体节奏明快。 -->
```

```
<!--@dialogue: 古典文言风格，对话使用半文半白的语体，旁白带有章回体小说的韵味，多用四字短语和对偶句。 -->
```

---

## 七、背景音乐 `@bgm`

控制引擎选择背景音乐时的偏好。引擎会从曲库中匹配最接近的音轨。

### 语法

指定偏好标签（从曲库中筛选）：

```
<!--@bgm: 标签1, 标签2, 标签3 -->
```

排除不想要的标签：

```
<!--@bgm-avoid: 标签1, 标签2 -->
```

### 常用标签

`piano`, `ambient`, `orchestral`, `electronic`, `acoustic`, `strings`, `epic`, `calm`, `mystery`, `tension`, `battle`, `romantic`, `melancholy`, `horror`, `jazz`, `folk`, `cinematic`, `lofi`, `chiptune`

### 示例

```
<!--@bgm: piano, ambient, melancholy -->
<!--@bgm-avoid: epic, electronic, battle -->
```

> 标签不需要精确匹配曲库——引擎会做模糊匹配，选择最接近的音轨。

---

## 八、面板复杂度 `@panels`

控制引擎生成状态面板的数量和类型。纯叙事游戏不需要复杂的属性面板；策略类游戏则需要丰富的数据展示。

### 语法

```
<!--@panels: 级别 -->
```

### 可用级别

| 级别 | 说明 | 适用场景 |
|---|---|---|
| `none` | 不生成任何面板 | 短篇故事、纯沉浸叙事 |
| `minimal` | 仅保留 1-2 个核心面板 | 轻量互动小说 |
| `standard` | 默认，3-5 个面板 | 大多数文字 RPG |
| `rich` | 鼓励丰富面板 | SLG、策略、经营类 |

### 示例

```
<!--@panels: none -->
```

---

## 九、图像生成模型 `@image-model`

指定角色立绘和场景图使用的 AI 图像生成模型。

### 语法

```
<!--@image-model: 模型名 -->
```

### 可用模型

| 模型名 | 说明 |
|---|---|
| `qwen` | 通义万相（默认，速度快） |
| `gemini` | Gemini Flash（质量高，较慢） |

### 示例

```
<!--@image-model: gemini -->
```

---

## 完整示例

以下是一个游戏卡开头部分的示例，展示如何组合使用多种批注：

```markdown
# 红楼幻梦

一个基于《红楼梦》世界观的互动故事。

<!--@art: ink_xianxia -->
<!--@panels: minimal -->
<!--@bgm: piano, ambient, melancholy -->
<!--@bgm-avoid: epic, battle, electronic -->
<!--@dialogue: 古典半文言风格，对话婉约含蓄，旁白带有章回体韵味。 -->

<!--@tts-speed: 0.9 -->

<!--@voice 林黛玉: 18岁左右，女性，气息微弱的柔软嗓音，语速偏慢，句尾常带叹息，像是随时会消散 -->
<!--@voice 贾宝玉: 17岁左右，男性，清亮少年嗓音，语速偏快，情绪外露，激动时会结巴 -->
<!--@voice 旁白: 50岁左右，男性，沉稳的说书人嗓音，不疾不徐，尾音悠长 -->

<!--@persona 林黛玉: 说话含蓄婉转，常用反问和自嘲，擅长用诗词暗示心意。生气时更安静，悲伤时笑着掩饰。口头禅：不过是……罢了。 -->
<!--@persona 贾宝玉: 热情直率，见到姐姐妹妹就嬉皮笑脸，但面对仕途话题立刻变脸。动不动就发誓赌咒，真情流露时反而说不出话。 -->

<!--@portrait 林黛玉: Young woman, 16-17, East Asian, delicate slender build, pale porcelain skin, long straight black hair with side-swept bangs, melancholic almond eyes, light green silk hanfu with floral embroidery -->
<!--@portrait 贾宝玉: Young man, 16-17, East Asian, handsome fair-skinned face, bright expressive eyes, jade pendant on forehead, red silk robe with gold trim, scholarly yet mischievous demeanor -->

## 排版规则
……（后续正常的游戏卡内容）
```

---

## 批注与私人定制的关系

游戏内的「私人定制」面板允许玩家在游戏过程中实时调整画风、对话风格、角色语音和立绘。批注的作用是**预设默认值**——它们在游戏启动时生效，但玩家仍可通过私人定制面板覆盖。

| 批注 | 对应的私人定制功能 |
|---|---|
| `@voice 角色名` | 角色语音音色 |
| `@voice 旁白` | 旁白语音音色 |
| `@tts` / `@tts-player` / `@tts-npc` / `@tts-narration` | 语音朗读开关（玩家 / NPC / 旁白） |
| `@tts-speed` | TTS 语速滑块 |
| `@portrait-player` / `@portrait-npc` | 立绘显示开关（玩家 / NPC） |
| `@auto-advance` | 自动推进开关 |
| `@art` / `@art-prompt` | 画面风格选择 / 自定义画风描述 |
| `@dialogue` | 对话风格提示词 |
| `@portrait 角色名` | 角色立绘基础描述 |
| `@bgm` | BGM 标签偏好 |
| `@panels` | （私人定制中暂无对应项） |
| `@image-model` | 图像生成模型选择 |

---

## 设计原则

1. **全部可选**：不写任何批注，游戏完全正常运行，一切由 AI 自动推断
2. **全局生效**：批注控制的是整场游戏的默认参数，不涉及条件分支或章节逻辑
3. **玩家可覆盖**：批注设定的是起点，玩家可以通过私人定制面板随时修改
4. **只管呈现，不管内容**：批注控制的是"声音听起来怎样"、"画面看起来怎样"，而不是"故事怎么走"——后者完全由你的游戏卡文本决定
