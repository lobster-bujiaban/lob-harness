export const PROMO_VIDEO_PROMPT = `请把当前工作区的开源仓库制作成一条适合抖音发布的项目宣传视频，最终交付有声 MP4。核心目标是让目标用户看懂这个项目的价值，并愿意到 GitHub 查看、使用或 Star。

输入：
- 源码范围：当前工作区全部内容
- 输出根目录：videos
- 项目名、GitHub 地址和项目 Logo：从当前工作区、Git remote、README 和 manifest 自动识别
- 创作者品牌：虾哥不加班
- 本地音频目录：无

要求：
1. 先调用 \`video_analyze_source\`，不传 path，默认分析当前工作区全部内容。根据 README、manifest、入口文件、Git remote 和 Logo 候选确认：项目名、项目定位、解决的问题、目标用户、主要能力、差异点和 GitHub 仓库地址。
2. 内容目标是宣传当前开源仓库。选择最能让目标用户产生兴趣的叙事主线，可以是痛点与效果、核心能力、真实使用场景、同类差异或关键机制；不强制包装成一个工程问题，也不要机械朗读功能列表。
3. 方案填写从当前项目推导出的 \`slug\`、\`projectName\`、\`projectIdentity\`、\`sourcePath: "."\`、searchableTitle、2～5 个 searchKeywords 和至少 2 个 saveValue。第一幕必须明确出现真实项目名，并在前几秒说清“它是什么、能帮用户做什么”。
4. 项目卖点必须有本地证据。技术事实场景提供 \`evidence\`，每条包含真实的 \`file\`、\`lineStart\`、\`lineEnd\`、\`claim\` 和 \`kind\`；至少引用 2 个相关文件。README 可以证明公开定位和使用方式，源码、配置或测试用于证明实现能力。不得编造效果、性能、用户量、Star 数或平台规则。
5. 推荐结构：项目名与核心价值 → 用户痛点/使用场景 → 主要能力或效果 → 1～3 个可信实现证据 → 适用人群与边界 → GitHub 行动引导。根据内容选择 3～16 个场景、30 秒～20 分钟，并至少使用 3 种画面类型（对照、流水线/回环、双栏、暗色原则页、边界卡）。纸面手绘编辑感：每帧构图不同，用划痕、描边、标记扫强调；不要每帧同一套标题加青条。
6. 第一帧必须显示项目名、当前项目 Logo（存在时）、“虾哥不加班公开研发”和真实 GitHub 仓库；全片保留项目名、作者和 GitHub 文字角标；结尾明确展示 \`owner/repo\`，引导用户去 GitHub 查看源码、使用或 Star，并关注“虾哥不加班”。GitHub 引导是主交付要求，不是附属角标。仓库路径字幕显示 \`owner/repo\`；旁白不要读出 \`-\`、\`/\`、下划线，也不要说「斜杠」「减号」。
7. 只使用当前项目中自动识别或明确指定的项目 Logo。没有 Logo 时使用项目名文字标识；严禁二维码、扫码引导和工作区外品牌图片。
8. 调用 \`video_create_hyperframes\`，传入 \`outputDir: "videos"\`；工程直接写在 \`videos/\`，不要再套一层 slug 目录。配音和渲染的 \`projectDir\` 也传 \`videos\`。如果返回 \`needs_revision\` 或任一硬检查失败，修订方案后重新创建。
9. 当前没有本地音频；直接调用 \`video_generate_voice\`。配音失败或任何场景缺少音频时，不得声称交付完成。
10. 调用 \`video_render_hyperframes\` 完成 check 和 render。只有工具真实返回非空 MP4 且 audioScenes 等于 totalScenes 时才算完成；最终报告 MP4、文件大小、发布文案、视频方案和源码证据清单的真实路径。
`;
