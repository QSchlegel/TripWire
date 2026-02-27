import { defaultSimulatorSmokeCase, smokeCaseToJsonl } from "./simulator-smoke-cases";

export const samplePolicy = defaultSimulatorSmokeCase.policy;
export const sampleEventsJsonl = smokeCaseToJsonl(defaultSimulatorSmokeCase);
