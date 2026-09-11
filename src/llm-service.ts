import { Context, Service } from "@deepseek-ai/cordis";
import type { LlmClient } from "./llm.ts";
import {
  LlmSettingsStore,
  type PublicLlmSettings,
  type UpdateLlmSettings,
  type DiscoverModelsInput,
} from "./llm-settings.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    llm: LlmService;
  }
}

export interface LlmProviderService {
  create(prompt: string): Promise<LlmClient>;
  describe(): Promise<PublicLlmSettings>;
  update(input: UpdateLlmSettings): Promise<PublicLlmSettings>;
  discoverModels?(input: DiscoverModelsInput): Promise<string[]>;
}

/** Cordis 模型能力：运行时消费者不再依赖设置存储或具体协议适配器。 */
export class LlmService extends Service implements LlmProviderService {
  constructor(ctx: Context, private readonly provider: LlmProviderService) {
    super(ctx, "llm");
  }

  create(prompt: string): Promise<LlmClient> {
    return this.provider.create(prompt);
  }

  describe(): Promise<PublicLlmSettings> {
    return this.provider.describe();
  }

  update(input: UpdateLlmSettings): Promise<PublicLlmSettings> {
    return this.provider.update(input);
  }

  discoverModels(input: DiscoverModelsInput): Promise<string[]> {
    if (this.provider.discoverModels === undefined) throw new Error("当前模型提供方不支持获取模型目录");
    return this.provider.discoverModels(input);
  }
}

export function settingsLlmProvider(settings: LlmSettingsStore): LlmProviderService {
  return {
    create: (prompt) => settings.createLlm(prompt),
    describe: () => settings.describe(),
    update: (input) => settings.update(input),
    discoverModels: (input) => settings.discoverModels(input),
  };
}
