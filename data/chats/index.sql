CREATE INDEX idx_chats_project_id ON chats(project_id);
CREATE INDEX idx_chats_agent_id ON chats(agent_id);
CREATE INDEX idx_chats_team_id ON chats(team_id);

CREATE INDEX idx_messages_chat_id_sequence ON messages(chat_id, sequence);