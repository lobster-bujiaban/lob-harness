import type { ModelMessage } from "./session.ts";
import { Context, Service } from "@deepseek-ai/cordis";

export type SystemPromptSection = { id: string; text: string; order?: number };
export interface SystemPromptProvider {
  register(section: SystemPromptSection): () => void;
  render(): string;
  messages(): ModelMessage[];
}

/** 每次请求即时渲染；注册和撤销不进入会话权威日志。 */
export class SystemPromptRegistry {
  private readonly sections = new Map<string, SystemPromptSection & { insertion: number }>();
  private insertion = 0;

  register(section: SystemPromptSection): () => void {
    const id = section.id.trim();
    const text = section.text.trim();
    if (id.length === 0) throw new Error("system prompt section id required");
    if (text.length === 0) throw new Error("system prompt section text required");
    if (this.sections.has(id)) throw new Error(`system prompt section already registered: ${id}`);
    const stored = { ...section, id, text, insertion: this.insertion++ };
    this.sections.set(id, stored);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.sections.get(id) === stored) this.sections.delete(id);
    };
  }

  render(): string {
    return [...this.sections.values()]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.insertion - right.insertion)
      .map((section) => section.text)
      .join("\n\n");
  }

  messages(): ModelMessage[] {
    const content = this.render();
    return content.length === 0 ? [] : [{ role: "system", content }];
  }
}

export function withStepBudget(
  base: SystemPromptProvider,
  options: { remaining: number; maxSteps: number; closing?: boolean },
): SystemPromptProvider {
  return {
    register: (section) => base.register(section),
    render() {
      const hint = options.closing
        ? "工具已执行完。只输出结论，不要再调用工具。"
        : options.remaining <= 5
          ? `还剩 ${options.remaining} 步（上限 ${options.maxSteps}）。已定位就立刻 edit 改代码并给出结论；禁止 git log，禁止用 bash 改文件或继续扫前端。`
          : "";
      const text = base.render();
      if (hint.length === 0) return text;
      return text.length === 0 ? hint : `${text}\n\n${hint}`;
    },
    messages() {
      const content = this.render();
      return content.length === 0 ? [] : [{ role: "system", content }];
    },
  };
}

export function withInstructionText(
  base: SystemPromptProvider,
  text: string,
): SystemPromptProvider {
  const extra = text.trim();
  if (extra.length === 0) return base;
  return {
    register: (section) => base.register(section),
    render() {
      const rendered = base.render();
      return rendered.length === 0 ? extra : `${rendered}\n\n${extra}`;
    },
    messages() {
      const content = this.render();
      return content.length === 0 ? [] : [{ role: "system", content }];
    },
  };
}

export const defaultCodingPrompt = `你是工作区里的编码助手。用户贴出缺陷或接口报错时，要定位并改代码，不要只分析。

- 搜代码用 grep，读文件用 read_file（大文件用 offset/limit 续读）。不要用 bash grep/find/cat/sed，也不要用 list_files 扫整仓。
- HTTP 5xx 或 /device、/api 一类路径先搜服务端实现。设备 token / bz-dt 请求没有登录用户，先查 getUser() 空指针，不要改前端补参数。
- 改已有文件用 edit（old_string 必须唯一匹配）。只有新建或整文件覆盖才用 write_file。禁止 python/sed/heredoc 改文件。定位到就改，不要 git log / 翻网关。
- 用户询问“有多少/几份/数量”时，使用 list_files 的 mode=count，并按需设置 extensions 和 exclude；禁止列出全部文件后逐项计数。
- list_files 会跳过 node_modules、dist、target、build；仅查看目录结构时使用 list 模式和较小的 maxResults。`;

export const emptySystemPromptRegistry = new SystemPromptRegistry();

declare module "@deepseek-ai/cordis" {
  interface Context {
    systemPrompt: SystemPromptService;
  }
}

/** Cordis Prompt Service：section 注册属于贡献 Fiber，卸载时 disposer 自动撤销。 */
export class SystemPromptService extends Service implements SystemPromptProvider {
  constructor(ctx: Context, private readonly registry: SystemPromptProvider = new SystemPromptRegistry()) {
    super(ctx, "systemPrompt");
  }

  register(section: SystemPromptSection): () => void { return this.registry.register(section); }
  render(): string { return this.registry.render(); }
  messages(): ModelMessage[] { return this.registry.messages(); }
}
