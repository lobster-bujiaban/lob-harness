const sessionList = document.querySelector("#session-list");
const sessionStatus = document.querySelector("#session-status");
const sessionTitle = document.querySelector("#session-title");
const mainStatus = document.querySelector("#main-status");
const workspaceRoot = document.querySelector("#workspace-root");
const saveWorkspace = document.querySelector("#save-workspace");
const workspacePicker = document.querySelector("#workspace-picker");
const workspacePickerLabel = document.querySelector("#workspace-picker-label");
const workspacePickerMenu = document.querySelector("#workspace-picker-menu");
const transcript = document.querySelector("#transcript");
const stage = document.querySelector(".stage");
const main = document.querySelector("#main");
const tabChat = document.querySelector("#tab-chat");
const tabFlow = document.querySelector("#tab-flow");
const panelChat = document.querySelector("#panel-chat");
const panelFlow = document.querySelector("#panel-flow");
const eventFlow = document.querySelector("#event-flow");
const flowStatus = document.querySelector("#flow-status");
const tokenInsights = document.querySelector("#token-insights");
const composer = document.querySelector("#composer");
const draft = document.querySelector("#draft");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const composerHint = document.querySelector("#composer-hint");
const attachButton = document.querySelector(".attach-button");
const newSession = document.querySelector("#new-session");
const clearSessions = document.querySelector("#clear-sessions");
const addWorkspace = document.querySelector("#add-workspace");
const searchWorkspaces = document.querySelector("#search-workspaces");
const workspaceSearchWrap = document.querySelector("#workspace-search-wrap");
const workspaceSearch = document.querySelector("#workspace-search");
const modelSelection = document.querySelector("#model-selection");
const openSettings = document.querySelector("#open-settings");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsForm = document.querySelector("#settings-form");
const closeSettings = document.querySelector("#close-settings");
const cancelSettings = document.querySelector("#cancel-settings");
const saveSettings = document.querySelector("#save-settings");
const llmBaseURL = document.querySelector("#llm-base-url");
const llmModel = document.querySelector("#llm-model");
const llmApiKey = document.querySelector("#llm-api-key");
const keyError = document.querySelector("#key-error");
const dashscopeApiKey = document.querySelector("#dashscope-api-key");
const clearDashscopeApiKey = document.querySelector("#clear-dashscope-api-key");
const dashscopeKeyError = document.querySelector("#dashscope-key-error");
const dashscopeCredentialDot = document.querySelector("#dashscope-credential-dot");
const dashscopeCredentialLabel = document.querySelector("#dashscope-credential-label");
const modelProfilesOverview = document.querySelector("#model-profiles-overview");
const modelProfilesList = document.querySelector("#model-profiles-list");
const modelProfileEditor = document.querySelector("#model-profile-editor");
const modelProfileId = document.querySelector("#model-profile-id");
const modelProfileName = document.querySelector("#model-profile-name");
const addCatalogProvider = document.querySelector("#add-catalog-provider");
const addCustomProvider = document.querySelector("#add-custom-provider");
const cancelModelEditor = document.querySelector("#cancel-model-editor");
const providerCatalog = document.querySelector("#provider-catalog");
const discoverModels = document.querySelector("#discover-models");
const addManualModel = document.querySelector("#add-manual-model");
const credentialDot = document.querySelector("#credential-dot");
const credentialLabel = document.querySelector("#credential-label");
const settingsStatus = document.querySelector("#settings-status");

function svgIcon(name, className = "") {
  return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
}

const lobsterLogo = `<img class="lobster-logo" src="/lobster-logo.png" alt="">`;
document.querySelector(".brand-mark").innerHTML = lobsterLogo;
document.querySelector(".brand").textContent = "LOB Harness";
document.querySelector(".hero-mark").innerHTML = lobsterLogo;
document.querySelector(".hero-heading strong").textContent = "不只讲 Agent，直接把它跑起来";
draft.placeholder = "给 LOB Harness 一个任务";
document.querySelector(".hero-heading > span:last-child").remove();
newSession.querySelector("span").innerHTML = svgIcon("plus");
searchWorkspaces.innerHTML = svgIcon("search");
addWorkspace.innerHTML = svgIcon("folder-plus");
openSettings.querySelector("span").innerHTML = svgIcon("settings");
const filterSessions = document.createElement("button");
filterSessions.type = "button";
filterSessions.setAttribute("aria-label", "筛选会话");
filterSessions.innerHTML = svgIcon("filter");
addWorkspace.before(filterSessions);
clearSessions.hidden = true;
const scrollToBottom = document.createElement("button");
scrollToBottom.type = "button";
scrollToBottom.className = "scroll-to-bottom";
scrollToBottom.setAttribute("aria-label", "回到对话底部");
scrollToBottom.textContent = "⌄";
scrollToBottom.hidden = true;
composer.parentElement.prepend(scrollToBottom);

const settingsLayout = document.createElement("div");
settingsLayout.className = "settings-layout";
const settingsNav = document.createElement("nav");
settingsNav.className = "settings-nav";
settingsNav.innerHTML = `<button type="button" data-tab="general">⚙ 通用设置</button><button type="button" data-tab="model" class="active">◉ 模型</button><button type="button" data-tab="plugins">☷ 插件</button>`;
const settingsContent = document.createElement("div");
settingsContent.className = "settings-content";
const modelPanel = settingsForm.querySelector("#model-panel");
modelPanel.classList.add("settings-panel");
const generalPanel = settingsForm.querySelector("#general-panel");
const pluginsPanel = document.createElement("section");
pluginsPanel.className = "settings-panel plugins-panel";
pluginsPanel.hidden = true;
pluginsPanel.innerHTML = `<h3>插件</h3><p class="plugin-description">配置和查看本部署已安装的插件。</p><input id="plugin-search" type="search" placeholder="搜索插件"><div class="plugin-count">插件列表 <span>0</span></div><div class="plugin-list"></div>`;
const placeholderPanel = document.createElement("section");
placeholderPanel.className = "settings-panel settings-placeholder";
placeholderPanel.hidden = true;
placeholderPanel.textContent = "该设置分类将在后续版本开放。";
modelPanel.before(settingsLayout);
settingsLayout.append(settingsNav, settingsContent);
settingsContent.append(generalPanel, modelPanel, pluginsPanel, placeholderPanel);
const pluginSearch = pluginsPanel.querySelector("#plugin-search");
const pluginList = pluginsPanel.querySelector(".plugin-list");
const pluginCount = pluginsPanel.querySelector(".plugin-count span");
let pluginEntries = [];
let creatingModelProfile = false;
const MODEL_PROVIDER_CATALOG = {
  deepseek: { name: "DeepSeek", baseURL: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  qwen: { name: "通义千问", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  moonshot: { name: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  minimax: { name: "MiniMax", baseURL: "https://api.minimax.chat/v1", model: "MiniMax-Text-01" },
  siliconflow: { name: "硅基流动", baseURL: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
};

const TYPE_LABEL = {
  inbox_inserted: "Inbox 入队",
  inbox_claimed: "Inbox 领取",
  workspace_root: "工作区切换",
  turn_start: "Turn 开始",
  turn_end: "Turn 结束",
  step_start: "Step 开始",
  step_end: "Step 结束",
  request_start: "请求开始",
  request_end: "请求结束",
  approval_asked: "请求审批",
  approval_decided: "审批结果",
  user: "用户",
  assistant: "助手",
  assistant_chunk: "流式分片",
  context_compacted: "上下文压缩",
  usage: "Token 用量",
  tool_call: "工具调用",
  tool_result: "工具结果",
  subagent_descriptor: "子 Agent 描述符",
  subagent_started: "子 Agent 开始",
  subagent_ended: "子 Agent 结束",
  job_descriptor: "后台 Job 描述符",
  job_started: "后台 Job 开始",
  job_ended: "后台 Job 结束",
  goal_change: "目标变更",
  end: "结束",
};

const TOOL_TITLE = {
  bash: "Bash",
  grep: "Grep",
  read_file: "Read",
  write_file: "Write",
  edit: "Edit",
  list_files: "List",
  echo: "Echo",
  get_goal: "Goal",
  subagent: "Subagent",
  job: "Job",
};

const TRANSCRIPT_SKIP = new Set([
  "context_compacted",
  "usage",
  "turn_start",
  "turn_end",
  "step_start",
  "step_end",
  "request_start",
  "request_end",
  "approval_asked",
  "approval_decided",
  "inbox_inserted",
  "inbox_claimed",
  "workspace_root",
  "subagent_descriptor",
  "subagent_started",
  "subagent_ended",
  "job_descriptor",
  "job_started",
  "job_ended",
  "goal_change",
]);

let current = null;
let liveThink = null;
const runningSessions = new Map();
let managingSessions = false;
let tmpSessionCount = 0;
let modelSettings = null;
let selectedWorkspace = "";
let listedSessions = [];
let hideBlankSessions = false;
let followLatest = true;
let bottomScrollFrame = 0;
const workspaceAliases = JSON.parse(
  localStorage.getItem("lob-harness.workspace-aliases")
    ?? localStorage.getItem("tiny-harness.workspace-aliases")
    ?? "{}",
);
const removedWorkspaces = new Set(JSON.parse(
  localStorage.getItem("lob-harness.removed-workspaces")
    ?? localStorage.getItem("tiny-harness.removed-workspaces")
    ?? "[]",
));

function saveWorkspacePreferences() {
  localStorage.setItem("lob-harness.workspace-aliases", JSON.stringify(workspaceAliases));
  localStorage.setItem("lob-harness.removed-workspaces", JSON.stringify([...removedWorkspaces]));
}

function workspaceChoices() {
  const roots = new Set(listedSessions
    .map((session) => session.workspaceRoot)
    .filter((root) => root && !removedWorkspaces.has(root)));
  if (selectedWorkspace && !removedWorkspaces.has(selectedWorkspace)) roots.add(selectedWorkspace);
  return [...roots].sort((left, right) =>
    (workspaceAliases[left] ?? pathName(left)).localeCompare(workspaceAliases[right] ?? pathName(right), "zh-CN")
  );
}

function renderWorkspacePicker() {
  workspacePickerLabel.textContent = selectedWorkspace
    ? (workspaceAliases[selectedWorkspace] ?? pathName(selectedWorkspace))
    : "未分组";
  const choices = [{ root: "", name: "未分组" }, ...workspaceChoices().map((root) => ({
    root,
    name: workspaceAliases[root] ?? pathName(root),
  }))];
  workspacePickerMenu.replaceChildren(...choices.map(({ root, name }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "workspace-picker-item";
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", selectedWorkspace === root ? "true" : "false");
    item.innerHTML = `<span class="workspace-picker-folder">${svgIcon("folder")}</span><span class="workspace-picker-name"></span><span class="workspace-picker-check">✓</span>`;
    item.querySelector(".workspace-picker-name").textContent = name;
    item.title = root || "不指定工作区分组";
    item.addEventListener("click", () => {
      selectedWorkspace = root;
      workspaceRoot.value = root;
      closeWorkspacePicker();
      renderWorkspacePicker();
    });
    return item;
  }));
  const divider = document.createElement("div");
  divider.className = "workspace-picker-divider";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "workspace-picker-add";
  add.innerHTML = `<span>${svgIcon("plus")}</span><span>添加工作区…</span>`;
  add.addEventListener("click", () => {
    closeWorkspacePicker();
    addWorkspace.click();
  });
  workspacePickerMenu.append(divider, add);
}

function closeWorkspacePicker() {
  workspacePickerMenu.hidden = true;
  workspacePicker.setAttribute("aria-expanded", "false");
}

function scrollMainToBottom(options = {}) {
  followLatest = true;
  cancelAnimationFrame(bottomScrollFrame);
  bottomScrollFrame = requestAnimationFrame(() => {
    main.scrollTo({ top: main.scrollHeight, behavior: options.smooth ? "smooth" : "auto" });
  });
}

function followLiveOutput() {
  if (followLatest) scrollMainToBottom();
}

function pathName(path) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}

function relativeTime(updatedAt) {
  const days = Math.floor((Date.now() - updatedAt) / 86_400_000);
  if (days <= 0) {
    const date = new Date(updatedAt);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${days}天`;
}

function summary(event) {
  switch (event.type) {
    case "inbox_inserted":
      return `${event.target} · ${event.text}`;
    case "inbox_claimed":
      return `turn ${event.turn} · ${event.target} · ${event.text}`;
    case "workspace_root":
      return event.path;
    case "turn_start":
      return `turn ${event.turn}`;
    case "turn_end":
      return event.reason.kind === "error"
        ? `turn ${event.turn} · error · ${event.reason.error.message}`
        : `turn ${event.turn} · ${event.reason.kind}`;
    case "step_start":
    case "step_end":
      return `turn ${event.turn} · step ${event.step}`;
    case "request_start":
      return `turn ${event.turn} · step ${event.step} · attempt ${event.attempt}`;
    case "request_end":
      return event.reason.kind === "error"
        ? `attempt ${event.attempt} · error · ${event.reason.error.code}`
        : `attempt ${event.attempt} · completed`;
    case "approval_asked":
      return `${event.toolName} · ${event.reason ?? "需要一次性审批"}`;
    case "approval_decided":
      return `${event.id} · ${event.outcome}`;
    case "user":
    case "assistant":
      return event.text;
    case "tool_call":
      return `${event.name} ${JSON.stringify(event.args)}`;
    case "tool_result":
      return `${event.name} ${event.output}`;
    case "assistant_chunk":
      return event.kind === "tool_call"
        ? `tool #${event.index} ${event.argumentsDelta}`
        : `${event.kind} ${event.text}`;
    case "context_compacted":
      return `${event.strategy} · through #${event.throughSeq} · ${event.beforeTokens} → ${event.afterTokens}`;
    case "usage":
      return `input=${event.inputTokens} output=${event.outputTokens}`;
    case "subagent_descriptor":
      return `${event.mode} · parent ${event.parentSessionId}`;
    case "subagent_started":
      return `${event.childId} · ${event.prompt}`;
    case "subagent_ended":
      return `${event.childId} · ${event.output}`;
    case "job_descriptor":
      return `parent ${event.parentSessionId} · ${event.prompt}`;
    case "job_started":
      return `${event.jobId} · ${event.prompt}`;
    case "job_ended":
      return `${event.jobId} · ${event.status} · ${event.output}`;
    case "goal_change":
      return `${event.action} · ${event.goal.phase} · ${event.goal.objective}`;
    case "end":
      return event.reason;
    default:
      return JSON.stringify(event);
  }
}

function setTab(which) {
  tabChat.setAttribute("aria-selected", String(which === "chat"));
  tabFlow.setAttribute("aria-selected", String(which === "flow"));
  panelChat.hidden = which !== "chat";
  panelFlow.hidden = which !== "flow";
}

function mergeFlowEvents(events) {
  const merged = [];
  for (const event of events) {
    const previous = merged.at(-1);
    const sameChunkStream = event.type === "assistant_chunk"
      && previous?.type === "assistant_chunk"
      && previous.kind === event.kind
      && (event.kind !== "tool_call" || previous.index === event.index);
    if (sameChunkStream) {
      previous.chunkCount += 1;
      previous.seqEnd = event.seq ?? previous.seqEnd;
      if (typeof event.at === "number") previous.atEnd = event.at;
      if (event.kind === "tool_call") {
        previous.name ||= event.name;
        previous.id ||= event.id;
        previous.argumentsDelta += event.argumentsDelta ?? "";
      } else {
        previous.text += event.text ?? "";
      }
      continue;
    }
    merged.push(event.type === "assistant_chunk"
      ? { ...event, chunkCount: 1, seqEnd: event.seq, argumentsDelta: event.argumentsDelta ?? "", text: event.text ?? "" }
      : { ...event, seqEnd: event.seq });
  }
  return merged;
}

function flowGroup(event) {
  if (event.type === "user" || event.type === "inbox_inserted" || event.type === "inbox_claimed") return "user";
  if (event.type === "assistant_chunk" && event.kind === "tool_call") return "tool";
  if (event.type === "assistant" || event.type === "assistant_chunk" || event.type === "context_compacted" || event.type === "request_start" || event.type === "request_end") return "model";
  if (event.type === "tool_call" || event.type === "tool_result" || event.type === "approval_asked" || event.type === "approval_decided") return "tool";
  return "runtime";
}

function flowSummary(event) {
  if (event.type !== "assistant_chunk") return summary(event);
  if (event.kind === "tool_call") {
    const args = event.argumentsDelta.trim() || "{}";
    return `${event.name ?? `tool #${event.index}`} ${args}`;
  }
  return event.text;
}

function eventTime(event) {
  return typeof event?.at === "number" && Number.isFinite(event.at) ? event.at : undefined;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function findPreceding(events, index, match) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const event = events[cursor];
    if (event !== undefined && match(event)) return event;
  }
  return undefined;
}

function spanMs(start, end) {
  const from = eventTime(start);
  const to = eventTime(end);
  return from === undefined || to === undefined ? undefined : to - from;
}

function nodeDurationMs(events, index) {
  const event = events[index];
  if (event === undefined) return undefined;
  if (event.type === "turn_end") {
    return spanMs(findPreceding(events, index, (item) => item.type === "turn_start" && item.turn === event.turn), event);
  }
  if (event.type === "step_end") {
    return spanMs(findPreceding(events, index, (item) =>
      item.type === "step_start" && item.turn === event.turn && item.step === event.step), event);
  }
  if (event.type === "request_end") {
    return spanMs(findPreceding(events, index, (item) =>
      item.type === "request_start"
      && item.turn === event.turn
      && item.step === event.step
      && item.attempt === event.attempt), event);
  }
  if (event.type === "tool_result") {
    return spanMs(findPreceding(events, index, (item) => item.type === "tool_call" && item.id === event.id), event);
  }
  if (event.type === "subagent_ended") {
    return spanMs(findPreceding(events, index, (item) => item.type === "subagent_started" && item.childId === event.childId), event);
  }
  if (event.type === "job_ended") {
    return spanMs(findPreceding(events, index, (item) => item.type === "job_started" && item.jobId === event.jobId), event);
  }
  if (event.type === "approval_decided") {
    return spanMs(findPreceding(events, index, (item) => item.type === "approval_asked" && item.id === event.id), event);
  }
  if (typeof event.atEnd === "number" && eventTime(event) !== undefined) {
    const streamed = event.atEnd - event.at;
    if (streamed >= 10) return streamed;
  }
  const next = eventTime(events[index + 1]);
  const start = eventTime(event);
  if (start === undefined || next === undefined) return undefined;
  const gap = next - start;
  return gap >= 1000 ? gap : undefined;
}

function totalDurationMs(events) {
  const times = events.map(eventTime).filter((value) => value !== undefined);
  if (times.length < 2) return undefined;
  return times.at(-1) - times[0];
}

function modelDurationMs(events) {
  let total = 0;
  let counted = false;
  for (const [index, event] of events.entries()) {
    if (event.type !== "request_end") continue;
    const duration = nodeDurationMs(events, index);
    if (duration === undefined) continue;
    total += duration;
    counted = true;
  }
  return counted ? total : undefined;
}

function tokenRelation(event) {
  if (event.type === "request_start") return { label: "模型调用", tone: "call" };
  if (event.type === "usage") return { label: "Token 计量", tone: "usage" };
  if (event.type === "assistant_chunk") return { label: "输出 Token", tone: "output" };
  if (event.type === "user") return { label: "输入上下文", tone: "input" };
  if (event.type === "tool_result") return { label: "下次调用输入", tone: "input" };
  if (event.type === "context_compacted") return { label: "上下文替代", tone: "input" };
  if (event.type === "tool_call" || event.type === "assistant") return { label: "后续上下文", tone: "input" };
  return null;
}

function renderTokenInsights(events) {
  const usages = events.filter((event) => event.type === "usage");
  const calls = events.filter((event) => event.type === "request_start").length;
  const toolResults = events.filter((event) => event.type === "tool_result");
  const largest = toolResults.reduce((best, event) =>
    (event.output?.length ?? 0) > (best?.output?.length ?? 0) ? event : best, null);
  const input = usages.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0);
  const output = usages.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0);
  tokenInsights.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Token 优化线索";
  const facts = document.createElement("div");
  facts.className = "token-facts";
  const modelMs = modelDurationMs(events);
  const totalMs = totalDurationMs(events);
  facts.innerHTML = [
    `<span>${calls} 次模型调用</span>`,
    `<span>输入 ${input}</span>`,
    `<span>输出 ${output}</span>`,
    modelMs === undefined ? "" : `<span>模型 ${formatDuration(modelMs)}</span>`,
    totalMs === undefined ? "" : `<span>总耗时 ${formatDuration(totalMs)}</span>`,
  ].join("");
  const tip = document.createElement("p");
  tip.textContent = largest
    ? `最大工具结果：${largest.name}，${largest.output.length.toLocaleString()} 字符。它会进入后续请求上下文；优先让工具过滤目录、限定文件类型或直接返回计数。`
    : "优先减少重复调用、历史上下文和过长输出。";
  tokenInsights.append(title, facts, tip);
}

function renderFlow(events) {
  const merged = mergeFlowEvents(events);
  eventFlow.replaceChildren();
  renderTokenInsights(events);
  const totalMs = totalDurationMs(events);
  flowStatus.textContent = totalMs === undefined
    ? `${events.length} 条原始事件 → ${merged.length} 个流程节点`
    : `${events.length} 条原始事件 → ${merged.length} 个流程节点 · 总耗时 ${formatDuration(totalMs)}`;
  for (const [index, event] of merged.entries()) {
    const item = document.createElement("li");
    item.className = `flow-node flow-${flowGroup(event)}`;
    const relation = tokenRelation(event);
    if (relation) item.classList.add("token-related", `token-${relation.tone}`);
    const marker = document.createElement("span");
    marker.className = "flow-marker";
    marker.textContent = String(index + 1);
    const card = document.createElement("article");
    const heading = document.createElement("div");
    heading.className = "flow-node-heading";
    const title = document.createElement("strong");
    title.textContent = event.type === "assistant_chunk"
      ? `${event.kind === "reasoning" ? "Reasoning" : event.kind === "text" ? "文本输出" : `调用 ${event.name ?? `tool #${event.index}`}`}（${event.chunkCount} 分片）`
      : TYPE_LABEL[event.type] ?? event.type;
    const rawType = document.createElement("code");
    rawType.textContent = event.type === "assistant_chunk" ? event.kind : event.type;
    const labels = document.createElement("span");
    labels.className = "flow-labels";
    if (event.seq !== undefined) {
      const sequence = document.createElement("span");
      sequence.className = "flow-sequence";
      sequence.textContent = event.seq === event.seqEnd || event.seqEnd === undefined
        ? `#${event.seq}`
        : `#${event.seq}–${event.seqEnd}`;
      labels.append(sequence);
    }
    const duration = nodeDurationMs(merged, index);
    if (duration !== undefined && duration > 1000) {
      const elapsed = document.createElement("span");
      elapsed.className = "flow-duration";
      elapsed.textContent = formatDuration(duration);
      elapsed.title = "耗时";
      labels.append(elapsed);
    }
    if (relation) {
      const tokenBadge = document.createElement("span");
      tokenBadge.className = `token-badge token-badge-${relation.tone}`;
      tokenBadge.textContent = relation.label;
      labels.append(tokenBadge);
    }
    if (event.seqEnd !== undefined) {
      const fork = document.createElement("button");
      fork.type = "button";
      fork.className = "flow-fork";
      fork.textContent = "Fork";
      fork.title = `从事件 #${event.seqEnd} 创建新会话`;
      fork.addEventListener("click", () => { void forkSessionAt(event.seqEnd); });
      labels.append(fork);
    }
    labels.append(rawType);
    heading.append(title, labels);
    const body = document.createElement("p");
    body.textContent = flowSummary(event);
    const expandable = body.textContent.length > 240;
    if (expandable) {
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "flow-expand";
      expand.textContent = "展开全文";
      expand.setAttribute("aria-expanded", "false");
      const toggleExpanded = () => {
        const expanded = card.classList.toggle("flow-expanded");
        expand.textContent = expanded ? "收起" : "展开全文";
        expand.setAttribute("aria-expanded", String(expanded));
      };
      expand.addEventListener("click", toggleExpanded);
      body.addEventListener("click", toggleExpanded);
      body.classList.add("flow-body-expandable");
      labels.append(expand);
    }
    card.append(heading, body);
    item.append(marker, card);
    eventFlow.append(item);
  }
}

function sessionKey(session) {
  return `${session.source}/${session.file}`;
}

function isRunning(session = current) {
  return session !== null && runningSessions.has(sessionKey(session));
}

function isCurrentSession(source, file) {
  return current?.source === source && current?.file === file;
}

function canPaintLive(source, file) {
  return isCurrentSession(source, file) && runningSessions.get(`${source}/${file}`)?.live === true;
}

function setComposerEnabled(enabled, hint) {
  draft.disabled = !enabled;
  send.disabled = !enabled || draft.value.trim().length === 0;
  composerHint.textContent = hint;
}

function updateComposer() {
  updateWorkspaceControls();
  const busy = isRunning();
  stop.hidden = !busy;
  stop.disabled = !busy;
  if (!current) {
    setComposerEnabled(false, "先选择或新建一个会话。");
    return;
  }
  if (current.source !== "tmp") {
    setComposerEnabled(false, "fixture 只读。要点对话请新建会话。");
    return;
  }
  if (busy) {
    setComposerEnabled(true, "运行中：发送的内容将在下一步用于引导 Agent。");
    return;
  }
  if (!modelSettings?.hasApiKey) {
    setComposerEnabled(false, "请先在「模型设置」中配置真实模型的 API Key。");
    return;
  }
  setComposerEnabled(true, `当前模型：${modelSettings.model}`);
  send.disabled = draft.value.trim().length === 0;
}

function updateWorkspaceControls() {
  const editable = current?.source === "tmp" && !isRunning() && !managingSessions;
  workspaceRoot.disabled = !editable;
  saveWorkspace.disabled = !editable || workspaceRoot.value.trim().length === 0;
}

function renderModelSettings(settings) {
  modelSettings = settings;
  const profiles = settings.profiles ?? [{ id: "default", name: settings.model, model: settings.model, models: [settings.model], baseURL: settings.baseURL, hasApiKey: settings.hasApiKey }];
  const choices = profiles.flatMap((profile) => (profile.models ?? [profile.model]).map((model) => {
    const option = new Option(`${profile.name} · ${model}`, `${encodeURIComponent(profile.id)}|${encodeURIComponent(model)}`);
    return option;
  }));
  modelSelection.replaceChildren(...choices);
  modelSelection.value = `${encodeURIComponent(settings.activeProfileId ?? profiles[0].id)}|${encodeURIComponent(settings.model)}`;
  modelSelection.disabled = false;
  creatingModelProfile = false;
  modelProfilesOverview.hidden = false;
  modelProfileEditor.hidden = true;
  setModelEditorDisabled(true);
  modelProfilesList.replaceChildren(...profiles.map((profile) => modelProfileCard(profile, profiles.length)));
  renderDashscopeCredential(settings);
  updateComposer();
}

function modelProfileCard(profile, count) {
  const item = document.createElement("li");
  item.className = "model-profile-card";
  const status = profile.hasApiKey ? "已配置" : "缺少密钥";
  item.innerHTML = `<div><strong></strong><span class="model-provider-tag">${profile.id === "default" ? "内置" : "自定义"}</span><i class="credential-dot"></i><p></p></div><div class="model-card-actions"><button type="button">编辑</button><button type="button" class="text-danger">删除</button></div>`;
  item.querySelector("strong").textContent = profile.name;
  item.querySelector("p").textContent = `${(profile.models ?? [profile.model]).length} 个模型 · ${status}`;
  item.querySelector(".credential-dot").classList.toggle("configured", profile.hasApiKey);
  const [edit, remove] = item.querySelectorAll("button");
  edit.addEventListener("click", () => openModelEditor(profile));
  remove.disabled = count <= 1;
  remove.addEventListener("click", () => void removeModelProfile(profile));
  return item;
}

function openModelEditor(profile, options = {}) {
  creatingModelProfile = options.create === true;
  modelProfilesOverview.hidden = true;
  modelProfileEditor.hidden = false;
  setModelEditorDisabled(false);
  modelProfileId.value = profile.id;
  modelProfileId.disabled = !creatingModelProfile;
  providerCatalog.hidden = options.catalog !== true;
  providerCatalog.previousElementSibling.hidden = providerCatalog.hidden;
  renderModelProfile(profile);
}

function setModelEditorDisabled(disabled) {
  for (const control of modelProfileEditor.querySelectorAll("input,select,button")) control.disabled = disabled;
}

function renderModelProfile(profile) {
  if (!profile) return;
  modelProfileName.value = profile.name;
  llmBaseURL.value = profile.baseURL;
  setModelOptions(profile.models ?? [profile.model], profile.models ?? [profile.model]);
  llmApiKey.value = "";
  llmApiKey.disabled = false;
  llmApiKey.placeholder = profile.hasApiKey
    ? "已配置——输入新值可替换"
    : "输入 API 密钥";
  credentialDot.classList.toggle("configured", profile.hasApiKey);
  credentialLabel.textContent = profile.hasApiKey ? "API 密钥已配置" : "API 密钥缺失";
  keyError.textContent = "";
}

function setModelOptions(models, selected, expand = false) {
  const unique = [...new Set(models.filter((model) => typeof model === "string" && model.length > 0))];
  llmModel.replaceChildren(...unique.map((model) => new Option(model, model)));
  const selectedModels = Array.isArray(selected) ? selected : [selected];
  for (const option of llmModel.options) option.selected = selectedModels.includes(option.value);
  llmModel.size = Math.min(Math.max(unique.length, expand ? 3 : 2), 6);
  llmModel.classList.add("expanded");
}

function renderDashscopeCredential(settings) {
  dashscopeApiKey.value = "";
  dashscopeApiKey.placeholder = settings.hasDashscopeApiKey
    ? "已配置——输入新值可替换"
    : "输入百炼 API 密钥";
  clearDashscopeApiKey.checked = false;
  dashscopeCredentialDot.classList.toggle("configured", settings.hasDashscopeApiKey);
  dashscopeCredentialLabel.textContent = settings.hasDashscopeApiKey ? "配音密钥已配置" : "配音密钥缺失";
  clearDashscopeApiKey.closest("label").hidden = !settings.hasDashscopeApiKey;
  dashscopeKeyError.textContent = "";
}

function apiKeyFailure(value) {
  if (value.length === 0) return "";
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    /^[A-Z][A-Z0-9_]*=[^=]/.test(trimmed) ||
    ((trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`")) &&
      trimmed.endsWith(trimmed[0])) ||
    !/^[\x21-\x7e]+$/.test(trimmed)
  ) {
    return "该 API 密钥格式错误，请检查。";
  }
  return "";
}

async function loadModelSettings() {
  const res = await fetch("/api/settings/llm");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "读取模型设置失败");
  renderModelSettings(data);
  return data;
}

async function showModelSettings() {
  settingsStatus.textContent = "读取设置…";
  settingsStatus.classList.remove("error");
  settingsDialog.showModal();
  try {
    await Promise.all([loadModelSettings(), loadPlugins()]);
    settingsStatus.textContent = "";
    llmApiKey.focus();
  } catch (err) {
    settingsStatus.textContent = err instanceof Error ? err.message : "读取模型设置失败";
    settingsStatus.classList.add("error");
  }
}

async function loadPlugins() {
  const res = await fetch("/api/plugins");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "读取插件列表失败");
  pluginEntries = data.entries;
  renderPlugins();
}

function renderPlugins() {
  const query = pluginSearch.value.trim().toLowerCase();
  const entries = pluginEntries.filter((entry) =>
    `${entry.id} ${entry.name} ${entry.description} ${entry.tools.join(" ")}`.toLowerCase().includes(query)
  );
  pluginCount.textContent = String(entries.length);
  pluginList.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "plugin-card";
    card.innerHTML = `<div class="plugin-card-main"><div><strong></strong><p></p></div><label class="plugin-switch"><input type="checkbox"><span></span></label></div><div class="plugin-tools"></div><details><summary>插件配置</summary><textarea rows="4"></textarea><button type="button">保存配置</button></details>`;
    card.querySelector("strong").textContent = entry.name;
    card.querySelector("p").textContent = entry.description;
    card.querySelector(".plugin-tools").textContent = entry.tools.length > 0 ? `工具：${entry.tools.join(", ")}` : "无工具";
    const toggle = card.querySelector("input");
    toggle.checked = entry.enabled;
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      try { await updatePlugin(entry.id, { enabled: toggle.checked }); }
      catch (error) { toggle.checked = !toggle.checked; settingsStatus.textContent = error.message; }
      finally { toggle.disabled = false; }
    });
    const textarea = card.querySelector("textarea");
    textarea.value = JSON.stringify(entry.config, null, 2);
    const details = card.querySelector("details");
    details.hidden = !entry.configurable;
    card.querySelector("details button").addEventListener("click", async () => {
      try { await updatePlugin(entry.id, { config: JSON.parse(textarea.value) }); settingsStatus.textContent = "插件配置已保存"; }
      catch (error) { settingsStatus.textContent = error instanceof Error ? error.message : "保存失败"; settingsStatus.classList.add("error"); }
    });
    pluginList.append(card);
  }
}

async function updatePlugin(id, patch) {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "插件更新失败");
  pluginEntries = pluginEntries.map((entry) => entry.id === id ? data : entry);
  return data;
}

function dismissModelSettings() {
  settingsDialog.close();
}

async function saveModelSettings() {
  const keyFailure = apiKeyFailure(llmApiKey.value);
  if (keyFailure !== "") {
    keyError.textContent = keyFailure;
    llmApiKey.focus();
    return;
  }
  saveSettings.disabled = true;
  settingsStatus.textContent = "保存中…";
  settingsStatus.classList.remove("error");
  try {
    const res = await fetch("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: modelProfileId.value,
        profileName: modelProfileName.value,
        createProfile: creatingModelProfile,
        provider: "openai-compatible",
        baseURL: llmBaseURL.value,
        models: [...llmModel.selectedOptions].map((option) => option.value),
        model: llmModel.selectedOptions[0]?.value,
        apiKey: llmApiKey.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "保存模型设置失败");
    renderModelSettings(data);
    settingsDialog.close();
  } catch (err) {
    settingsStatus.textContent = err instanceof Error ? err.message : "保存模型设置失败";
    settingsStatus.classList.add("error");
  } finally {
    saveSettings.disabled = false;
  }
}

async function saveGeneralSettings() {
  const failure = apiKeyFailure(dashscopeApiKey.value);
  if (failure !== "") {
    dashscopeKeyError.textContent = failure;
    dashscopeApiKey.focus();
    return;
  }
  saveSettings.disabled = true;
  settingsStatus.textContent = "保存中…";
  settingsStatus.classList.remove("error");
  try {
    const res = await fetch("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dashscopeApiKey: dashscopeApiKey.value,
        clearDashscopeApiKey: clearDashscopeApiKey.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "保存通用设置失败");
    renderModelSettings(data);
    settingsDialog.close();
  } catch (err) {
    settingsStatus.textContent = err instanceof Error ? err.message : "保存通用设置失败";
    settingsStatus.classList.add("error");
  } finally {
    saveSettings.disabled = false;
  }
}

async function discoverAvailableModels() {
  const failure = apiKeyFailure(llmApiKey.value);
  if (failure !== "") { keyError.textContent = failure; return; }
  discoverModels.disabled = true;
  settingsStatus.textContent = "正在获取模型目录…";
  try {
    const res = await fetch("/api/settings/llm/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: modelProfileId.value, baseURL: llmBaseURL.value, apiKey: llmApiKey.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "获取模型目录失败");
    const previous = [...llmModel.selectedOptions].map((option) => option.value);
    setModelOptions(data.models, previous.filter((model) => data.models.includes(model)), true);
    settingsStatus.textContent = `获取到 ${data.models.length} 个模型，可在模型名称中选择。`;
  } catch (err) {
    settingsStatus.textContent = err instanceof Error ? err.message : "获取模型目录失败";
    settingsStatus.classList.add("error");
  } finally {
    discoverModels.disabled = false;
  }
}

function updateSessionActions() {
  newSession.disabled = managingSessions;
  clearSessions.disabled = managingSessions || runningSessions.size > 0 || tmpSessionCount === 0;
  for (const button of sessionList.querySelectorAll(".session-delete")) {
    const key = `${button.dataset.source}/${button.dataset.file}`;
    button.disabled = managingSessions || runningSessions.has(key);
  }
  for (const item of sessionList.querySelectorAll(".session-select")) {
    const busy = runningSessions.has(`${item.dataset.source}/${item.dataset.file}`);
    item.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

function clearSessionView() {
  current = null;
  sessionTitle.textContent = "未选择会话";
  mainStatus.textContent = "";
  mainStatus.classList.remove("error");
  workspaceRoot.value = "";
  selectedWorkspace = "";
  renderWorkspacePicker();
  renderTranscript([]);
  updateComposer();
}

function renderMarkdown(target, text) {
  target.replaceChildren();
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, "").trim().split(/\s+/u)[0] ?? "";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      target.append(createCodeBlock(lang, codeLines.join("\n")));
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] ?? "")) {
      const wrap = document.createElement("div");
      wrap.className = "md-table-scroll";
      const table = document.createElement("table");
      table.className = "markdown-table";
      const rows = [];
      const cells = (value) => value.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
      rows.push(cells(line));
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) rows.push(cells(lines[index++]));
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const value of rows.shift() ?? []) {
        const th = document.createElement("th");
        appendInline(th, value);
        headRow.append(th);
      }
      thead.append(headRow);
      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const value of row) {
          const td = document.createElement("td");
          appendInline(td, value);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
      wrap.append(table);
      target.append(wrap);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/u);
    if (heading) {
      const el = document.createElement(`h${heading[1].length}`);
      appendInline(el, heading[2] ?? "");
      target.append(el);
      index += 1;
      continue;
    }
    if (/^[-*]{3,}$/u.test(line.trim())) {
      target.append(document.createElement("hr"));
      index += 1;
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quote = document.createElement("blockquote");
      const quoted = [];
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^>\s?/u, ""));
        index += 1;
      }
      appendInline(quote, quoted.join("\n"));
      target.append(quote);
      continue;
    }
    const unordered = /^[-*]\s+/u.test(line);
    const ordered = /^\d+[.)]\s+/u.test(line);
    if (unordered || ordered) {
      const list = document.createElement(unordered ? "ul" : "ol");
      const itemRe = unordered ? /^[-*]\s+(.*)$/u : /^\d+[.)]\s+(.*)$/u;
      while (index < lines.length) {
        const itemMatch = (lines[index] ?? "").match(itemRe);
        if (itemMatch === null) break;
        const item = document.createElement("li");
        appendInline(item, itemMatch[1] ?? "");
        list.append(item);
        index += 1;
      }
      target.append(list);
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    const para = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim().length === 0 || isMarkdownBlockStart(lines, index)) break;
      para.push(current);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, para.join("\n"));
    target.append(paragraph);
  }
}

function isMarkdownBlockStart(lines, index) {
  const line = lines[index] ?? "";
  return /^\s*```/.test(line)
    || /^#{1,4}\s/u.test(line)
    || /^[-*]{3,}$/u.test(line.trim())
    || /^>\s?/u.test(line)
    || /^[-*]\s+/u.test(line)
    || /^\d+[.)]\s+/u.test(line)
    || (line.includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] ?? ""));
}

function appendInline(target, text) {
  const pattern = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\[([^\]]+)\]\((https?:[^)\s]+)\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) target.append(text.slice(last, match.index));
    if (match[1] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[1].slice(1, -1);
      target.append(code);
    } else if (match[2] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[2].slice(2, -2);
      target.append(strong);
    } else {
      const link = document.createElement("a");
      link.href = match[5] ?? "";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = match[4] ?? "";
      target.append(link);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) target.append(text.slice(last));
}

function createCodeBlock(lang, code) {
  const block = document.createElement("div");
  block.className = "md-code-block";
  const banner = document.createElement("div");
  banner.className = "md-code-banner";
  const info = document.createElement("span");
  info.className = "md-code-lang";
  info.textContent = lang;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "md-code-copy";
  copy.textContent = "复制";
  copy.addEventListener("click", async () => {
    try {
      await copyText(code);
      copy.textContent = "已复制";
      setTimeout(() => { copy.textContent = "复制"; }, 1_500);
    } catch {
      copy.textContent = "失败";
      setTimeout(() => { copy.textContent = "复制"; }, 1_500);
    }
  });
  banner.append(info, copy);
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  highlightCode(codeEl, code);
  pre.append(codeEl);
  block.append(banner, pre);
  return block;
}

function highlightCode(target, code) {
  const atom = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  let last = 0;
  for (const match of code.matchAll(atom)) {
    appendHighlightedPlain(target, code.slice(last, match.index));
    const span = document.createElement("span");
    span.className = match[0].startsWith("/") ? "tok-comment" : "tok-string";
    span.textContent = match[0];
    target.append(span);
    last = match.index + match[0].length;
  }
  appendHighlightedPlain(target, code.slice(last));
}

function appendHighlightedPlain(target, text) {
  if (text.length === 0) return;
  const pattern = /(\b(?:abstract|async|await|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|export|extends|false|final|finally|float|for|from|function|if|implements|import|instanceof|int|interface|let|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|true|try|typeof|undefined|var|void|volatile|while|with|yield)\b)|([A-Za-z_][A-Za-z0-9_]*(?=\())|(\b[A-Z][A-Za-z0-9_]*\b)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) target.append(text.slice(last, match.index));
    const span = document.createElement("span");
    span.textContent = match[0];
    if (match[1] !== undefined) span.className = "tok-keyword";
    else if (match[2] !== undefined) span.className = "tok-function";
    else span.className = "tok-type";
    target.append(span);
    last = match.index + match[0].length;
  }
  if (last < text.length) target.append(text.slice(last));
}

function lastNonEmptyLine(text) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}

function toolTitle(name) {
  return TOOL_TITLE[name] ?? name ?? "Tool";
}

function toolBody(event) {
  const args = event.args ?? {};
  if (event.name === "bash") return args.command ?? summary(event);
  if (event.name === "grep") {
    const where = [args.path, args.include].filter(Boolean).join(" · ");
    return where ? `${args.pattern}  ${where}` : String(args.pattern ?? summary(event));
  }
  if (event.name === "read_file" || event.name === "write_file" || event.name === "edit") {
    return args.path || args.file_path || summary(event);
  }
  if (event.name === "list_files") return args.path || ".";
  return summary(event);
}

function createThink(text, options = {}) {
  const details = document.createElement("details");
  details.className = "msg msg-tool msg-think";
  if (options.open) details.open = true;
  const summaryEl = document.createElement("summary");
  summaryEl.className = "think-summary";
  const label = document.createElement("span");
  label.className = "think-label";
  label.textContent = "Think";
  const preview = document.createElement("span");
  preview.className = "think-preview";
  preview.textContent = lastNonEmptyLine(text) || "思考中";
  summaryEl.append(label, preview);
  const body = document.createElement("p");
  body.className = "msg-body think-body";
  body.textContent = text;
  details.append(summaryEl, body);
  return details;
}

function makeCollapsible(article, body, limit) {
  if ((body.textContent?.length ?? 0) <= limit) return;
  article.classList.add("msg-collapsed");
  const more = document.createElement("button");
  more.type = "button";
  more.className = "msg-expand";
  more.textContent = "展开";
  more.addEventListener("click", () => {
    const collapsed = article.classList.toggle("msg-collapsed");
    more.textContent = collapsed ? "展开" : "收起";
  });
  article.append(more);
}

function renderTranscript(events) {
  transcript.replaceChildren();
  liveThink = null;
  const merged = mergeFlowEvents(events);
  const hasConversation = merged.some((event) =>
    event.type === "user"
    || event.type === "assistant"
    || event.type === "tool_call"
    || event.type === "tool_result"
    || (event.type === "assistant_chunk" && event.kind === "reasoning")
  );
  stage.classList.toggle("is-hero", !hasConversation);
  if (!hasConversation) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "";
    transcript.append(empty);
    return;
  }
  for (const event of merged) {
    if (event.type === "assistant_chunk" && event.kind === "reasoning") {
      if ((event.text ?? "").trim().length === 0) continue;
      transcript.append(createThink(event.text));
      continue;
    }
    if (event.type === "assistant_chunk" || TRANSCRIPT_SKIP.has(event.type)) continue;
    const article = document.createElement("article");
    const kind = event.type === "user"
      ? "msg-user"
      : event.type === "assistant"
        ? "msg-assistant"
        : event.type === "tool_call" || event.type === "tool_result"
          ? "msg-tool"
          : event.type === "end" && event.reason !== "completed"
            ? "msg-tool msg-error"
            : "msg-tool";
    article.className = `msg ${kind}`;
    const meta = document.createElement("p");
    meta.className = "msg-meta";
    meta.textContent = event.type === "tool_call"
      ? toolTitle(event.name)
      : event.type === "tool_result"
        ? `${toolTitle(event.name)} 结果`
        : TYPE_LABEL[event.type] ?? event.type;
    const body = document.createElement(event.type === "assistant" ? "div" : "p");
    body.className = event.type === "assistant" ? "msg-body markdown" : "msg-body";
    if (event.type === "assistant") renderMarkdown(body, event.text);
    else if (event.type === "tool_call") body.textContent = toolBody(event);
    else if (event.type === "tool_result") body.textContent = event.output ?? "";
    else body.textContent = summary(event);
    article.append(meta, body);
    if (event.type === "user") article.append(createMessageActions(event, { copyLabel: "复制输入" }));
    if (event.type === "assistant") article.append(createMessageActions(event, { copyLabel: "复制回复", includeFork: true }));
    if (event.type === "tool_result") makeCollapsible(article, body, 240);
    transcript.append(article);
  }
  scrollMainToBottom();
}

function createMessageActions(event, options = {}) {
  const copyLabel = options.copyLabel ?? "复制";
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "msg-action";
  copy.innerHTML = svgIcon("copy");
  copy.title = copyLabel;
  copy.setAttribute("aria-label", copyLabel);
  copy.addEventListener("click", async () => {
    try {
      await copyText(event.text ?? "");
      copy.textContent = "✓";
      copy.title = "已复制";
      setTimeout(() => { copy.innerHTML = svgIcon("copy"); copy.title = copyLabel; }, 1_500);
    } catch {
      mainStatus.textContent = "复制失败";
      mainStatus.classList.add("error");
    }
  });
  actions.append(copy);
  if (options.includeFork) {
    const fork = document.createElement("button");
    fork.type = "button";
    fork.className = "msg-action";
    fork.innerHTML = svgIcon("fork");
    fork.title = `从这条回复创建分支（事件 #${event.seq}）`;
    fork.setAttribute("aria-label", "从这条回复创建分支");
    fork.disabled = !Number.isInteger(event.seq);
    fork.addEventListener("click", () => { void forkSessionAt(event.seq, "chat"); });
    actions.append(fork);
  }
  return actions;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("copy unavailable");
}

function appendLiveReasoning(delta) {
  transcript.querySelector(".hint")?.remove();
  stage.classList.remove("is-hero");
  if (liveThink === null) {
    liveThink = createThink(delta);
    transcript.append(liveThink);
  } else {
    const body = liveThink.querySelector(".think-body");
    const preview = liveThink.querySelector(".think-preview");
    body.textContent += delta;
    preview.textContent = lastNonEmptyLine(body.textContent) || "思考中";
  }
  followLiveOutput();
}

function appendLiveTool(event) {
  transcript.querySelector(".hint")?.remove();
  const article = document.createElement("article");
  article.className = "msg msg-tool";
  const meta = document.createElement("p");
  meta.className = "msg-meta";
  meta.textContent = event.type === "tool_result" ? `${toolTitle(event.name)} 结果` : toolTitle(event.name);
  const body = document.createElement("p");
  body.className = "msg-body";
  body.textContent = event.type === "tool_result" ? (event.output ?? "") : toolBody(event);
  article.append(meta, body);
  if (event.type === "tool_result") makeCollapsible(article, body, 240);
  transcript.append(article);
  followLiveOutput();
}

function appendLiveMessage(label, text, className = "") {
  transcript.querySelector(".hint")?.remove();
  const article = document.createElement("article");
  const kind = label === "用户" ? "msg-user" : "msg-assistant";
  article.className = `msg ${kind} ${className}`.trim();
  const meta = document.createElement("p");
  meta.className = "msg-meta";
  meta.textContent = label;
  const assistant = label !== "用户";
  const body = document.createElement(assistant ? "div" : "p");
  body.className = assistant ? "msg-body markdown" : "msg-body";
  if (assistant && text.length > 0) renderMarkdown(body, text);
  else body.textContent = text;
  article.append(meta, body);
  if (label === "用户") article.append(createMessageActions({ text }, { copyLabel: "复制输入" }));
  transcript.append(article);
  followLiveOutput();
  return body;
}

function renderLiveEvent(event) {
  if (event.type === "user") {
    liveThink = null;
    stage.classList.remove("is-hero");
    appendLiveMessage("用户", event.text);
    return;
  }
  if (event.type === "assistant_chunk" && event.kind === "reasoning") {
    mainStatus.textContent = "模型思考中…";
    appendLiveReasoning(event.text ?? "");
    return;
  }
  if (event.type === "assistant_chunk" && event.kind === "tool_call") {
    liveThink = null;
    mainStatus.textContent = "模型正在组装工具调用…";
    return;
  }
  if (event.type === "assistant_chunk" && event.kind === "text") {
    liveThink = null;
    let article = transcript.querySelector(".msg-streaming");
    let body;
    if (article === null) {
      body = appendLiveMessage("助手 · 生成中", "", "msg-streaming");
      article = body.closest("article");
      article.dataset.stream = "";
    } else {
      body = article.querySelector(".msg-body");
    }
    article.dataset.stream = `${article.dataset.stream ?? ""}${event.text}`;
    renderMarkdown(body, article.dataset.stream);
    followLiveOutput();
    return;
  }
  if (event.type === "tool_call" || event.type === "tool_result") {
    liveThink = null;
    appendLiveTool(event);
  }
}

async function readTurnStream(response, target) {
  if (!response.ok || response.body === null) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "发送失败");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n|\r/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      const dataText = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (event && dataText) {
        const data = JSON.parse(dataText);
        if (event === "agent_status" && canPaintLive(target.source, target.file)) {
          mainStatus.textContent = data.status === "running" ? "Agent 运行中…" : "Agent 空闲";
        }
        if (event === "session_event" && canPaintLive(target.source, target.file)) renderLiveEvent(data);
        if (event === "done") result = data;
        if (event === "error") throw new Error(data.error ?? "发送失败");
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (result === null) throw new Error("流式响应未正常结束");
  return result;
}

function renderSession(data) {
  workspaceRoot.value = data.workspaceRoot ?? "";
  selectedWorkspace = data.workspaceRoot ?? selectedWorkspace;
  renderWorkspacePicker();
  updateWorkspaceControls();
  mainStatus.textContent = `${data.events.length} 条原始事件`;
  mainStatus.classList.remove("error");
  renderTranscript(data.events);
  renderFlow(data.events);
}

function markCurrentButton() {
  for (const item of sessionList.querySelectorAll(".session-select")) {
    const selected =
      current !== null &&
      item.dataset.source === current.source &&
      item.dataset.file === current.file;
    item.setAttribute("aria-current", selected ? "true" : "false");
  }
}

async function loadSession(source, file) {
  const key = `${source}/${file}`;
  const run = runningSessions.get(key);
  if (run !== undefined) run.live = false;
  current = { source, file };
  sessionTitle.textContent = `${source}/${file}`;
  mainStatus.textContent = "加载中…";
  markCurrentButton();
  updateComposer();
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(source)}/${encodeURIComponent(file)}`,
    );
    const data = await res.json();
    if (!isCurrentSession(source, file)) return;
    if (!res.ok) throw new Error(data.error ?? "加载失败");
    renderSession(data);
    const stillRunning = runningSessions.get(key);
    if (stillRunning !== undefined) {
      stillRunning.live = true;
      mainStatus.textContent = "Agent 运行中…";
    }
  } catch (err) {
    if (!isCurrentSession(source, file)) return;
    mainStatus.textContent = err instanceof Error ? err.message : "加载失败";
    mainStatus.classList.add("error");
    renderTranscript([]);
  }
}

function addSessionButton(session, click, parent = sessionList) {
  const li = document.createElement("li");
  li.className = "session-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-select";
  const title = document.createElement("span");
  title.className = "session-name";
  title.textContent = session.title ?? `${session.source}/${session.file}`;
  const time = document.createElement("time");
  time.className = "session-time";
  time.textContent = relativeTime(session.updatedAt ?? Date.now());
  button.append(title, time);
  button.dataset.source = session.source;
  button.dataset.file = session.file;
  button.setAttribute("aria-busy", runningSessions.has(sessionKey(session)) ? "true" : "false");
  button.addEventListener("click", () => {
    void loadSession(session.source, session.file);
  });
  li.append(button);
  if (session.source === "tmp") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "session-delete";
    remove.textContent = "删除";
    remove.title = `删除 ${session.source}/${session.file}`;
    remove.setAttribute("aria-label", `删除会话 ${session.source}/${session.file}`);
    remove.dataset.source = session.source;
    remove.dataset.file = session.file;
    remove.disabled = managingSessions || runningSessions.has(sessionKey(session));
    remove.addEventListener("click", () => {
      void deleteSession(session);
    });
    li.append(remove);
  }
  parent.append(li);
  if (click) button.click();
}

function renderSessionTree(sessions, select) {
  sessionList.replaceChildren();
  const query = workspaceSearch.value.trim().toLowerCase();
  const visible = query.length === 0
    ? sessions
    : sessions.filter((session) => session.title.toLowerCase().includes(query));
  const filtered = hideBlankSessions
    ? visible.filter((session) => session.title !== "新会话")
    : visible;
  const groups = new Map();
  for (const session of filtered) {
    const groupRoot = removedWorkspaces.has(session.workspaceRoot) ? "" : session.workspaceRoot;
    const group = groups.get(groupRoot) ?? [];
    group.push(session);
    groups.set(groupRoot, group);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    if (left === "") return 1;
    if (right === "") return -1;
    return (workspaceAliases[left] ?? pathName(left)).localeCompare(
      workspaceAliases[right] ?? pathName(right),
      "zh-CN",
    );
  });
  for (const [root, groupSessions] of orderedGroups) {
    const group = document.createElement("li");
    group.className = "workspace-group";
    const header = document.createElement("button");
    header.type = "button";
    header.className = "workspace-row";
    header.classList.toggle("workspace-ungrouped", root === "");
    header.dataset.root = root;
    header.innerHTML = `<span class="workspace-chevron">${svgIcon("chevron")}</span><span class="workspace-folder">${svgIcon("folder")}</span><span class="workspace-name"></span><span class="workspace-menu-trigger">•••</span><span class="workspace-plus">${svgIcon("plus")}</span>`;
    header.querySelector(".workspace-name").textContent = root === "" ? "未分组" : (workspaceAliases[root] ?? pathName(root));
    header.title = root || "已删除工作区中的会话";
    const children = document.createElement("ul");
    children.className = "workspace-sessions";
    header.addEventListener("click", (event) => {
      if (event.target.closest(".workspace-menu-trigger") && root !== "") {
        event.stopPropagation();
        openWorkspaceMenu(header, root);
        return;
      }
      if (root !== "") selectedWorkspace = root;
      if (event.target.closest(".workspace-plus")) {
        if (root === "") return;
        void createSession(root);
        return;
      }
      group.classList.toggle("collapsed");
    });
    const orderedSessions = [...groupSessions].sort((left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      || right.file.localeCompare(left.file),
    );
    for (const session of orderedSessions) {
      const shouldClick = select !== undefined && session.source === select.source && session.file === select.file;
      addSessionButton(session, shouldClick, children);
    }
    group.append(header, children);
    sessionList.append(group);
  }
}

function openWorkspaceMenu(anchor, root) {
  document.querySelector(".workspace-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "workspace-menu";
  menu.innerHTML = `<button type="button" data-action="rename"><span>✎</span>重命名</button><button type="button" data-action="delete" class="danger"><span>♲</span>删除工作区</button>`;
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom - 3}px`;
  menu.style.left = `${Math.min(rect.right - 80, window.innerWidth - 248)}px`;
  document.body.append(menu);
  const close = (event) => {
    if (!menu.contains(event.target)) menu.remove();
  };
  setTimeout(() => document.addEventListener("click", close, { once: true }));
  menu.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "rename") {
      const name = window.prompt("重命名工作区", workspaceAliases[root] ?? pathName(root));
      if (name !== null && name.trim().length > 0) workspaceAliases[root] = name.trim();
    } else if (action === "delete") {
      menu.remove();
      void deleteWorkspace(root);
      return;
    } else {
      return;
    }
    saveWorkspacePreferences();
    menu.remove();
    renderSessionTree(listedSessions);
  });
}

function openComposerAddMenu() {
  document.querySelector(".composer-add-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "composer-add-menu";
  const workspaceName = selectedWorkspace
    ? (workspaceAliases[selectedWorkspace] ?? pathName(selectedWorkspace))
    : "未分组";
  menu.innerHTML = `<button type="button" data-action="promo-video"><span>▷</span><span><strong>生成宣传视频</strong><small></small></span></button>`;
  menu.querySelector("small").textContent = `基于 ${workspaceName} 的源码生成`;
  const rect = attachButton.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  document.body.append(menu);
  const close = (event) => {
    if (!menu.contains(event.target) && event.target !== attachButton) menu.remove();
  };
  setTimeout(() => document.addEventListener("click", close, { once: true }));
  menu.addEventListener("click", (event) => {
    if (event.target.closest("button")?.dataset.action !== "promo-video") return;
    menu.remove();
    void startPromoVideo(selectedWorkspace);
  });
}

async function deleteWorkspace(root) {
  if (managingSessions) return;
  const sessions = listedSessions.filter((session) => session.source === "tmp" && session.workspaceRoot === root);
  if (sessions.some((session) => isRunning(session))) {
    sessionStatus.textContent = "该工作区仍有会话正在运行，请先停止后再删除。";
    sessionStatus.classList.add("error");
    return;
  }
  const name = workspaceAliases[root] ?? pathName(root);
  if (!window.confirm(`确定删除工作区「${name}」及其 ${sessions.length} 个会话吗？会话文件将被永久删除，此操作无法撤销。`)) return;
  managingSessions = true;
  updateSessionActions();
  try {
    const res = await fetch(`/api/sessions/tmp?workspaceRoot=${encodeURIComponent(root)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "删除工作区失败");
    const currentDeleted = sessions.some((session) =>
      current?.source === session.source && current?.file === session.file);
    if (currentDeleted) clearSessionView();
    removedWorkspaces.delete(root);
    delete workspaceAliases[root];
    if (selectedWorkspace === root) selectedWorkspace = "";
    saveWorkspacePreferences();
    await refreshSessions();
    sessionStatus.textContent = `已删除工作区「${name}」及 ${data.deleted} 个会话`;
    sessionStatus.classList.remove("error");
  } catch (err) {
    sessionStatus.textContent = err instanceof Error ? err.message : "删除工作区失败";
    sessionStatus.classList.add("error");
  } finally {
    managingSessions = false;
    updateSessionActions();
  }
}

async function refreshSessions(select) {
  sessionList.replaceChildren();
  sessionStatus.textContent = "加载会话列表…";
  sessionStatus.classList.remove("error");
  const res = await fetch("/api/sessions");
  const sessions = await res.json();
  if (!res.ok) throw new Error(sessions.error ?? "列表加载失败");
  listedSessions = sessions;
  renderWorkspacePicker();
  tmpSessionCount = sessions.filter((session) => session.source === "tmp").length;
  if (sessions.length === 0) {
    sessionStatus.textContent = "还没有会话。点「新建会话」开始。";
    clearSessionView();
    updateSessionActions();
    return;
  }
  sessionStatus.textContent = `${sessions.length} 个会话`;
  renderSessionTree(sessions, select);
  updateSessionActions();
  if (select === undefined) {
    const first = sessionList.querySelector(".session-select[data-source='tmp']") ?? sessionList.querySelector(".session-select");
    first?.click();
  }
}

async function deleteSession(session) {
  if (managingSessions || isRunning(session)) return;
  const label = `${session.source}/${session.file}`;
  if (!window.confirm(`确定删除会话「${label}」吗？此操作无法撤销。`)) return;
  managingSessions = true;
  updateSessionActions();
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(session.source)}/${encodeURIComponent(session.file)}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "删除失败");
    if (
      current?.source === session.source &&
      current?.file === session.file
    ) {
      clearSessionView();
    }
    await refreshSessions();
    sessionStatus.textContent = `已删除 ${label}`;
    sessionStatus.classList.remove("error");
  } catch (err) {
    sessionStatus.textContent = err instanceof Error ? err.message : "删除失败";
    sessionStatus.classList.add("error");
  } finally {
    managingSessions = false;
    updateSessionActions();
  }
}

async function clearAllSessions() {
  if (managingSessions || runningSessions.size > 0 || tmpSessionCount === 0) return;
  if (
    !window.confirm(
      `确定清空全部 ${tmpSessionCount} 个临时会话吗？fixture 不会删除，此操作无法撤销。`,
    )
  ) {
    return;
  }
  managingSessions = true;
  updateSessionActions();
  try {
    const res = await fetch("/api/sessions/tmp", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "清空失败");
    clearSessionView();
    await refreshSessions();
    sessionStatus.textContent = `已清空 ${data.deleted} 个临时会话`;
    sessionStatus.classList.remove("error");
  } catch (err) {
    sessionStatus.textContent = err instanceof Error ? err.message : "清空失败";
    sessionStatus.classList.add("error");
  } finally {
    managingSessions = false;
    updateSessionActions();
  }
}

async function startPromoVideo(root) {
  if (managingSessions) return;
  selectedWorkspace = root;
  sessionStatus.classList.remove("error");
  sessionStatus.textContent = "正在开始生成宣传视频…";
  try {
    const promptRes = await fetch("/api/prompts/promo-video");
    const prompt = await promptRes.json();
    if (!promptRes.ok) throw new Error(prompt.error ?? "无法加载宣传视频提示词");
    const session = await createSession(root);
    if (session === undefined) return;
    await loadSession(session.source, session.file);
    await sendTurn(prompt.text);
  } catch (err) {
    sessionStatus.textContent = err instanceof Error ? err.message : "无法开始生成宣传视频";
    sessionStatus.classList.add("error");
  }
}

async function createSession(workspace = selectedWorkspace) {
  if (managingSessions) return;
  managingSessions = true;
  updateSessionActions();
  composerHint.textContent = "";
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: workspace }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "无法新建会话");
    await refreshSessions(data);
    return data;
  } finally {
    managingSessions = false;
    updateSessionActions();
  }
}

async function forkSessionAt(seq, targetTab = "flow") {
  if (!current || managingSessions) return;
  managingSessions = true;
  updateSessionActions();
  mainStatus.textContent = `正在从事件 #${seq} Fork…`;
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(current.source)}/${encodeURIComponent(current.file)}/fork`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seq }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Fork 失败");
    await refreshSessions(data);
    setTab(targetTab);
    mainStatus.textContent = `已从事件 #${seq} Fork`;
  } catch (error) {
    mainStatus.textContent = error instanceof Error ? error.message : "Fork 失败";
    mainStatus.classList.add("error");
  } finally {
    managingSessions = false;
    updateSessionActions();
  }
}

async function sendTurn(text) {
  if (!current || current.source !== "tmp" || isRunning(current)) return;
  const target = { source: current.source, file: current.file };
  const key = sessionKey(target);
  draft.value = "";
  draft.style.height = "auto";
  runningSessions.set(key, { ...target, live: true });
  updateComposer();
  updateSessionActions();
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(target.source)}/${encodeURIComponent(target.file)}/turn`,
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );
    const data = await readTurnStream(res, target);
    if (isCurrentSession(target.source, target.file)) renderSession(data);
  } catch (err) {
    if (isCurrentSession(target.source, target.file)) {
      mainStatus.textContent = err instanceof Error ? err.message : "发送失败";
      mainStatus.classList.add("error");
    }
  } finally {
    runningSessions.delete(key);
    updateComposer();
    updateSessionActions();
    if (isCurrentSession(target.source, target.file)) draft.focus();
  }
}

async function injectTurn(text) {
  if (!current || current.source !== "tmp" || !isRunning(current)) return;
  const target = { source: current.source, file: current.file };
  draft.value = "";
  draft.style.height = "auto";
  updateComposer();
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(target.source)}/${encodeURIComponent(target.file)}/inject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "引导发送失败");
    if (isCurrentSession(target.source, target.file)) {
      mainStatus.textContent = "引导已接收，将在下一步生效";
      mainStatus.classList.remove("error");
    }
  } catch (err) {
    if (isCurrentSession(target.source, target.file)) {
      if (draft.value.length === 0) draft.value = text;
      mainStatus.textContent = err instanceof Error ? err.message : "引导发送失败";
      mainStatus.classList.add("error");
      updateComposer();
    }
  }
}

async function stopTurn({ keepalive = false } = {}) {
  if (!current || current.source !== "tmp" || !isRunning(current)) return;
  stop.disabled = true;
  mainStatus.textContent = "正在停止…";
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(current.source)}/${encodeURIComponent(current.file)}/stop`,
      { method: "POST", keepalive },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "停止失败");
    mainStatus.textContent = data.cancelled ? "已停止" : "Agent 已空闲";
    mainStatus.classList.remove("error");
  } catch (err) {
    mainStatus.textContent = err instanceof Error ? err.message : "停止失败";
    mainStatus.classList.add("error");
    stop.disabled = false;
  }
}

async function updateWorkspace() {
  if (!current || current.source !== "tmp" || isRunning() || managingSessions) return;
  const selected = { ...current };
  const path = workspaceRoot.value.trim();
  if (path.length === 0) return;
  workspaceRoot.disabled = true;
  saveWorkspace.disabled = true;
  mainStatus.textContent = "正在切换工作区…";
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(selected.source)}/${encodeURIComponent(selected.file)}/workspace`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "工作区切换失败");
    if (current?.source === selected.source && current?.file === selected.file) {
      workspaceRoot.value = data.workspaceRoot;
      await loadSession(selected.source, selected.file);
      mainStatus.textContent = `工作区已切换到 ${data.workspaceRoot}`;
      mainStatus.classList.remove("error");
    }
  } catch (err) {
    mainStatus.textContent = err instanceof Error ? err.message : "工作区切换失败";
    mainStatus.classList.add("error");
  } finally {
    updateWorkspaceControls();
  }
}

tabChat.addEventListener("click", () => setTab("chat"));
tabFlow.addEventListener("click", () => setTab("flow"));
draft.addEventListener("input", () => {
  draft.style.height = "auto";
  draft.style.height = `${Math.min(draft.scrollHeight, 240)}px`;
  updateComposer();
});
draft.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!send.disabled) composer.requestSubmit();
  }
});
composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = draft.value.trim();
  if (text.length === 0 || send.disabled) return;
  if (isRunning()) void injectTurn(text);
  else void sendTurn(text);
});
attachButton.addEventListener("click", () => {
  if (managingSessions) return;
  const menu = document.querySelector(".composer-add-menu");
  if (menu !== null) {
    menu.remove();
    return;
  }
  openComposerAddMenu();
});
newSession.addEventListener("click", () => {
  void createSession().catch((err) => {
    sessionStatus.textContent = err instanceof Error ? err.message : "无法新建会话";
    sessionStatus.classList.add("error");
  });
});
addWorkspace.addEventListener("click", async () => {
  if (managingSessions) return;
  addWorkspace.disabled = true;
  sessionStatus.classList.remove("error");
  sessionStatus.textContent = "正在选择工作区…";
  try {
    const res = await fetch("/api/workspaces/pick", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "无法打开目录选择器");
    if (data.cancelled) {
      sessionStatus.classList.remove("error");
      sessionStatus.textContent = `${listedSessions.length} 个会话`;
      return;
    }
    selectedWorkspace = data.workspaceRoot;
    workspaceRoot.value = selectedWorkspace;
    removedWorkspaces.delete(selectedWorkspace);
    saveWorkspacePreferences();
    renderWorkspacePicker();
    await createSession(selectedWorkspace);
  } catch (err) {
    sessionStatus.textContent = err instanceof Error ? err.message : "无法添加工作区";
    sessionStatus.classList.add("error");
  } finally {
    addWorkspace.disabled = false;
  }
});
workspacePicker.addEventListener("click", () => {
  const opening = workspacePickerMenu.hidden;
  if (!opening) {
    closeWorkspacePicker();
    return;
  }
  renderWorkspacePicker();
  workspacePickerMenu.hidden = false;
  workspacePicker.setAttribute("aria-expanded", "true");
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".workspace-control")) closeWorkspacePicker();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeWorkspacePicker();
});
searchWorkspaces.addEventListener("click", () => {
  workspaceSearchWrap.hidden = !workspaceSearchWrap.hidden;
  if (!workspaceSearchWrap.hidden) workspaceSearch.focus();
});
workspaceSearch.addEventListener("input", () => {
  renderSessionTree(listedSessions);
});
filterSessions.addEventListener("click", () => {
  hideBlankSessions = !hideBlankSessions;
  filterSessions.classList.toggle("active", hideBlankSessions);
  filterSessions.setAttribute("aria-pressed", String(hideBlankSessions));
  renderSessionTree(listedSessions);
});
clearSessions.addEventListener("click", () => {
  void clearAllSessions();
});
stop.addEventListener("click", () => {
  void stopTurn();
});
workspaceRoot.addEventListener("input", updateWorkspaceControls);
workspaceRoot.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !saveWorkspace.disabled) void updateWorkspace();
});
saveWorkspace.addEventListener("click", () => {
  void updateWorkspace();
});
window.addEventListener("pagehide", () => {
  for (const run of runningSessions.values()) {
    const url = `/api/sessions/${encodeURIComponent(run.source)}/${encodeURIComponent(run.file)}/stop`;
    navigator.sendBeacon(url, "");
  }
});
openSettings.addEventListener("click", () => {
  void showModelSettings();
});
settingsNav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button === null) return;
  const tab = button.dataset.tab;
  for (const item of settingsNav.querySelectorAll("button")) item.classList.toggle("active", item === button);
  generalPanel.hidden = tab !== "general";
  modelPanel.hidden = tab !== "model";
  pluginsPanel.hidden = tab !== "plugins";
  placeholderPanel.hidden = tab === "general" || tab === "model" || tab === "plugins";
  settingsForm.querySelector(".dialog-actions").hidden = tab !== "general" && tab !== "model";
  dashscopeApiKey.disabled = tab !== "general";
  clearDashscopeApiKey.disabled = tab !== "general";
  if (tab !== "model") setModelEditorDisabled(true);
  else setModelEditorDisabled(modelProfileEditor.hidden);
  const titles = {
    general: ["通用设置", "管理跨功能使用的共享服务与凭据。"],
    model: ["模型", "管理对话模型提供方与可用模型。"],
    plugins: ["插件", "配置和查看本部署已安装的插件。"],
  };
  settingsForm.querySelector("#settings-title").textContent = titles[tab][0];
  settingsForm.querySelector("#settings-description").textContent = titles[tab][1];
});
pluginSearch.addEventListener("input", renderPlugins);
main.addEventListener("scroll", () => {
  const distance = main.scrollHeight - main.clientHeight - main.scrollTop;
  followLatest = distance < 80;
  scrollToBottom.hidden = stage.classList.contains("is-hero") || distance < 80;
});
scrollToBottom.addEventListener("click", () => {
  scrollMainToBottom({ smooth: true });
});
closeSettings.addEventListener("click", dismissModelSettings);
cancelSettings.addEventListener("click", dismissModelSettings);
llmApiKey.addEventListener("input", () => {
  keyError.textContent = apiKeyFailure(llmApiKey.value);
});
dashscopeApiKey.addEventListener("input", () => {
  dashscopeKeyError.textContent = apiKeyFailure(dashscopeApiKey.value);
  if (dashscopeApiKey.value.length > 0) clearDashscopeApiKey.checked = false;
});
async function removeModelProfile(profile) {
  if (!profile || !confirm(`删除模型配置“${profile.name}”？`)) return;
  settingsStatus.textContent = "删除中…";
  try {
    const res = await fetch("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteProfileId: profile.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "删除模型配置失败");
    renderModelSettings(data);
    settingsStatus.textContent = "已删除模型配置。";
  } catch (err) {
    settingsStatus.textContent = err instanceof Error ? err.message : "删除模型配置失败";
    settingsStatus.classList.add("error");
  }
}
providerCatalog.replaceChildren(...Object.entries(MODEL_PROVIDER_CATALOG).map(([id, provider]) => new Option(provider.name, id)));
providerCatalog.addEventListener("change", () => {
  const provider = MODEL_PROVIDER_CATALOG[providerCatalog.value];
  if (!provider) return;
  modelProfileId.value = providerCatalog.value;
  modelProfileName.value = provider.name;
  llmBaseURL.value = provider.baseURL;
  setModelOptions([provider.model], [provider.model]);
});
addCatalogProvider.addEventListener("click", () => {
  providerCatalog.value = Object.keys(MODEL_PROVIDER_CATALOG).find((id) => !modelSettings?.profiles?.some((profile) => profile.id === id)) ?? "deepseek";
  const provider = MODEL_PROVIDER_CATALOG[providerCatalog.value];
  openModelEditor({ id: providerCatalog.value, ...provider, hasApiKey: false }, { create: true, catalog: true });
});
addCustomProvider.addEventListener("click", () => {
  openModelEditor({ id: `provider-${Date.now()}`, name: "自定义提供方", baseURL: "https://", model: "", hasApiKey: false }, { create: true });
  modelProfileName.focus();
});
cancelModelEditor.addEventListener("click", () => renderModelSettings(modelSettings));
discoverModels.addEventListener("click", () => void discoverAvailableModels());
addManualModel.addEventListener("click", () => {
  const model = prompt("输入模型名称", llmModel.value)?.trim();
  if (!model) return;
  const selected = [...llmModel.selectedOptions].map((option) => option.value).concat(model);
  setModelOptions([...llmModel.options].map((option) => option.value).concat(model), selected);
});
llmModel.addEventListener("mousedown", (event) => {
  const option = event.target.closest("option");
  if (!option) return;
  event.preventDefault();
  option.selected = !option.selected;
  llmModel.dispatchEvent(new Event("change", { bubbles: true }));
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!generalPanel.hidden) {
    void saveGeneralSettings();
    return;
  }
  if (modelPanel.hidden) {
    settingsDialog.close();
    return;
  }
  void saveModelSettings();
});
modelSelection.addEventListener("change", async () => {
  const previous = modelSelection.value;
  const [profileId, model] = modelSelection.value.split("|").map(decodeURIComponent);
  modelSelection.disabled = true;
  try {
    const res = await fetch("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeProfileId: profileId, activeModel: model }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "切换模型失败");
    renderModelSettings(data);
    mainStatus.textContent = `已切换到 ${data.profiles?.find((profile) => profile.id === data.activeProfileId)?.name ?? data.model}`;
    mainStatus.classList.remove("error");
  } catch (err) {
    modelSelection.value = previous;
    mainStatus.textContent = err instanceof Error ? err.message : "切换模型失败";
    mainStatus.classList.add("error");
  } finally {
    modelSelection.disabled = false;
  }
});

void Promise.all([refreshSessions(), loadModelSettings()])
  .catch((err) => {
    mainStatus.textContent = err instanceof Error ? err.message : "初始化失败";
    mainStatus.classList.add("error");
  })
  .then(updateComposer);

let developmentVersion = null;
setInterval(async () => {
  try {
    const res = await fetch("/api/dev/version", { cache: "no-store" });
    if (!res.ok) return;
    const { version } = await res.json();
    if (developmentVersion !== null && version !== developmentVersion) {
      window.location.reload();
      return;
    }
    developmentVersion = version;
  } catch {
    // tsx watch 重启服务期间短暂断开，下一次轮询会继续比较版本。
  }
}, 1_000);
