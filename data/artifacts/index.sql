CREATE INDEX idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX idx_artifacts_chat_id ON artifacts(chat_id);
CREATE INDEX idx_artifacts_agent_id ON artifacts(agent_id);
CREATE INDEX idx_artifact_versions_artifact_id ON artifact_versions(artifact_id, version DESC);
