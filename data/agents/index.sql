CREATE INDEX idx_agents_system_prompt_id ON agents(system_prompt_id);
CREATE INDEX idx_agents_model_id ON agents(model_id);

CREATE INDEX idx_agent_memories_agent_id ON agent_memories(agent_id);