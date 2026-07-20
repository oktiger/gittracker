use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTarget {
    pub id: String,
    pub name: String,
    /// 一行人话说明用途，菜单副标题优先显示
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 相对仓库根的工作目录，如 "." / "apps/web"
    pub cwd: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_default: bool,
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub order: i32,
    #[serde(default)]
    pub run_targets: Vec<RunTarget>,
    /// 项目内文档库的相对路径；未设置时不展示文档树。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_root: Option<String>,
}

/// 全局 AI 调用通道。项目内所有 AI 能力都必须经此设置统一路由。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    #[default]
    Codex,
    CursorAgent,
}

pub fn default_goal_prompt_template() -> String {
    r#"你是项目规划助手。请根据下方【项目目标】与【项目现状】，把目标拆成一组可执行任务。

你可以查阅公开网上资料作补充，但必须以目标与当前仓库情况为准，不要编造仓库里不存在的模块。

输出要求：
1. 只输出任务列表，不要开场白、不要总结
2. 每条任务足够小，一个人（或一次 AI 实现）能做完
3. 严格按下面格式重复多条：

### Task
title: 不超过 20 字的标题
body: |
  - 要做什么
  - 验收标准是什么
  - 涉及哪些路径/模块（若已知）
"#
    .to_string()
}

pub fn default_task_prompt_template() -> String {
    r#"你是实现助手。请根据下方【任务文档】在当前项目目录中落地实现。

要求：
1. 直接修改/创建必要文件，完成任务
2. 不要执行 git commit / push
3. 完成后用简体中文写一段「实现摘要」（改了什么、如何验收），不要其它废话
"#
    .to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub ai_provider: AiProvider,
    /// 每日完成自动生成开关；默认关闭。
    #[serde(default)]
    pub daily_completion_enabled: bool,
    /// 本地时间，格式 HH:MM。
    #[serde(default = "default_daily_completion_time")]
    pub daily_completion_time: String,
    #[serde(default = "default_goal_prompt_template")]
    pub goal_prompt_template: String,
    #[serde(default = "default_task_prompt_template")]
    pub task_prompt_template: String,
}

fn default_daily_completion_time() -> String {
    "18:00".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ai_provider: AiProvider::Codex,
            daily_completion_enabled: false,
            daily_completion_time: default_daily_completion_time(),
            goal_prompt_template: default_goal_prompt_template(),
            task_prompt_template: default_task_prompt_template(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub projects: Vec<ProjectRecord>,
    #[serde(default)]
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: String,
    pub clean: bool,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub ahead: u32,
    pub behind: u32,
    pub commits: Vec<CommitInfo>,
    pub error: Option<String>,
    #[serde(default)]
    pub run_targets: Vec<RunTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreview {
    pub files: Vec<FileChange>,
    pub recovery_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardResult {
    pub recovery_patch: Option<String>,
    pub discarded: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneClickResult {
    pub message: String,
    pub pushed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsTaskItem {
    pub number: u32,
    pub title: String,
    pub relative_path: String,
    pub status: String,
    /// "md" | "html"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsOverview {
    pub has_docs: bool,
    pub goal_exists: bool,
    /// 缺少 Goal/Task 目录或 goal.md 时为 true，前端显示「初始化」
    #[serde(default)]
    pub needs_init: bool,
    pub goal_relative_path: Option<String>,
    pub tasks: Vec<DocsTaskItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNode {
    pub name: String,
    pub relative_path: String,
    pub is_directory: bool,
    #[serde(default)]
    pub children: Vec<DocumentNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLibrary {
    pub root: Option<String>,
    #[serde(default)]
    pub entries: Vec<DocumentNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTasksResult {
    pub created: usize,
    pub overview: DocsOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTaskResult {
    pub summary: String,
    pub overview: DocsOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRunTargetsResult {
    pub targets: Vec<RunTarget>,
    /// "ai" | "heuristic"
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// 设置页「测试联通」结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub provider: AiProvider,
    pub provider_label: String,
    pub reply: String,
}

/// 操作日志状态：成功 / 失败 / 进行中
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogDiaryStatus {
    Ok,
    Error,
    Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogDiaryEntry {
    pub id: String,
    /// Unix 毫秒时间戳
    pub created_at: i64,
    /// 操作类型，如 oneClick / generateCommit / runTask
    pub kind: String,
    pub status: LogDiaryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLogDiaryEntry {
    pub kind: String,
    pub status: LogDiaryStatus,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogDiaryStore {
    pub entries: Vec<LogDiaryEntry>,
}
