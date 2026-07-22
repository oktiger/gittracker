use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizedMessage {
    pub key: String,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, serde_json::Value>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutputLine {
    pub stream: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSession {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub target_id: String,
    pub target_name: String,
    pub cwd: String,
    pub command: String,
    /// starting | running | stopping | exited | failed | stopped
    pub status: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub output: Vec<RunOutputLine>,
    #[serde(default)]
    pub output_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProgressEvent {
    pub session_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<LocalizedMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LanguagePreference {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ResolvedLanguage {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[default]
    #[serde(rename = "en")]
    En,
}

impl ResolvedLanguage {
    pub fn is_zh(self) -> bool {
        matches!(self, Self::ZhCn)
    }
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

pub fn default_document_execute_prompt_template() -> String {
    "执行这个文档。".to_string()
}

pub fn default_goal_prompt_template_en() -> String {
    r#"You are a project planning assistant. Break the project goal and repository context below into executable tasks.

You may consult public sources, but the goal and current repository are authoritative. Do not invent modules that do not exist.

Output requirements:
1. Output only the task list, with no introduction or conclusion
2. Each task must be small enough for one person or one AI implementation run
3. Repeat this exact format:

### Task
title: A title of at most 12 words
body: |
  - What to implement
  - Acceptance criteria
  - Relevant paths or modules, when known
"#.to_string()
}

pub fn default_task_prompt_template_en() -> String {
    r#"You are an implementation assistant. Implement the task document below in the current project directory.

Requirements:
1. Modify or create the necessary files and complete the task
2. Do not run git commit or git push
3. Finish with a concise implementation summary describing what changed and how to verify it
"#.to_string()
}

pub fn default_document_execute_prompt_template_en() -> String {
    "Execute this document.".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateSet {
    pub goal: String,
    pub task: String,
    #[serde(default = "default_document_execute_prompt_template")]
    pub document_execute: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplates {
    #[serde(rename = "zh-CN")]
    pub zh_cn: PromptTemplateSet,
    pub en: PromptTemplateSet,
}

impl Default for PromptTemplates {
    fn default() -> Self {
        Self {
            zh_cn: PromptTemplateSet {
                goal: default_goal_prompt_template(),
                task: default_task_prompt_template(),
                document_execute: default_document_execute_prompt_template(),
            },
            en: PromptTemplateSet {
                goal: default_goal_prompt_template_en(),
                task: default_task_prompt_template_en(),
                document_execute: default_document_execute_prompt_template_en(),
            },
        }
    }
}

impl PromptTemplates {
    pub fn for_language(&self, locale: ResolvedLanguage) -> &PromptTemplateSet {
        if locale.is_zh() {
            &self.zh_cn
        } else {
            &self.en
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub ai_provider: AiProvider,
    #[serde(default)]
    pub language: LanguagePreference,
    /// 每日完成自动生成开关；默认关闭。
    #[serde(default)]
    pub daily_completion_enabled: bool,
    /// 本地时间，格式 HH:MM。
    #[serde(default = "default_daily_completion_time")]
    pub daily_completion_time: String,
    #[serde(default)]
    pub prompt_templates: PromptTemplates,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_prompt_template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_prompt_template: Option<String>,
}

fn default_daily_completion_time() -> String {
    "00:00".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ai_provider: AiProvider::Codex,
            language: LanguagePreference::System,
            daily_completion_enabled: false,
            daily_completion_time: default_daily_completion_time(),
            prompt_templates: PromptTemplates::default(),
            goal_prompt_template: None,
            task_prompt_template: None,
        }
    }
}

impl AppSettings {
    pub fn migrate_legacy_prompts(&mut self) {
        if let Some(goal) = self.goal_prompt_template.take() {
            self.prompt_templates.zh_cn.goal = goal;
        }
        if let Some(task) = self.task_prompt_template.take() {
            self.prompt_templates.zh_cn.task = task;
        }
    }
}

#[cfg(test)]
mod settings_tests {
    use super::*;

    #[test]
    fn legacy_prompts_migrate_without_losing_custom_content() {
        let raw = r#"{"aiProvider":"codex","dailyCompletionEnabled":false,"dailyCompletionTime":"18:00","goalPromptTemplate":"custom goal","taskPromptTemplate":"custom task"}"#;
        let mut settings: AppSettings = serde_json::from_str(raw).unwrap();
        settings.migrate_legacy_prompts();
        assert_eq!(settings.language, LanguagePreference::System);
        assert_eq!(settings.prompt_templates.zh_cn.goal, "custom goal");
        assert_eq!(settings.prompt_templates.zh_cn.task, "custom task");
        assert!(settings
            .prompt_templates
            .en
            .goal
            .contains("project planning assistant"));
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(!serialized.contains("goalPromptTemplate"));
    }

    #[test]
    fn resolved_language_serializes_as_public_locale_codes() {
        assert_eq!(
            serde_json::to_string(&ResolvedLanguage::ZhCn).unwrap(),
            "\"zh-CN\""
        );
        assert_eq!(
            serde_json::to_string(&ResolvedLanguage::En).unwrap(),
            "\"en\""
        );
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

/// 每日 / 周期工作总结结果：标题为日期（如 2026/07/21），正文按项目分组。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyCompletionResult {
    pub title: String,
    pub body: String,
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

/// 操作日志状态：成功 / 失败 / 进行中 / 已结束（无法确认成败）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogDiaryStatus {
    Ok,
    Error,
    Running,
    /// 进程已不可查（例如应用重启），无法确认当时成败
    Ended,
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
    /// 关联的运行中心会话，便于命令结束后回写状态
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_session_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLogDiaryByRunSession {
    pub run_session_id: String,
    pub status: LogDiaryStatus,
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
