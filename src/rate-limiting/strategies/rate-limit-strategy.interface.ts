import { RateLimitDecision, RateLimitPolicy } from "../interfaces";

export interface IRateLimitStrategy {
  consume(
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> | RateLimitDecision;
  reset(key: string): Promise<boolean> | boolean;
}