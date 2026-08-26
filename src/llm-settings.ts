import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OpenAiCompatLlm,
  type FetchLike,
  type LlmClient,
} from "./llm.ts";

export type LlmProvider = "openai-compatible";

type SavedSettings = {
  version: 1;
  provider: LlmProvider;
  baseURL: string;
  model: string;
};

type SavedCredentials = { version: 1; apiKey: string };

export type PublicLlmSettings = Omit<SavedSettings, "version"> & {
  hasApiKey: boolean;
};

export type UpdateLlmSettings = {
  provider?: unknown;
  baseURL?: unknown;
  model?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
};

const DEFAULT_SETTINGS: SavedSettings = {
  version: 1,
  provider: "openai-compatible",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

export class LlmSettingsStore {
  private readonly settingsPath: string;
  private readonly credentialsPath: string;

  constructor(
    private readonly directory: string,
    private readonly fetchImpl?: FetchLike,
  ) {
    this.settingsPath = join(directory, "llm-settings.json");
    this.credentialsPath = join(directory, "credentials.json");
  }

  async describe(): Promise<PublicLlmSettings> {
    const [settings, credentials] = await Promise.all([
      this.readSettings(),
      this.readCredentials(),
    ]);
    return {
      provider: settings.provider,
      baseURL: settings.baseURL,
      model: settings.model,
      hasApiKey: credentials !== null,
    };
  }

  async update(input: UpdateLlmSettings): Promise<PublicLlmSettings> {
    const current = await this.readSettings();
    const provider = parseProvider(input.provider ?? current.provider);
    const baseURL = parseBaseURL(input.baseURL ?? current.baseURL);
    const model = parseModel(input.model ?? current.model);
    const clearApiKey = input.clearApiKey === true;
    const apiKey = parseOptionalApiKey(input.apiKey);

    await this.writePrivateJson(this.settingsPath, {
      version: 1,
      provider,
      baseURL,
      model,
    } satisfies SavedSettings);

    if (clearApiKey) {
      await unlink(this.credentialsPath).catch((error: unknown) => {
        if (!isErrorCode(error, "ENOENT")) throw error;
      });
    } else if (apiKey !== null) {
      await this.writePrivateJson(this.credentialsPath, {
        version: 1,
        apiKey,
      } satisfies SavedCredentials);
    }
    return this.describe();
  }

  async createLlm(_userText: string): Promise<LlmClient> {
    const settings = await this.readSettings();
    const credentials = await this.readCredentials();
    if (credentials === null) {
      throw new Error("请先在模型设置中配置 API Key");
    }
    return new OpenAiCompatLlm({
      apiKey: credentials.apiKey,
      baseURL: settings.baseURL,
      model: settings.model,
      fetchImpl: this.fetchImpl,
    });
  }

  private async readSettings(): Promise<SavedSettings> {
    const value = await readJsonFile(this.settingsPath);
    if (value === null) return DEFAULT_SETTINGS;
    if (typeof value !== "object" || value === null) throw invalidSettings();
    const raw = value as Record<string, unknown>;
    try {
      return {
        version: 1,
        // 兼容旧版落盘的 fake 设置；从此版本起只走真实模型。
        provider: raw.provider === "fake" ? "openai-compatible" : parseProvider(raw.provider),
        baseURL: parseBaseURL(raw.baseURL),
        model: migrateLegacyModel(parseModel(raw.model)),
      };
    } catch {
      throw invalidSettings();
    }
  }

  private async readCredentials(): Promise<SavedCredentials | null> {
    const value = await readJsonFile(this.credentialsPath);
    if (value === null) return null;
    if (typeof value !== "object" || value === null) throw invalidCredentials();
    const apiKey = (value as Record<string, unknown>).apiKey;
    try {
      const parsed = parseOptionalApiKey(apiKey);
      if (parsed === null) throw invalidCredentials();
      return { version: 1, apiKey: parsed };
    } catch {
      throw invalidCredentials();
    }
  }

  private async writePrivateJson(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, path);
      await chmod(path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

function parseProvider(value: unknown): LlmProvider {
  if (value === "openai-compatible") return value;
  throw new Error("provider 必须是 openai-compatible");
}

function parseBaseURL(value: unknown): string {
  if (typeof value !== "string") throw new Error("Base URL 必填");
  const text = value.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Base URL 必须是有效的 HTTP(S) 地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 必须是有效的 HTTP(S) 地址");
  }
  return text;
}

function parseModel(value: unknown): string {
  if (typeof value !== "string") throw new Error("模型名必填");
  const text = value.trim();
  if (text.length === 0 || text.length > 200 || /[\r\n]/u.test(text)) {
    throw new Error("模型名必须为 1～200 个字符");
  }
  return text;
}

function migrateLegacyModel(model: string): string {
  if (model === "v4-pro") return "deepseek-v4-pro";
  if (
    model === "v4-falsh" || model === "deepseek-chat"
    || model === "deepseek-reasoner"
  ) {
    return "deepseek-v4-flash";
  }
  return model;
}

function parseOptionalApiKey(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("API Key 格式无效");
  const text = value.trim();
  const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/u.test(text);
  const quote = text[0];
  const quoted = (quote === '"' || quote === "'" || quote === "`")
    && text.length > 1 && text.endsWith(quote);
  if (
    text.length === 0 || text.length > 4_096 || environmentLine || quoted
    || !/^[\x21-\x7e]+$/u.test(text)
  ) {
    throw new Error("API Key 格式无效");
  }
  return text;
}

function invalidSettings(): Error {
  return new Error("模型设置文件无效");
}

function invalidCredentials(): Error {
  return new Error("模型凭据文件无效");
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
