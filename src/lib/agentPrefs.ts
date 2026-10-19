// AI 工作室记住的选择：每个引擎各自的模型，以及是否走导播台的 AI 接口。一键导入也写这里。
export type AgentEngine = 'codex' | 'claude';

const modelKey = (e: AgentEngine) => `cs.agent.model.${e}`;
const STUDIO_KEY = 'cs.agent.studioKey';

/** 0.9.1 以前两个引擎共用 cs.agent.model，没有分开存过时沿用它 */
export const loadAgentModel = (e: AgentEngine) => localStorage.getItem(modelKey(e)) ?? localStorage.getItem('cs.agent.model') ?? '';
export const saveAgentModel = (e: AgentEngine, model: string) => localStorage.setItem(modelKey(e), model);
export const loadStudioKey = () => localStorage.getItem(STUDIO_KEY) === '1';
export const saveStudioKey = (on: boolean) => localStorage.setItem(STUDIO_KEY, on ? '1' : '0');
