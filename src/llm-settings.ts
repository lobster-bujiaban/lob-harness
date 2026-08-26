import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OpenAiCompatLlm,
  type FetchLike,
  type LlmClient,
} from "./llm.ts";

export type LlmProvider = "openai-compatible";

type ModelProfile = {
  id: string;
  name: string;
  provider: LlmProvider;
  baseURL: string;
  model: string;
};

type SavedSettings = { version: 2; activeProfileId: string; profiles: ModelProfile[] };
type SavedCredentials = { version: 1; apiKey?: string; modelApiKeys?: Record<string, string>; dashscopeApiKey?: string };

export type PublicModelProfile = ModelProfile & { hasApiKey: boolean };
export type PublicLlmSettings = Omit<ModelProfile, "id" | "name"> & {
  activeProfileId?: string;
  profiles?: PublicModelProfile[];
  hasApiKey: boolean;
  hasDashscopeApiKey?: boolean;
};

export type UpdateLlmSettings = {
  provider?: unknown;
  baseURL?: unknown;
  model?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
  dashscopeApiKey?: unknown;
  clearDashscopeApiKey?: unknown;
  profileId?: unknown;
  profileName?: unknown;
  createProfile?: unknown;
  deleteProfileId?: unknown;
  activeProfileId?: unknown;
};
export type DiscoverModelsInput = { profileId?: unknown; baseURL?: unknown; apiKey?: unknown };

const DEFAULT_PROFILE: ModelProfile = {
  id: "default",
  name: "DeepSeek",
  provider: "openai-compatible", baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash",
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
    const active = profileById(settings, settings.activeProfileId);
    const keys = credentialKeys(credentials);
    return {
      provider: active.provider, baseURL: active.baseURL, model: active.model,
      activeProfileId: active.id,
      profiles: settings.profiles.map((profile) => ({ ...profile, hasApiKey: keys[profile.id] !== undefined })),
      hasApiKey: keys[active.id] !== undefined,
      hasDashscopeApiKey: credentials?.dashscopeApiKey !== undefined,
    };
  }

  async update(input: UpdateLlmSettings): Promise<PublicLlmSettings> {
    const current = await this.readSettings();
    const credentials = await this.readCredentials();
    const keys = credentialKeys(credentials);
    const deleteProfileId = optionalProfileId(input.deleteProfileId);
    if (deleteProfileId !== undefined) {
      if (current.profiles.length === 1) throw new Error("至少保留一个模型配置");
      if (!current.profiles.some((profile) => profile.id === deleteProfileId)) throw new Error("模型配置不存在");
      current.profiles = current.profiles.filter((profile) => profile.id !== deleteProfileId);
      delete keys[deleteProfileId];
      if (current.activeProfileId === deleteProfileId) current.activeProfileId = current.profiles[0]!.id;
    }
    const createProfile = input.createProfile === true;
    const requestedId = optionalProfileId(input.profileId);
    const targetId = createProfile ? requestedId ?? randomUUID() : requestedId ?? current.activeProfileId;
    let target = current.profiles.find((profile) => profile.id === targetId);
    if (createProfile) {
      if (target !== undefined) throw new Error("模型配置 ID 已存在");
      target = {
        id: targetId,
        name: parseProfileName(input.profileName ?? "自定义模型"),
        provider: parseProvider(input.provider ?? "openai-compatible"),
        baseURL: parseBaseURL(input.baseURL),
        model: parseModel(input.model),
      };
      current.profiles.push(target);
    } else if (deleteProfileId === undefined) {
      if (target === undefined) throw new Error("模型配置不存在");
      target.name = parseProfileName(input.profileName ?? target.name);
      target.provider = parseProvider(input.provider ?? target.provider);
      target.baseURL = parseBaseURL(input.baseURL ?? target.baseURL);
      target.model = parseModel(input.model ?? target.model);
    }
    const activateId = optionalProfileId(input.activeProfileId) ?? (createProfile ? targetId : undefined);
    if (activateId !== undefined) {
      profileById(current, activateId);
      current.activeProfileId = activateId;
    }
    const clearApiKey = input.clearApiKey === true;
    const apiKey = parseOptionalApiKey(input.apiKey);
    const clearDashscopeApiKey = input.clearDashscopeApiKey === true;
    const dashscopeApiKey = parseOptionalApiKey(input.dashscopeApiKey);
    await this.writePrivateJson(this.settingsPath, current);
    const keyTargetId = target?.id ?? current.activeProfileId;
    if (clearApiKey) delete keys[keyTargetId];
    else if (apiKey !== null) keys[keyTargetId] = apiKey;
    const nextDashscopeApiKey = clearDashscopeApiKey ? undefined : dashscopeApiKey ?? credentials?.dashscopeApiKey;
    if (Object.keys(keys).length === 0 && nextDashscopeApiKey === undefined) {
      await unlink(this.credentialsPath).catch((error: unknown) => {
        if (!isErrorCode(error, "ENOENT")) throw error;
      });
    } else if (apiKey !== null || dashscopeApiKey !== null || clearApiKey || clearDashscopeApiKey || deleteProfileId !== undefined) {
      await this.writePrivateJson(this.credentialsPath, {
        version: 1,
        ...(Object.keys(keys).length === 0 ? {} : { modelApiKeys: keys }),
        ...(nextDashscopeApiKey === undefined ? {} : { dashscopeApiKey: nextDashscopeApiKey }),
      } satisfies SavedCredentials);
    }
    return this.describe();
  }

  async createLlm(_userText: string): Promise<LlmClient> {
    const settings = await this.readSettings();
    const credentials = await this.readCredentials();
    const active = profileById(settings, settings.activeProfileId);
    const apiKey = credentialKeys(credentials)[active.id];
    if (apiKey === undefined) {
      throw new Error("请先在模型设置中配置 API Key");
    }
    return new OpenAiCompatLlm({
      apiKey,
      baseURL: active.baseURL,
      model: active.model,
      fetchImpl: this.fetchImpl,
    });
  }

  async discoverModels(input: DiscoverModelsInput): Promise<string[]> {
    const settings = await this.readSettings();
    const credentials = await this.readCredentials();
    const profileId = optionalProfileId(input.profileId) ?? settings.activeProfileId;
    const profile = settings.profiles.find((item) => item.id === profileId);
    const baseURL = parseBaseURL(input.baseURL ?? profile?.baseURL);
    const supplied = parseOptionalApiKey(input.apiKey);
    const apiKey = supplied ?? credentialKeys(credentials)[profileId];
    if (apiKey === undefined) throw new Error("获取模型目录需要 API Key");
    const response = await (this.fetchImpl ?? fetch)(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`获取模型目录失败（HTTP ${response.status}）`);
    const payload = await response.json() as unknown;
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
      throw new Error("模型目录响应格式无效");
    }
    return [...new Set((payload as { data: unknown[] }).data.flatMap((item) => {
      if (typeof item !== "object" || item === null || typeof (item as { id?: unknown }).id !== "string") return [];
      return [(item as { id: string }).id];
    }))].sort();
  }

  private async readSettings(): Promise<SavedSettings> {
    const value = await readJsonFile(this.settingsPath);
    if (value === null) return { version: 2, activeProfileId: DEFAULT_PROFILE.id, profiles: [structuredClone(DEFAULT_PROFILE)] };
    if (typeof value !== "object" || value === null) throw invalidSettings();
    const raw = value as Record<string, unknown>;
    try {
      if (raw.version === 2 && Array.isArray(raw.profiles)) {
        const profiles = raw.profiles.map(parseProfile);
        if (profiles.length === 0 || new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error();
        const activeProfileId = parseProfileId(raw.activeProfileId);
        const settings = { version: 2 as const, activeProfileId, profiles };
        profileById(settings, activeProfileId);
        return settings;
      }
      const legacy = {
        ...DEFAULT_PROFILE,
        provider: raw.provider === "fake" ? "openai-compatible" as const : parseProvider(raw.provider),
        baseURL: parseBaseURL(raw.baseURL), model: migrateLegacyModel(parseModel(raw.model)),
      };
      return { version: 2, activeProfileId: legacy.id, profiles: [legacy] };
    } catch {
      throw invalidSettings();
    }
  }

  private async readCredentials(): Promise<SavedCredentials | null> {
    const value = await readJsonFile(this.credentialsPath);
    if (value === null) return null;
    if (typeof value !== "object" || value === null) throw invalidCredentials();
    const raw = value as Record<string, unknown>;
    try {
      const apiKey = parseOptionalApiKey(raw.apiKey);
      const dashscopeApiKey = parseOptionalApiKey(raw.dashscopeApiKey);
      const modelApiKeys = parseModelApiKeys(raw.modelApiKeys);
      if (apiKey === null && Object.keys(modelApiKeys).length === 0 && dashscopeApiKey === null) throw invalidCredentials();
      return {
        version: 1,
        ...(apiKey === null ? {} : { apiKey }),
        ...(Object.keys(modelApiKeys).length === 0 ? {} : { modelApiKeys }),
        ...(dashscopeApiKey === null ? {} : { dashscopeApiKey }),
      };
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

function parseProfile(value: unknown): ModelProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("模型配置无效");
  const raw = value as Record<string, unknown>;
  return {
    id: parseProfileId(raw.id),
    name: parseProfileName(raw.name),
    provider: parseProvider(raw.provider),
    baseURL: parseBaseURL(raw.baseURL),
    model: migrateLegacyModel(parseModel(raw.model)),
  };
}

function parseProfileId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(value)) throw new Error("模型配置 ID 无效");
  return value;
}

function optionalProfileId(value: unknown): string | undefined {
  return value === undefined ? undefined : parseProfileId(value);
}

function parseProfileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("模型配置名称必填");
  const text = value.trim();
  if (text.length === 0 || text.length > 80 || /[\r\n]/u.test(text)) throw new Error("模型配置名称必须为 1～80 个字符");
  return text;
}

function profileById(settings: SavedSettings, id: string): ModelProfile {
  const profile = settings.profiles.find((item) => item.id === id);
  if (profile === undefined) throw new Error("当前模型配置不存在");
  return profile;
}

function parseModelApiKeys(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidCredentials();
  const result: Record<string, string> = {};
  for (const [id, key] of Object.entries(value)) {
    const parsed = parseOptionalApiKey(key);
    if (parsed === null) throw invalidCredentials();
    result[parseProfileId(id)] = parsed;
  }
  return result;
}

function credentialKeys(credentials: SavedCredentials | null): Record<string, string> {
  const result = { ...(credentials?.modelApiKeys ?? {}) };
  if (credentials?.apiKey !== undefined && result.default === undefined) result.default = credentials.apiKey;
  return result;
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
